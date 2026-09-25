import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { addDays, weekdayOf } from "@/domain/calendar/closures";
import { formatKst, kstDateOf } from "@/lib/time";
import { getMonthSchedule } from "@/server/applications/dashboard";
import { statusLabels } from "@/server/applications/transition";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { listSpaces } from "@/server/spaces/service";

export const metadata: Metadata = { title: "대관 캘린더" };

const tone: Record<string, string> = {
  confirmed: "bg-status-green/15 text-status-green",
  completed: "bg-status-green/15 text-status-green",
  pending_payment: "bg-warning/10 text-warning",
  revision_requested: "bg-warning/10 text-warning",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; space?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : kstDateOf(new Date()).slice(0, 7);
  const spaces = await listSpaces(db);
  const space = spaces.find((s) => s.id === sp.space) ?? null;
  const { apps, blocks } = await getMonthSchedule(db, month, space?.id ?? null);
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (d: number) => {
    const x = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const qs = (mo: string) => `/admin/calendar?${new URLSearchParams({ month: mo, ...(space ? { space: space.id } : {}) }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="대관 캘린더" description="결제대기·심사중·확정 신청과 기념관 일정 차단을 공간별로 봅니다." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={qs(shift(-1))} className="btn-ghost" aria-label="이전 달">
            ‹
          </Link>
          <span className="font-semibold text-navy">
            {y}년 {m}월
          </span>
          <Link href={qs(shift(1))} className="btn-ghost" aria-label="다음 달">
            ›
          </Link>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <input type="hidden" name="month" value={month} />
          <label htmlFor="space" className="text-muted">
            공간
          </label>
          <select id="space" name="space" defaultValue={space?.id ?? ""} className="input w-auto py-1">
            <option value="">전체</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost px-2 py-1 text-xs">
            보기
          </button>
        </form>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <div key={w} className="bg-cream py-1 text-center text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: weekdayOf(first) }, (_, i) => (
          <div key={`e${i}`} className="bg-white" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = addDays(first, i);
          const dayApps = apps.filter((a) => kstDateOf(a.startsAt) === date);
          const dayBlocks = blocks.filter((b) => kstDateOf(b.startsAt) <= date && kstDateOf(new Date(b.endsAt.getTime() - 1)) >= date);
          return (
            <div key={date} className="min-h-24 bg-white p-1">
              <p className="mb-1 font-medium">{i + 1}</p>
              <ul className="flex flex-col gap-0.5">
                {dayBlocks.map((b) => (
                  <li key={b.id} className="truncate rounded bg-cream-dark px-1 text-muted" title={b.reason}>
                    ■ {b.reason}
                  </li>
                ))}
                {dayApps.map((a) => (
                  <li key={a.applicationNo}>
                    <Link
                      href={`/admin/applications/${a.applicationNo}`}
                      title={`${a.spaceName} ${formatKst(a.startsAt).slice(-5)} ${a.orgName} (${statusLabels[a.status]})`}
                      className={`block truncate rounded px-1 ${tone[a.status] ?? "bg-brick/10 text-brick"}`}
                    >
                      {formatKst(a.startsAt).slice(-5)} {space ? "" : `${a.spaceName} `}
                      {a.orgName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">초록: 예약확정 · 주황: 결제대기·보완요청 · 붉은색: 신청접수·검토중 · 회색: 기념관 일정</p>
    </div>
  );
}
