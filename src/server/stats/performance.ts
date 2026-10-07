import { and, asc, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { applications, payments, refunds, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";

/**
 * 대관 실적 통계 (월별·주별). 모든 기간은 한국 시간(KST) 기준이다.
 *
 * 세 가지 기준으로 센다.
 * - 이용 실적: 이용일(starts_at) 기준, 확정된 대관(확정·취소 요청 중·이용 완료). 건수·이용시간·예상 인원·무료 건수.
 * - 접수 실적: 신청일(submitted_at) 기준, 지금 상태로 나눈다(진행 중·확정·반려·철회/취소).
 * - 수입: 입금·결제일(payments.paid_at) 기준 받은 금액, 환불 완료일(refunds.completed_at) 기준 돌려준 금액.
 *
 * 주는 월요일에 시작하고, 그 주의 목요일이 속한 달의 주로 센다(KS X ISO 8601의 주차 규칙).
 * 예: 2026-09-28(월)~10-04(일)은 목요일이 10/1이므로 '10월 1주'.
 */

export type Granularity = "month" | "week";

/** 이용 실적에 넣는 상태: 일정이 확정된 대관 */
export const USAGE_STATUSES = ["confirmed", "cancel_requested", "completed"] as const;

/** 접수 실적의 상태 묶음 */
export const INTAKE_GROUPS = {
  inProgress: ["pending_payment", "submitted", "reviewing", "revision_requested"],
  confirmed: ["confirmed", "cancel_requested", "completed"],
  rejected: ["rejected"],
  dropped: ["withdrawn", "cancelled", "refunded", "payment_expired", "closed_revision_expired"],
} as const;

export interface Bucket {
  /** 기간 시작일(KST, YYYY-MM-DD). 주는 월요일, 달은 1일 */
  key: string;
  label: string;
  /** 표시용 기간 (예: 9/28~10/4) */
  range: string;
  from: Date;
  to: Date;
}

export interface UsageMetrics {
  bookings: number;
  hours: number;
  headcount: number;
  freeBookings: number;
}

export interface IntakeMetrics {
  submitted: number;
  inProgress: number;
  confirmed: number;
  rejected: number;
  dropped: number;
}

export interface RevenueMetrics {
  received: number;
  refunded: number;
  net: number;
}

export interface PerformanceRow extends Bucket {
  usage: UsageMetrics;
  intake: IntakeMetrics;
  revenue: RevenueMetrics;
  /** 공간별 이용 실적 (spaceId → 지표) */
  usageBySpace: Record<string, UsageMetrics>;
}

export interface PerformanceReport {
  granularity: Granularity;
  title: string;
  from: Date;
  to: Date;
  spaces: { id: string; name: string }[];
  rows: PerformanceRow[];
  total: Omit<PerformanceRow, keyof Bucket>;
}

const kst = (date: string) => new Date(`${date}T00:00:00+09:00`);
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 달력 날짜 계산(시간대 영향 없이 UTC로 계산) */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 한 해의 열두 달 */
export function monthBuckets(year: number): Bucket[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const key = ymd(year, m, 1);
    const next = m === 12 ? ymd(year + 1, 1, 1) : ymd(year, m + 1, 1);
    return { key, label: `${m}월`, range: `${shortDate(key)}~${shortDate(addDays(next, -1))}`, from: kst(key), to: kst(next) };
  });
}

/** 그 달의 주(목요일이 그 달에 있는 월~일 주) */
export function weekBuckets(year: number, month: number): Bucket[] {
  const first = ymd(year, month, 1);
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay(); // 0=일
  // 1일이 속한 주의 월요일
  let monday = addDays(first, -((weekday + 6) % 7));
  // 그 주의 목요일이 지난달이면 다음 주부터
  if (addDays(monday, 3).slice(0, 7) !== first.slice(0, 7)) monday = addDays(monday, 7);
  const out: Bucket[] = [];
  for (let n = 1; addDays(monday, 3).slice(0, 7) === first.slice(0, 7); n += 1) {
    const next = addDays(monday, 7);
    out.push({ key: monday, label: `${month}월 ${n}주`, range: `${shortDate(monday)}~${shortDate(addDays(next, -1))}`, from: kst(monday), to: kst(next) });
    monday = next;
  }
  return out;
}

const emptyUsage = (): UsageMetrics => ({ bookings: 0, hours: 0, headcount: 0, freeBookings: 0 });
const emptyIntake = (): IntakeMetrics => ({ submitted: 0, inProgress: 0, confirmed: 0, rejected: 0, dropped: 0 });
const emptyRevenue = (): RevenueMetrics => ({ received: 0, refunded: 0, net: 0 });

function addUsage(into: UsageMetrics, v: UsageMetrics) {
  into.bookings += v.bookings;
  into.hours += v.hours;
  into.headcount += v.headcount;
  into.freeBookings += v.freeBookings;
}

/**
 * 시각을 KST 기간 시작일 문자열로 묶는 SQL. 단위는 바인딩 값이 아니라 SQL에 직접 넣는다
 * (SELECT와 GROUP BY의 식이 같아야 하는데, 바인딩 값은 자리마다 번호가 달라 다른 식으로 본다).
 */
function bucketKey(granularity: Granularity, column: unknown) {
  const unit = sql.raw(granularity === "week" ? "'week'" : "'month'");
  return sql<string>`to_char(date_trunc(${unit}, ${column} at time zone 'Asia/Seoul'), 'YYYY-MM-DD')`;
}

export async function getPerformanceReport(
  db: DbOrTx,
  params: { granularity: "month"; year: number } | { granularity: "week"; year: number; month: number },
): Promise<PerformanceReport> {
  const buckets = params.granularity === "month" ? monthBuckets(params.year) : weekBuckets(params.year, params.month);
  const from = buckets[0]!.from;
  const to = buckets.at(-1)!.to;
  const g = params.granularity;

  const spaceRows = await db.select({ id: spaces.id, name: spaces.name }).from(spaces).orderBy(asc(spaces.sortOrder), asc(spaces.name));

  const usageKey = bucketKey(g, applications.startsAt);
  const usageRows = await db
    .select({
      key: usageKey,
      spaceId: applications.spaceId,
      bookings: sql<number>`count(*)::int`,
      hours: sql<number>`coalesce(sum(extract(epoch from ${applications.endsAt} - ${applications.startsAt})) / 3600, 0)::float`,
      headcount: sql<number>`coalesce(sum(${applications.expectedHeadcount}), 0)::int`,
      freeBookings: sql<number>`count(*) filter (where coalesce(${applications.totalAmount}, 0) = 0)::int`,
    })
    .from(applications)
    .where(and(inArray(applications.status, [...USAGE_STATUSES]), gte(applications.startsAt, from), lt(applications.startsAt, to)))
    .groupBy(usageKey, applications.spaceId);

  const intakeKey = bucketKey(g, applications.submittedAt);
  const inGroup = (statuses: readonly string[]) =>
    sql<number>`count(*) filter (where ${applications.status} in (${sql.join(
      statuses.map((s) => sql`${s}`),
      sql`, `,
    )}))::int`;
  const intakeRows = await db
    .select({
      key: intakeKey,
      submitted: sql<number>`count(*)::int`,
      inProgress: inGroup(INTAKE_GROUPS.inProgress),
      confirmed: inGroup(INTAKE_GROUPS.confirmed),
      rejected: inGroup(INTAKE_GROUPS.rejected),
      dropped: inGroup(INTAKE_GROUPS.dropped),
    })
    .from(applications)
    .where(and(isNotNull(applications.submittedAt), gte(applications.submittedAt, from), lt(applications.submittedAt, to)))
    .groupBy(intakeKey);

  const paidKey = bucketKey(g, payments.paidAt);
  const paidRows = await db
    .select({ key: paidKey, amount: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` })
    .from(payments)
    .where(and(isNotNull(payments.paidAt), gte(payments.paidAt, from), lt(payments.paidAt, to)))
    .groupBy(paidKey);

  const refundKey = bucketKey(g, refunds.completedAt);
  const refundRows = await db
    .select({ key: refundKey, amount: sql<number>`coalesce(sum(${refunds.amount}), 0)::bigint` })
    .from(refunds)
    .where(and(sql`${refunds.status} = 'succeeded'`, gte(refunds.completedAt, from), lt(refunds.completedAt, to)))
    .groupBy(refundKey);

  const rows: PerformanceRow[] = buckets.map((b) => ({ ...b, usage: emptyUsage(), intake: emptyIntake(), revenue: emptyRevenue(), usageBySpace: {} }));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  for (const u of usageRows) {
    const row = byKey.get(u.key);
    if (!row) continue;
    const v = { bookings: u.bookings, hours: Number(u.hours), headcount: u.headcount, freeBookings: u.freeBookings };
    addUsage(row.usage, v);
    addUsage((row.usageBySpace[u.spaceId] ??= emptyUsage()), v);
  }
  for (const i of intakeRows) {
    const row = byKey.get(i.key);
    if (row) row.intake = { submitted: i.submitted, inProgress: i.inProgress, confirmed: i.confirmed, rejected: i.rejected, dropped: i.dropped };
  }
  for (const p of paidRows) {
    const row = byKey.get(p.key);
    if (row) row.revenue.received += Number(p.amount);
  }
  for (const r of refundRows) {
    const row = byKey.get(r.key);
    if (row) row.revenue.refunded += Number(r.amount);
  }

  const total: PerformanceReport["total"] = { usage: emptyUsage(), intake: emptyIntake(), revenue: emptyRevenue(), usageBySpace: {} };
  for (const row of rows) {
    row.revenue.net = row.revenue.received - row.revenue.refunded;
    addUsage(total.usage, row.usage);
    for (const [spaceId, v] of Object.entries(row.usageBySpace)) addUsage((total.usageBySpace[spaceId] ??= emptyUsage()), v);
    for (const k of Object.keys(total.intake) as (keyof IntakeMetrics)[]) total.intake[k] += row.intake[k];
    total.revenue.received += row.revenue.received;
    total.revenue.refunded += row.revenue.refunded;
  }
  total.revenue.net = total.revenue.received - total.revenue.refunded;

  return {
    granularity: g,
    title: params.granularity === "month" ? `${params.year}년 월별 실적` : `${params.year}년 ${params.month}월 주별 실적`,
    from,
    to,
    spaces: spaceRows,
    rows,
    total,
  };
}

/** 이용시간 표시: 소수 첫째 자리까지 */
export const formatHours = (h: number) => (Math.round(h * 10) / 10).toLocaleString("ko-KR");

/** 엑셀에서 바로 열 수 있는 CSV (UTF-8 BOM). 공간별 이용 건수·시간을 열로 붙인다. */
export function performanceCsv(report: PerformanceReport): string {
  const header = [
    "기간",
    "날짜",
    "이용 건수",
    "이용시간(시간)",
    "예상 인원",
    "무료 건수",
    ...report.spaces.flatMap((s) => [`${s.name} 건수`, `${s.name} 시간`]),
    "신청 건수",
    "진행 중",
    "확정",
    "반려",
    "철회·취소",
    "받은 금액(원)",
    "환불 금액(원)",
    "순수입(원)",
  ];
  const line = (label: string, range: string, r: PerformanceReport["total"]) => [
    label,
    range,
    r.usage.bookings,
    Math.round(r.usage.hours * 10) / 10,
    r.usage.headcount,
    r.usage.freeBookings,
    ...report.spaces.flatMap((s) => [r.usageBySpace[s.id]?.bookings ?? 0, Math.round((r.usageBySpace[s.id]?.hours ?? 0) * 10) / 10]),
    r.intake.submitted,
    r.intake.inProgress,
    r.intake.confirmed,
    r.intake.rejected,
    r.intake.dropped,
    r.revenue.received,
    r.revenue.refunded,
    r.revenue.net,
  ];
  const lines = [header, ...report.rows.map((r) => line(r.label, r.range, r)), line("합계", "", report.total)];
  const cell = (v: string | number) => {
    // 수식으로 해석되지 않게(공간 이름이 = + - @ 로 시작하는 경우)
    const s = typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${lines.map((l) => l.map(cell).join(",")).join("\r\n")}\r\n`;
}

export type ReportParams = { granularity: "month"; year: number } | { granularity: "week"; year: number; month: number };

/** 주소의 view·year·month를 읽는다. 잘못된 값은 오늘(KST) 기준 기본값으로. */
export function parseReportParams(q: { view?: string | null; year?: string | null; month?: string | null }, now: Date = new Date()): ReportParams {
  const today = currentKstMonth(now);
  const thisYear = today.year;
  const yearNum = Number(q.year);
  const year = Number.isInteger(yearNum) && yearNum >= 2020 && yearNum <= thisYear + 1 ? yearNum : thisYear;
  if (q.view !== "week") return { granularity: "month", year };
  const monthNum = Number(q.month);
  const month = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12 ? monthNum : today.month;
  return { granularity: "week", year, month };
}

/** 오늘(KST)의 연·월 */
export function currentKstMonth(now: Date = new Date()): { year: number; month: number } {
  const t = new Date(now.getTime() + 9 * 3600_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
}
