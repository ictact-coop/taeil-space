import { and, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { fieldErrorsFrom, type MutationResult } from "@/server/actor";
import { hashToken } from "@/server/booking/attachments";
import { applications, attachments, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import type { PaymentGateway } from "@/server/payments/gateway";
import { createRefund, processRefund } from "@/server/payments/refunds";
import { getSettings } from "@/server/settings/service";
import { toMinutesOfDay } from "@/lib/time-of-day";
import { toMinutes } from "@/domain/booking/time";
import { lockApplication, transition, TransitionError } from "./transition";

interface PolicySnapshot {
  settings?: { values?: Record<string, unknown> };
}

/** 결제 당시 설정값 (계획서 2.7: 이미 결제한 신청은 결제 당시 규정을 따른다) */
function snapshotValue<T>(app: { policySnapshot: unknown }, key: string, fallback: T): T {
  const v = (app.policySnapshot as PolicySnapshot | null)?.settings?.values?.[key];
  return (v as T | undefined) ?? fallback;
}

/**
 * 신청자 철회 (USR-011 일부).
 * - 결제대기: 결제 시도를 취소하고 일정을 푼다(환불 없음).
 * - 신청접수·검토중·보완요청: 결제 당시의 "승인 전 철회 환불률"로 환불한다 (P-15).
 */
export async function withdrawApplication(db: Db, gateway: PaymentGateway | null, p: { applicationId: string; reason: string }): Promise<MutationResult<{ refundAmount: number }>> {
  let refundIds: string[] = [];
  let refundAmount = 0;
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      const reason = p.reason.trim() || "신청자 철회";
      if (app.status === "pending_payment") {
        await transition(tx, app, "withdrawn", { actorType: "applicant", reason });
        await tx.delete(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id));
        await tx.update(payments).set({ status: "cancelled", failureReason: "신청자 철회" }).where(and(eq(payments.applicationId, app.id), eq(payments.status, "ready")));
      } else {
        await transition(tx, app, "withdrawn", { actorType: "applicant", reason });
        await tx.delete(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id));
        const current = (await getSettings(tx))["payment.withdrawRefundPercent"];
        const rate = snapshotValue(app, "payment.withdrawRefundPercent", current);
        const id = await createRefund(tx, { applicationId: app.id, basis: "withdrawn", ratePercent: rate, reason: `승인 전 철회(${rate}%): ${reason}` });
        if (id) refundIds = [id];
        refundAmount = Math.floor(((app.totalAmount ?? 0) * rate) / 100);
      }
      await enqueueApplicationNotification(tx, "withdrawn", app.id, { refundAmount });
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  for (const id of refundIds) await processRefund(db, gateway, id);
  await flushNotifications(db).catch(() => undefined);
  return { ok: true, value: { refundAmount } };
}

/** 보완 때 고칠 수 있는 항목: 금액에 영향이 없는 것만 (P-14 기본값) */
export const revisionSchema = z.object({
  contactName: z.string().trim().min(1, "담당자 이름을 입력하세요.").max(50),
  contactPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^0\d{8,10}$/, "전화번호를 확인하세요.")),
  eventTitle: z.string().trim().min(1, "행사명을 입력하세요.").max(100),
  eventPurpose: z.string().trim().max(3000),
  eventPublic: z.boolean(),
  expectedHeadcount: z.coerce.number().int().min(1, "예상 인원을 입력하세요.").max(10000),
  nightManagerName: z.string().trim().max(50),
  nightManagerPhone: z.string().trim().max(20),
  uploadToken: z.string().min(20),
  note: z.string().trim().max(1000),
});

export async function submitRevision(db: Db, p: { applicationId: string; raw: Record<string, unknown> }): Promise<MutationResult> {
  const parsed = revisionSchema.safeParse(p.raw);
  if (!parsed.success) return { ok: false, formError: "입력값을 확인하세요.", fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app || app.status !== "revision_requested") throw new TransitionError("보완할 수 있는 신청이 아닙니다.");
      const [space] = await tx.select().from(spaces).where(eq(spaces.id, app.spaceId));
      const settings = await getSettings(tx);
      const errors: Record<string, string> = {};
      if (space && input.expectedHeadcount > space.capacity) errors.expectedHeadcount = `정원은 ${space.capacity}명입니다.`;
      if (space?.minHeadcount && input.expectedHeadcount < space.minHeadcount) errors.expectedHeadcount = `${space.minHeadcount}명 이상이어야 합니다.`;
      if (input.eventPurpose.length < settings["application.minPurposeLength"]) errors.eventPurpose = `행사 목적과 내용을 ${settings["application.minPurposeLength"]}자 이상 적어 주세요.`;
      const night = toMinutesOfDay(app.endsAt) > toMinutes(settings["operation.dayEnd"]);
      if (night && (!input.nightManagerName || !/^0\d{8,10}$/.test(input.nightManagerPhone.replace(/[\s-]/g, "")))) errors.nightManagerName = "야간 출입문 관리 담당자와 연락처를 입력하세요.";
      if (Object.keys(errors).length > 0) throw Object.assign(new TransitionError("입력값을 확인하세요."), { fieldErrors: errors });
      await transition(tx, app, "reviewing", {
        actorType: "applicant",
        reason: input.note ? `보완 제출: ${input.note}` : "보완 제출",
        patch: {
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          eventTitle: input.eventTitle,
          eventPurpose: input.eventPurpose,
          eventPublic: input.eventPublic,
          expectedHeadcount: input.expectedHeadcount,
          nightManagerName: night ? input.nightManagerName : null,
          nightManagerPhone: night ? input.nightManagerPhone : null,
        },
      });
      await tx
        .update(attachments)
        .set({ applicationId: app.id })
        .where(and(eq(attachments.uploadTokenHash, hashToken(input.uploadToken)), isNull(attachments.applicationId)));
      await enqueueApplicationNotification(tx, "revision_submitted", app.id);
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message, fieldErrors: (e as TransitionError & { fieldErrors?: Record<string, string> }).fieldErrors };
    throw e;
  }
  await flushNotifications(db).catch(() => undefined);
  return { ok: true };
}

/** 작업 프로세스: 보완기한이 지난 신청을 종료하고 전액 환불 */
export async function expireRevisions(db: Db, gateway: PaymentGateway | null, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.status, "revision_requested"), lte(applications.revisionDeadline, now)))
    .limit(100);
  let count = 0;
  for (const { id } of due) {
    let refundId: string | null = null;
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id });
      if (!app || app.status !== "revision_requested" || !app.revisionDeadline || app.revisionDeadline > now) return;
      await transition(tx, app, "closed_revision_expired", { actorType: "system", reason: "보완 제출 기한 만료" });
      await tx.delete(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id));
      refundId = await createRefund(tx, { applicationId: app.id, basis: "revision_expired", ratePercent: 100, reason: "보완 제출 기한 만료" });
      await enqueueApplicationNotification(tx, "rejected", app.id, { reason: "보완 제출 기한이 지나 신청이 종료되었습니다." });
      count += 1;
    });
    if (refundId) await processRefund(db, gateway, refundId);
  }
  if (count) await flushNotifications(db).catch(() => undefined);
  return count;
}
