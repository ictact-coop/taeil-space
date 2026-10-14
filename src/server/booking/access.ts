import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { applicationStatusHistory, applications, attachments, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { hashToken } from "./attachments";

/**
 * 신청자가 자기 신청을 볼 수 있는지: 신청 직후 쿠키의 접근 토큰, 또는 나의 대관 세션(이메일 확인 / 전화번호·비밀번호).
 */
export async function getApplicationForApplicant(
  db: DbOrTx,
  applicationNo: string,
  token: string | undefined,
  principal: { email: string | null; applicationIds: string[] | null } | null = null,
) {
  const email = principal?.email ?? null;
  const ids = principal?.applicationIds ?? [];
  if ((!token && !email && ids.length === 0) || !/^R\d{6}-\d{5}$/.test(applicationNo)) return null;
  const access = [
    ...(token ? [eq(applications.accessTokenHash, hashToken(token))] : []),
    ...(email ? [eq(applications.contactEmail, email)] : []),
    ...(ids.length ? [inArray(applications.id, ids)] : []),
  ];
  const [row] = await db
    .select({ application: applications, spaceName: spaces.name, spaceCapacity: spaces.capacity, spaceMinHeadcount: spaces.minHeadcount, spaceApprovalNotice: spaces.approvalNotice })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(and(eq(applications.applicationNo, applicationNo), or(...access)));
  if (!row) return null;
  const id = row.application.id;
  const [payment] = await db.select().from(payments).where(eq(payments.applicationId, id)).orderBy(desc(payments.createdAt)).limit(1);
  const files = await db
    .select({ id: attachments.id, name: attachments.originalName, kind: attachments.kind, size: attachments.size })
    .from(attachments)
    .where(eq(attachments.applicationId, id));
  const history = await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, id)).orderBy(asc(applicationStatusHistory.id));
  const refundRows = await db.select().from(refunds).where(eq(refunds.applicationId, id)).orderBy(asc(refunds.createdAt));
  const [hold] = await db
    .select({ expiresAt: slotOccupancies.expiresAt })
    .from(slotOccupancies)
    .where(and(eq(slotOccupancies.applicationId, id), eq(slotOccupancies.kind, "pending_payment")));
  return { ...row, payment: payment ?? null, files, history, refunds: refundRows, holdExpiresAt: hold?.expiresAt ?? null };
}

export function listApplicationsForPrincipal(db: DbOrTx, principal: { email: string | null; applicationIds: string[] | null }) {
  const conds = [
    ...(principal.email ? [eq(applications.contactEmail, principal.email)] : []),
    ...(principal.applicationIds?.length ? [inArray(applications.id, principal.applicationIds)] : []),
  ];
  return db
    .select({ application: applications, spaceName: spaces.name })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(conds.length ? or(...conds) : sql`false`)
    .orderBy(desc(applications.createdAt));
}
