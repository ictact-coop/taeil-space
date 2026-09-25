import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { applicationStatusHistory, applications, attachments, organizations, payments, refunds, spaces, adminUsers } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import type { ApplicationStatus } from "./transition";

export const statusTabs: { key: string; label: string; statuses: ApplicationStatus[] }[] = [
  { key: "todo", label: "처리 필요", statuses: ["submitted", "reviewing"] },
  { key: "revision", label: "보완요청", statuses: ["revision_requested"] },
  { key: "pending", label: "결제대기", statuses: ["pending_payment"] },
  { key: "confirmed", label: "예약확정", statuses: ["confirmed"] },
  { key: "closed", label: "종료", statuses: ["rejected", "withdrawn", "payment_expired", "closed_revision_expired", "cancelled", "refunded", "completed"] },
  { key: "all", label: "전체", statuses: [] },
];

const PAGE_SIZE = 30;

export async function listApplicationsForAdmin(db: DbOrTx, params: { tab: string; q: string; page: number }) {
  const tab = statusTabs.find((t) => t.key === params.tab) ?? statusTabs[0]!;
  const conds: SQL[] = [];
  if (tab.statuses.length > 0) conds.push(inArray(applications.status, tab.statuses));
  const q = params.q.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(applications.applicationNo, like), ilike(applications.orgName, like), ilike(applications.eventTitle, like), ilike(applications.contactName, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({ app: applications, spaceName: spaces.name })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(where)
    .orderBy(tab.key === "todo" ? asc(applications.paidAt) : desc(applications.createdAt))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, params.page) - 1) * PAGE_SIZE);
  const counts = await db.select({ status: applications.status, n: count() }).from(applications).groupBy(applications.status);
  const tabCounts = Object.fromEntries(
    statusTabs.map((t) => [t.key, counts.filter((c) => t.statuses.length === 0 || t.statuses.includes(c.status)).reduce((s, c) => s + c.n, 0)]),
  );
  return { rows, tab: tab.key, tabCounts, pageSize: PAGE_SIZE };
}

export async function getApplicationForAdmin(db: DbOrTx, applicationNo: string) {
  const [row] = await db
    .select({ app: applications, space: spaces, org: organizations })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .leftJoin(organizations, eq(organizations.id, applications.organizationId))
    .where(eq(applications.applicationNo, applicationNo));
  if (!row) return null;
  const id = row.app.id;
  const [files, history, paymentRows, refundRows] = await Promise.all([
    db.select().from(attachments).where(eq(attachments.applicationId, id)).orderBy(asc(attachments.createdAt)),
    db
      .select({ h: applicationStatusHistory, actorName: adminUsers.name })
      .from(applicationStatusHistory)
      // actor_id는 신청자·시스템도 담는 text 컬럼이라 uuid를 text로 바꿔 비교한다
      .leftJoin(adminUsers, sql`${adminUsers.id}::text = ${applicationStatusHistory.actorId}`)
      .where(eq(applicationStatusHistory.applicationId, id))
      .orderBy(asc(applicationStatusHistory.id)),
    db.select().from(payments).where(eq(payments.applicationId, id)).orderBy(asc(payments.createdAt)),
    db.select().from(refunds).where(eq(refunds.applicationId, id)).orderBy(asc(refunds.createdAt)),
  ]);
  return { ...row, files, history, payments: paymentRows, refunds: refundRows };
}

/** 환불 처리 목록: 수동 처리 대기(계좌이체)와 재처리 필요(실패) */
export function listRefundsNeedingAction(db: DbOrTx) {
  return db
    .select({ refund: refunds, payment: payments, applicationNo: applications.applicationNo, orgName: applications.orgName, contactName: applications.contactName })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(applications, eq(applications.id, refunds.applicationId))
    .where(inArray(refunds.status, ["requested", "failed"]))
    .orderBy(asc(refunds.createdAt));
}
