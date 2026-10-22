import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { kstStartOfDay } from "@/lib/time";
import { applicationStatusHistory, applications, attachments, organizations, payments, refunds, slotOccupancies, spaces, adminUsers } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import type { ApplicationStatus } from "./transition";

/**
 * 신청 관리 상태 분류 (2026-10 기념관 요청: 입금 대기·예약 확정·반려·전체).
 * 입금은 확인했지만 아직 승인하지 않았거나 보완 중인 신청은 '확인 필요'로 따로 모은다. 이 탭은 해당 건이 있을 때만 보인다.
 */
export const statusTabs: { key: string; label: string; statuses: ApplicationStatus[]; onlyWhenNonEmpty?: boolean }[] = [
  { key: "pending", label: "입금 대기", statuses: ["pending_payment"] },
  { key: "unpaid", label: "미입금", statuses: ["pending_payment"] },
  { key: "review", label: "확인 필요", statuses: ["submitted", "reviewing", "revision_requested"], onlyWhenNonEmpty: true },
  { key: "confirmed", label: "예약 확정", statuses: ["confirmed", "cancel_requested", "completed"] },
  { key: "rejected", label: "반려", statuses: ["rejected"] },
  { key: "all", label: "전체", statuses: [] },
];

/** 예전 주소(?tab=todo 등)도 열리게 */
const legacyTabs: Record<string, string> = { todo: "review", revision: "review", closed: "all" };

const PAGE_SIZE = 30;

const submittedOrCreated = sql`coalesce(${applications.submittedAt}, ${applications.createdAt})`;

/** 신청 관리 목록 필터: 상태 탭, 검색어, 이용일 기간(KST, 포함), 공간 */
export interface AdminListFilter {
  tab: string;
  q: string;
  from?: string;
  to?: string;
  spaceId?: string;
}

const isDate = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
const isUuid = (v: string | undefined): v is string => Boolean(v && /^[0-9a-f-]{36}$/i.test(v));

/** 화면 주소의 필터 값을 검사해 정리한다(잘못된 값은 무시) */
export function normalizeAdminFilter(f: Partial<Record<keyof AdminListFilter, string | undefined>>): AdminListFilter {
  const key = legacyTabs[f.tab ?? ""] ?? f.tab ?? "pending";
  const tab = (statusTabs.find((t) => t.key === key) ?? statusTabs[0]!).key;
  return {
    tab,
    q: (f.q ?? "").trim().slice(0, 100),
    from: isDate(f.from) ? f.from : undefined,
    to: isDate(f.to) ? f.to : undefined,
    spaceId: isUuid(f.spaceId) ? f.spaceId : undefined,
  };
}

/** 신청은 취소하지 않고 입금 기한이 지난 계좌이체만 별도 분류한다. 워커 실행 여부와 무관하다. */
const overdueBankPayment = sql<boolean>`(${applications.status} = 'pending_payment' and exists (
  select 1 from slot_occupancies s join payments p on p.application_id = s.application_id
  where s.application_id = ${applications.id} and s.kind = 'pending_payment'
    and s.expires_at <= current_timestamp and p.method = 'bank_transfer' and p.status = 'ready'
))`;

function adminListWhere(f: AdminListFilter): SQL | undefined {
  const tab = statusTabs.find((t) => t.key === f.tab) ?? statusTabs[0]!;
  const conds: SQL[] = [];
  if (tab.statuses.length > 0) conds.push(inArray(applications.status, tab.statuses));
  if (f.tab === "unpaid") conds.push(overdueBankPayment);
  if (f.tab === "pending") conds.push(sql`not ${overdueBankPayment}`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(applications.applicationNo, like), ilike(applications.orgName, like), ilike(applications.eventTitle, like), ilike(applications.contactName, like))!);
  }
  if (f.from) conds.push(gte(applications.startsAt, kstStartOfDay(f.from)));
  if (f.to) conds.push(lt(applications.startsAt, new Date(kstStartOfDay(f.to).getTime() + 86_400_000)));
  if (f.spaceId) conds.push(eq(applications.spaceId, f.spaceId));
  return conds.length ? and(...conds) : undefined;
}

// 확인 필요는 입금 확인 순(오래된 것부터), 나머지는 최근 신청이 위(노션에서 가져온 신청은 노션 신청등록일 기준)
const listOrder = (tab: string) => (tab === "review" ? [asc(applications.paidAt)] : [desc(submittedOrCreated), desc(applications.createdAt)]);

export async function listApplicationsForAdmin(db: DbOrTx, params: AdminListFilter & { page: number }) {
  const f = normalizeAdminFilter(params);
  const where = adminListWhere(f);
  const rows = await db
    .select({ app: applications, spaceName: spaces.name, isOverdue: overdueBankPayment })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(where)
    .orderBy(...listOrder(f.tab))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, params.page) - 1) * PAGE_SIZE);
  const counts = await db.select({ status: applications.status, n: count() }).from(applications).groupBy(applications.status);
  const [{ overdueCount } = { overdueCount: 0 }] = await db.select({ overdueCount: count() }).from(applications).where(overdueBankPayment);
  const tabCounts = Object.fromEntries(
    statusTabs.map((t) => [t.key, counts.filter((c) => t.statuses.length === 0 || t.statuses.includes(c.status)).reduce((s, c) => s + c.n, 0)]),
  );
  tabCounts.pending = (tabCounts.pending ?? 0) - overdueCount;
  tabCounts.unpaid = overdueCount;
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(applications).where(where);
  return { rows, tab: f.tab, tabCounts, pageSize: PAGE_SIZE, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export const EXPORT_LIMIT = 10_000;

/** 내려받기용: 필터에 맞는 신청 전체(페이지 없이, 최대 EXPORT_LIMIT건)와 단체·결제·환불 요약 */
export async function listApplicationsForExport(db: DbOrTx, filter: AdminListFilter) {
  const f = normalizeAdminFilter(filter);
  const rows = await db
    .select({ app: applications, spaceName: spaces.name, org: organizations, isOverdue: overdueBankPayment })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .leftJoin(organizations, eq(organizations.id, applications.organizationId))
    .where(adminListWhere(f))
    .orderBy(...listOrder(f.tab))
    .limit(EXPORT_LIMIT);
  const ids = rows.map((r) => r.app.id);
  const pays = ids.length
    ? await db.select({ applicationId: payments.applicationId, method: payments.method, status: payments.status, amount: payments.amount, paidAt: payments.paidAt, providerRaw: payments.providerRaw }).from(payments).where(inArray(payments.applicationId, ids))
    : [];
  const refs = ids.length
    ? await db.select({ applicationId: refunds.applicationId, amount: refunds.amount, status: refunds.status }).from(refunds).where(inArray(refunds.applicationId, ids))
    : [];
  return rows.map((r) => {
    const myPays = pays.filter((p) => p.applicationId === r.app.id);
    const paid = myPays.filter((p) => p.status === "paid" || (p.status === "cancelled" && p.paidAt !== null));
    const myRefs = refs.filter((x) => x.applicationId === r.app.id);
    return {
      ...r,
      method: (paid[0] ?? myPays[0])?.method ?? null,
      depositorName: [...new Set(myPays.filter((p) => p.method === "bank_transfer").flatMap((p) => {
        const name = (p.providerRaw as { depositorName?: unknown } | null)?.depositorName;
        return typeof name === "string" && name.trim() ? [name.trim()] : [];
      }))].join(" / "),
      paidAmount: paid.reduce((s, p) => s + p.amount, 0),
      refundedAmount: myRefs.filter((x) => x.status === "succeeded").reduce((s, x) => s + x.amount, 0),
      refundPendingAmount: myRefs.filter((x) => x.status !== "succeeded").reduce((s, x) => s + x.amount, 0),
    };
  });
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

export const refundTabs = [
  { key: "pending", label: "처리 대기" },
  { key: "completed", label: "환불 완료" },
] as const;
export type RefundTab = (typeof refundTabs)[number]["key"];
export function normalizeRefundTab(tab: string | undefined | null): RefundTab {
  return tab === "completed" ? "completed" : "pending";
}

/** 환불 목록: 대기는 오래된 요청부터, 완료는 최근 완료부터 표시한다. */
export function listRefunds(db: DbOrTx, tab: RefundTab) {
  return db
    .select({ refund: refunds, payment: payments, applicationNo: applications.applicationNo, orgName: applications.orgName, contactName: applications.contactName })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(applications, eq(applications.id, refunds.applicationId))
    .where(tab === "completed" ? eq(refunds.status, "succeeded") : inArray(refunds.status, ["requested", "failed"]))
    .orderBy(...(tab === "completed" ? [desc(refunds.completedAt), desc(refunds.createdAt), desc(refunds.id)] : [asc(refunds.createdAt), asc(refunds.id)]));
}

/** 기존 호출용: 수동 처리 대기와 재처리 필요 건 */
export function listRefundsNeedingAction(db: DbOrTx) {
  return listRefunds(db, "pending");
}
