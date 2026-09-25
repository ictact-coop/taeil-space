import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { listApplicationsForAdmin, statusTabs } from "@/server/applications/admin-queries";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "신청 관리" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, tab, tabCounts, pageSize } = await listApplicationsForAdmin(db, { tab: sp.tab ?? "todo", q: sp.q ?? "", page });
  const link = (params: Record<string, string>) => `/admin/applications?${new URLSearchParams({ tab, ...(sp.q ? { q: sp.q } : {}), ...params }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="신청 관리" description="결제가 끝난 신청을 심사하고 보완요청·반려·승인합니다. 반려하면 결제 금액이 자동으로 전액 환불됩니다." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="상태별 보기" className="flex flex-wrap gap-1">
          {statusTabs.map((t) => (
            <Link
              key={t.key}
              href={`/admin/applications?${new URLSearchParams({ tab: t.key, ...(sp.q ? { q: sp.q } : {}) }).toString()}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={`rounded px-3 py-1.5 text-sm ${t.key === tab ? "bg-navy text-white" : "bg-white text-ink hover:bg-cream"}`}
            >
              {t.label} <span className="text-xs opacity-80">{tabCounts[t.key] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label htmlFor="q" className="sr-only">
            검색
          </label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="신청번호·단체명·행사명·담당자" className="input w-64" />
          <button type="submit" className="btn-secondary">
            검색
          </button>
        </form>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2">신청번호</th>
              <th scope="col" className="px-4 py-2">단체 / 행사</th>
              <th scope="col" className="px-4 py-2">공간</th>
              <th scope="col" className="px-4 py-2">이용 일시</th>
              <th scope="col" className="px-4 py-2">금액</th>
              <th scope="col" className="px-4 py-2">상태</th>
              <th scope="col" className="px-4 py-2">결제·접수</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  해당하는 신청이 없습니다.
                </td>
              </tr>
            )}
            {rows.map(({ app, spaceName }) => (
              <tr key={app.id} className="hover:bg-cream/40">
                <td className="px-4 py-2">
                  <Link href={`/admin/applications/${app.applicationNo}`} className="font-medium text-navy underline">
                    {app.applicationNo}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{app.orgName}</div>
                  <div className="text-xs text-muted">{app.eventTitle}</div>
                </td>
                <td className="px-4 py-2">{spaceName}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs">
                  {formatKst(app.startsAt)}–{formatKst(app.endsAt).slice(-5)}
                </td>
                <td className="px-4 py-2">{formatWon(app.totalAmount ?? 0)}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={app.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{app.paidAt ? formatKst(app.paidAt) : formatKst(app.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        {page > 1 && (
          <Link href={link({ page: String(page - 1) })} className="btn-ghost">
            ‹ 이전
          </Link>
        )}
        {rows.length === pageSize && (
          <Link href={link({ page: String(page + 1) })} className="btn-ghost">
            다음 ›
          </Link>
        )}
      </div>
    </div>
  );
}
