import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { applicationStatusHistory, applications, attachments, organizations, payments, refunds, slotOccupancies, spaces, adminUsers } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import type { ApplicationStatus } from "./transition";

/**
 * 신청 관리 상태 분류 (2026-10 기념관 요청: 입금 대기·예약 확정·반려·전체).
 * 입금은 확인했지만 아직 승인하지 않았거나 보완 중인 신청은 '확인 필요'로 따로 모은다. 이 탭은 해당 건이 있을 때만 보인다.
 */
export const statusTabs: { key: string; label: string; statuses: ApplicationStatus[]; onlyWhenNonEmpty?: boolean }[] = [
  { key: "pending", label: "입금 대기", statuses: ["pending_payment"] },
  { key: "review", label: "확인 필요", statuses: ["submitted", "reviewing", "revision_requested"], onlyWhenNonEmpty: true },
  { key: "confirmed", label: "예약 확정", statuses: ["confirmed", "cancel_requested", "completed"] },
  { key: "rejected", label: "반려", statuses: ["rejected"] },
  { key: "all", label: "전체", statuses: [] },
];

/** 예전 주소(?tab=todo 등)도 열리게 */
const legacyTabs: Record<string, string> = { todo: "review", revision: "review", closed: "all" };

const PAGE_SIZE = 30;

export async function listApplicationsForAdmin(db: DbOrTx, params: { tab: string; q: string; page: number }) {
  const key = legacyTabs[params.tab] ?? params.tab;
  const tab = statusTabs.find((t) => t.key === key) ?? statusTabs[0]!;
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
    .orderBy(tab.key === "review" ? asc(applications.paidAt) : tab.key === "pending" ? asc(applications.createdAt) : desc(applications.createdAt))
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
  const [files, history, paymentRows, refundRows, holdRows] = await Promise.all([
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
    db
      .select({ expiresAt: slotOccupancies.expiresAt })
      .from(slotOccupancies)
      .where(and(eq(slotOccupancies.applicationId, id), eq(slotOccupancies.kind, "pending_payment"))),
  ]);
  /** 결제(입금) 기한: 결제대기 상태에서 일정을 잡아 둔 기한 */
  const holdExpiresAt = holdRows[0]?.expiresAt ?? null;
  return { ...row, files, history, payments: paymentRows, refunds: refundRows, holdExpiresAt };
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
