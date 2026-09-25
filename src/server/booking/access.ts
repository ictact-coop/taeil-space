import { and, desc, eq } from "drizzle-orm";
import { applications, attachments, payments, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { hashToken } from "./attachments";

/** 신청 직후 결제 화면: 신청번호 + 신청자 쿠키의 토큰이 맞아야 볼 수 있다. (나의 대관 본인 확인은 단계 3) */
export async function getApplicationForApplicant(db: DbOrTx, applicationNo: string, token: string | undefined) {
  if (!token || !/^R\d{6}-\d{5}$/.test(applicationNo)) return null;
  const [row] = await db
    .select({ application: applications, spaceName: spaces.name })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(and(eq(applications.applicationNo, applicationNo), eq(applications.accessTokenHash, hashToken(token))));
  if (!row) return null;
  const [payment] = await db.select().from(payments).where(eq(payments.applicationId, row.application.id)).orderBy(desc(payments.createdAt)).limit(1);
  const files = await db
    .select({ id: attachments.id, name: attachments.originalName, kind: attachments.kind, size: attachments.size })
    .from(attachments)
    .where(eq(attachments.applicationId, row.application.id));
  return { ...row, payment: payment ?? null, files };
}
