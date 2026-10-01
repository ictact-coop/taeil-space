import { eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import { applications, applicationStatus, applicationStatusHistory } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export type ApplicationRow = typeof applications.$inferSelect;

/** 허용되는 상태 전이 (계획서 2.3) */
const allowed: Partial<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  pending_payment: ["submitted", "payment_expired", "withdrawn"],
  submitted: ["reviewing", "revision_requested", "rejected", "confirmed", "withdrawn"],
  reviewing: ["revision_requested", "rejected", "confirmed", "withdrawn"],
  revision_requested: ["reviewing", "rejected", "withdrawn", "closed_revision_expired"],
  confirmed: ["cancel_requested", "cancelled", "completed"],
  cancel_requested: ["cancelled", "confirmed"],
};

export const statusLabels: Record<ApplicationStatus, string> = {
  draft: "작성중",
  pending_payment: "결제대기",
  payment_expired: "미결제취소",
  submitted: "신청접수",
  reviewing: "검토중",
  revision_requested: "보완요청",
  closed_revision_expired: "보완기한 만료",
  rejected: "반려",
  withdrawn: "신청취소",
  confirmed: "예약확정",
  cancel_requested: "취소요청",
  cancelled: "취소완료",
  refunded: "환불완료",
  completed: "이용완료",
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export class TransitionError extends Error {}

/** 잠근 신청 행(for update)의 상태를 바꾸고 이력·감사 로그를 남긴다. */
export async function transition(
  tx: DbOrTx,
  app: ApplicationRow,
  to: ApplicationStatus,
  params: {
    actorType: "admin" | "system" | "applicant";
    actorId?: string | null;
    reason?: string | null;
    patch?: Partial<typeof applications.$inferInsert>;
    ip?: string | null;
  },
): Promise<ApplicationRow> {
  if (!canTransition(app.status, to)) {
    throw new TransitionError(`'${statusLabels[app.status]}' 상태에서는 '${statusLabels[to]}'(으)로 바꿀 수 없습니다.`);
  }
  const [updated] = await tx
    .update(applications)
    .set({ ...params.patch, status: to })
    .where(eq(applications.id, app.id))
    .returning();
  await tx.insert(applicationStatusHistory).values({
    applicationId: app.id,
    fromStatus: app.status,
    toStatus: to,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    reason: params.reason ?? null,
  });
  await writeAudit(tx, {
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: `application.${to}`,
    targetType: "application",
    targetId: app.id,
    before: { status: app.status },
    after: { status: to, applicationNo: app.applicationNo },
    reason: params.reason ?? null,
    ip: params.ip ?? null,
  });
  return updated!;
}

export async function lockApplication(tx: DbOrTx, where: { id?: string; applicationNo?: string }): Promise<ApplicationRow | null> {
  const cond = where.id ? eq(applications.id, where.id) : eq(applications.applicationNo, where.applicationNo ?? "");
  const [row] = await tx.select().from(applications).where(cond).for("update");
  return row ?? null;
}
