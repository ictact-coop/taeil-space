import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { currentKstMonth, formatHours, getPerformanceReport, parseReportParams, type PerformanceReport, type ReportParams } from "@/server/stats/performance";

export const metadata: Metadata = { title: "통계" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const n = (v: number) => v.toLocaleString("ko-KR");

function query(p: ReportParams): string {
  return p.granularity === "month" ? `view=month&year=${p.year}` : `view=week&year=${p.year}&month=${p.month}`;
}

/** 이전·다음 기간 */
function shift(p: ReportParams, delta: number): ReportParams {
  if (p.granularity === "month") return { ...p, year: p.year + delta };
  const index = p.year * 12 + (p.month - 1) + delta;
  return { granularity: "week", year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export default async function StatsPage({ searchParams }: { searchParams: Search }) {
  await requireAdmin("stats.view");
  const sp = await searchParams;
  const params = parseReportParams({ view: one(sp.view), year: one(sp.year), month: one(sp.month) });
  const report = await getPerformanceReport(db, params);
  const today = currentKstMonth();
  const thisYear = today.year;
  const years = Array.from({ length: thisYear + 2 - 2026 }, (_, i) => 2026 + i);
  if (!years.includes(params.year)) years.unshift(params.year);
  const prev = shift(params, -1);
  const next = shift(params, 1);
  const canNext = next.year <= thisYear + 1;
  const isWeek = params.granularity === "week";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="통계"
        description="대관 실적을 월별·주별로 봅니다. 모든 날짜는 한국 시간 기준입니다. 기념관 통계 양식은 받는 대로 추가합니다."
      />

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <nav aria-label="집계 단위" className="flex rounded border border-line text-sm">
            <Link
              href={`/admin/stats?view=month&year=${params.year}`}
              aria-current={!isWeek ? "page" : undefined}
              className={`px-3 py-2 ${!isWeek ? "bg-navy text-white" : "text-navy hover:bg-cream"}`}
            >
              월별
            </Link>
            <Link
              href={`/admin/stats?view=week&year=${params.year}&month=${isWeek ? params.month : today.month}`}
              aria-current={isWeek ? "page" : undefined}
              className={`border-l border-line px-3 py-2 ${isWeek ? "bg-navy text-white" : "text-navy hover:bg-cream"}`}
            >
              주별
            </Link>
          </nav>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="view" value={params.granularity} />
            <label className="flex flex-col gap-1 text-xs text-muted">
              연도
              <select name="year" defaultValue={params.year} className="input py-1.5">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            {isWeek && (
              <label className="flex flex-col gap-1 text-xs text-muted">
                월
                <select name="month" defaultValue={params.month} className="input py-1.5">
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}월
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className="btn-secondary py-1.5">
              보기
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/admin/stats?${query(prev)}`} className="btn-ghost py-1.5">
            ← {isWeek ? "이전 달" : "이전 해"}
          </Link>
          {canNext && (
            <Link href={`/admin/stats?${query(next)}`} className="btn-ghost py-1.5">
              {isWeek ? "다음 달" : "다음 해"} →
            </Link>
          )}
          <a href={`/admin/api/stats?${query(params)}`} className="btn-secondary py-1.5">
            CSV 내려받기
          </a>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-navy">{report.title}</h2>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="이용 건수" value={`${n(report.total.usage.bookings)}건`} hint={`무료 ${n(report.total.usage.freeBookings)}건 포함`} />
        <Tile label="이용시간" value={`${formatHours(report.total.usage.hours)}시간`} hint={`예상 인원 ${n(report.total.usage.headcount)}명`} />
        <Tile label="신청 건수" value={`${n(report.total.intake.submitted)}건`} hint={`확정 ${n(report.total.intake.confirmed)} · 반려 ${n(report.total.intake.rejected)}`} />
        <Tile label="순수입" value={formatWon(report.total.revenue.net)} hint={`받은 금액 ${formatWon(report.total.revenue.received)} · 환불 ${formatWon(report.total.revenue.refunded)}`} />
      </dl>

      <UsageTable report={report} />
      <IntakeTable report={report} />
      <RevenueTable report={report} />

      <section className="rounded-lg border border-line bg-white p-4 text-xs leading-relaxed text-muted">
        <h2 className="mb-1 font-semibold text-ink">집계 기준</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <strong>이용 실적</strong>: 이용일 기준. 일정이 확정된 대관(예약확정·취소 요청 중·이용완료)만 셉니다. 이용시간은 신청한 시작~종료 시간(준비·철수 시간 제외)입니다.
          </li>
          <li>
            <strong>접수 실적</strong>: 신청서를 제출한 날 기준. 지금 상태로 나눕니다(진행 중: 입금·결제 대기·접수·검토·보완 / 철회·취소: 철회·취소·환불완료·결제기한 만료·보완기한 만료).
          </li>
          <li>
            <strong>수입</strong>: 입금 확인·결제일 기준 받은 금액과, 환불을 완료한 날 기준 돌려준 금액입니다. 같은 신청이라도 받은 달과 환불한 달이 다를 수 있습니다.
          </li>
          {isWeek && <li>주는 월요일에 시작하고, 그 주의 목요일이 있는 달의 주로 셉니다(예: 9/28~10/4는 10월 1주).</li>}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-navy">{value}</dd>
      <dd className="mt-1 text-xs text-muted">{hint}</dd>
    </div>
  );
}

const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

function Period({ label, range }: { label: string; range: string }) {
  return (
    <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
      {label}
      {range && <span className="ml-2 text-xs font-normal text-muted">{range}</span>}
    </th>
  );
}

function TableShell({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-semibold text-navy">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </section>
  );
}

function UsageTable({ report }: { report: PerformanceReport }) {
  const lines = [...report.rows.map((r) => ({ ...r, total: false })), { ...report.total, label: "합계", range: "", key: "total", total: true }];
  return (
    <TableShell title="이용 실적" caption={`${report.title} — 이용 실적(공간별)`}>
      <thead className="bg-cream text-xs text-muted">
        <tr>
          <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-medium">
            기간
          </th>
          <th scope="col" colSpan={4} className="border-l border-line px-3 py-1 text-center font-medium">
            전체
          </th>
          {report.spaces.map((s) => (
            <th key={s.id} scope="col" colSpan={2} className="border-l border-line px-3 py-1 text-center font-medium whitespace-nowrap">
              {s.name}
            </th>
          ))}
        </tr>
        <tr>
          <th scope="col" className={`${th} border-l border-line`}>건수</th>
          <th scope="col" className={th}>시간</th>
          <th scope="col" className={th}>예상 인원</th>
          <th scope="col" className={th}>무료</th>
          {report.spaces.map((s) => [
            <th key={`${s.id}-b`} scope="col" className={`${th} border-l border-line`}>
              건수
            </th>,
            <th key={`${s.id}-h`} scope="col" className={th}>
              시간
            </th>,
          ])}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {lines.map((r) => (
          <tr key={r.key} className={r.total ? "bg-cream/60 font-semibold" : r.usage.bookings === 0 ? "text-muted" : undefined}>
            <Period label={r.label} range={r.range} />
            <td className={`${td} border-l border-line`}>{n(r.usage.bookings)}</td>
            <td className={td}>{formatHours(r.usage.hours)}</td>
            <td className={td}>{n(r.usage.headcount)}</td>
            <td className={td}>{n(r.usage.freeBookings)}</td>
            {report.spaces.map((s) => [
              <td key={`${s.id}-b`} className={`${td} border-l border-line`}>
                {n(r.usageBySpace[s.id]?.bookings ?? 0)}
              </td>,
              <td key={`${s.id}-h`} className={td}>
                {formatHours(r.usageBySpace[s.id]?.hours ?? 0)}
              </td>,
            ])}
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function IntakeTable({ report }: { report: PerformanceReport }) {
  const lines = [...report.rows.map((r) => ({ ...r, total: false })), { ...report.total, label: "합계", range: "", key: "total", total: true }];
  return (
    <TableShell title="접수 실적" caption={`${report.title} — 접수 실적`}>
      <thead className="bg-cream text-xs text-muted">
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-medium">기간</th>
          <th scope="col" className={th}>신청</th>
          <th scope="col" className={th}>진행 중</th>
          <th scope="col" className={th}>확정</th>
          <th scope="col" className={th}>반려</th>
          <th scope="col" className={th}>철회·취소</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {lines.map((r) => (
          <tr key={r.key} className={r.total ? "bg-cream/60 font-semibold" : r.intake.submitted === 0 ? "text-muted" : undefined}>
            <Period label={r.label} range={r.range} />
            <td className={td}>{n(r.intake.submitted)}</td>
            <td className={td}>{n(r.intake.inProgress)}</td>
            <td className={td}>{n(r.intake.confirmed)}</td>
            <td className={td}>{n(r.intake.rejected)}</td>
            <td className={td}>{n(r.intake.dropped)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function RevenueTable({ report }: { report: PerformanceReport }) {
  const lines = [...report.rows.map((r) => ({ ...r, total: false })), { ...report.total, label: "합계", range: "", key: "total", total: true }];
  return (
    <TableShell title="수입" caption={`${report.title} — 수입`}>
      <thead className="bg-cream text-xs text-muted">
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-medium">기간</th>
          <th scope="col" className={th}>받은 금액</th>
          <th scope="col" className={th}>환불 금액</th>
          <th scope="col" className={th}>순수입</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {lines.map((r) => (
          <tr key={r.key} className={r.total ? "bg-cream/60 font-semibold" : r.revenue.received === 0 && r.revenue.refunded === 0 ? "text-muted" : undefined}>
            <Period label={r.label} range={r.range} />
            <td className={td}>{formatWon(r.revenue.received)}</td>
            <td className={td}>{formatWon(r.revenue.refunded)}</td>
            <td className={`${td} ${r.revenue.net < 0 ? "text-danger" : ""}`}>{formatWon(r.revenue.net)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
