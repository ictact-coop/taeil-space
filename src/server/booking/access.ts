import { and, asc, desc, eq, or } from "drizzle-orm";
import { applicationStatusHistory, applications, attachments, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { hashToken } from "./attachments";

/**
 * 신청자가 자기 신청을 볼 수 있는지: 신청 직후 쿠키의 접근 토큰, 또는 나의 대관 이메일 확인 세션.
 */
export async function getApplicationForApplicant(
  db: DbOrTx,
  applicationNo: string,
  token: string | undefined,
  email: string | null = null,
) {
  if ((!token && !email) || !/^R\d{6}-\d{5}$/.test(applicationNo)) return null;
  const access = [
    ...(token ? [eq(applications.accessTokenHash, hashToken(token))] : []),
    ...(email ? [eq(applications.contactEmail, email)] : []),
  ];
  const [row] = await db
    .select({ application: applications, spaceName: spaces.name, spaceCapacity: spaces.capacity, spaceMinHeadcount: spaces.minHeadcount })
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

export function listApplicationsByEmail(db: DbOrTx, email: string) {
  return db
    .select({ application: applications, spaceName: spaces.name })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(eq(applications.contactEmail, email))
    .orderBy(desc(applications.createdAt));
}
