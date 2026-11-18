import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission } from "@/domain/auth/permissions";
import { pageNumbers } from "@/lib/pagination";
import { Notice, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { listApplicationsForAdmin, normalizeAdminFilter, receiptFilters, statusTabs, type SortKey } from "@/server/applications/admin-queries";
import { ProtectedDownload } from "@/components/admin/protected-download";
import { receiptKindLabel, type ReceiptRequest } from "@/domain/booking/receipt";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { spaces } from "@/server/db/schema";

export const metadata: Metadata = { title: "신청 관리" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string; space?: string; receipt?: string; sort?: string; dir?: string; page?: string; done?: string }> }) {
  const admin = await requireAdmin("applications.view");
  const canDownload = hasPermission(admin, "applications.download");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = normalizeAdminFilter({ tab: sp.tab, q: sp.q, from: sp.from, to: sp.to, spaceId: sp.space, receipt: sp.receipt, sort: sp.sort, dir: sp.dir });
  const [{ rows, tab, tabCounts, pageCount, total }, spaceList] = await Promise.all([
    listApplicationsForAdmin(db, { ...filter, page }),
    db.select({ id: spaces.id, name: spaces.name }).from(spaces).orderBy(spaces.sortOrder, spaces.name),
  ]);
  // 탭·페이지를 바꿔도 검색어·기간·공간 필터와 정렬은 유지한다
  const kept: Record<string, string> = Object.fromEntries(
    Object.entries({ q: filter.q, from: filter.from, to: filter.to, space: filter.spaceId }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const sorting: Record<string, string> = filter.sort ? { sort: filter.sort, dir: filter.dir ?? "desc" } : {};
  const receiptParam: Record<string, string> = filter.receipt ? { receipt: filter.receipt } : {};
  const link = (params: Record<string, string>) => `/admin/applications?${new URLSearchParams({ tab, ...kept, ...receiptParam, ...sorting, ...params }).toString()}`;
  const tabLink = (key: string, extra: Record<string, string> = {}) => `/admin/applications?${new URLSearchParams({ tab: key, ...kept, ...sorting, ...extra }).toString()}`;
  // 열 제목: 처음 누르면 최신순(큰 값부터), 다시 누르면 오래된 순
  const sortHref = (key: SortKey) => {
    const dir = filter.sort === key && filter.dir === "desc" ? "asc" : "desc";
    return `/admin/applications?${new URLSearchParams({ tab, ...kept, ...receiptParam, sort: key, dir }).toString()}`;
  };
  const sortHeader = (key: SortKey, label: string) => {
    const active = filter.sort === key;
    return (
      <th scope="col" className="px-4 py-2" aria-sort={active ? (filter.dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={sortHref(key)} className={`inline-flex items-center gap-1 hover:text-navy ${active ? "font-semibold text-navy" : ""}`} title="눌러서 정렬">
          {label}
          <span aria-hidden>{active ? (filter.dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </Link>
      </th>
    );
  };
  const filtered = Object.keys(kept).length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="신청 관리" description="입금을 확인하고 승인(예약 확정)하거나 반려합니다. 반려하면 받은 금액을 환불합니다(계좌이체는 담당자가 이체 후 완료 처리)." />
      {sp.done && (
        <div className="mb-4">
          <Notice kind="success">{sp.done}</Notice>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="상태별 보기" className="flex flex-wrap gap-1">
          {statusTabs.filter((t) => !t.onlyWhenNonEmpty || (tabCounts[t.key] ?? 0) > 0 || t.key === tab).map((t) =>
            t.key === "receipts" ? (
              // 증빙: 종류(전체·세금계산서·사전 발행·현금영수증)를 고르는 메뉴
              <details key={t.key} className="relative">
                <summary
                  aria-current={t.key === tab ? "page" : undefined}
                  className={`cursor-pointer list-none rounded px-3 py-1.5 text-sm ${t.key === tab ? "bg-navy text-white" : "bg-white text-ink hover:bg-cream"}`}
                >
                  {t.label}
                  {t.key === tab && filter.receipt ? `: ${receiptFilters.find((r) => r.key === filter.receipt)?.label}` : ""} ▾{" "}
                  <span className="text-xs opacity-80">{tabCounts[t.key] ?? 0}</span>
                </summary>
                <div className="absolute z-10 mt-1 flex min-w-56 flex-col rounded border border-line bg-white py-1 text-sm shadow-lg">
                  {receiptFilters.map((r) => (
                    <Link
                      key={r.key || "all"}
                      href={tabLink("receipts", r.key ? { receipt: r.key } : {})}
                      aria-current={tab === "receipts" && (filter.receipt ?? "") === r.key ? "true" : undefined}
                      className={`px-3 py-1.5 hover:bg-cream ${tab === "receipts" && (filter.receipt ?? "") === r.key ? "font-semibold text-navy" : ""}`}
                    >
                      {r.label}
                    </Link>
                  ))}
                </div>
              </details>
            ) : (
              <Link
                key={t.key}
                href={tabLink(t.key)}
                aria-current={t.key === tab ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm ${t.key === tab ? "bg-navy text-white" : "bg-white text-ink hover:bg-cream"}`}
              >
                {t.label} <span className="text-xs opacity-80">{tabCounts[t.key] ?? 0}</span>
              </Link>
            ),
          )}
        </nav>
        {canDownload && (
          <div className="flex flex-wrap gap-2">
            <ProtectedDownload action="/admin/api/applications/export" fields={{ tab, ...kept, ...receiptParam, ...sorting }} label="목록·증빙 정보 내려받기(엑셀)" />
          </div>
        )}
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        {filter.receipt && <input type="hidden" name="receipt" value={filter.receipt} />}
        {filter.sort && <input type="hidden" name="sort" value={filter.sort} />}
        {filter.sort && <input type="hidden" name="dir" value={filter.dir} />}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">검색</span>
          <input name="q" defaultValue={filter.q} placeholder="신청번호·단체명·행사명·담당자" className="input w-60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">이용일 시작</span>
          <input type="date" name="from" defaultValue={filter.from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">이용일 끝</span>
          <input type="date" name="to" defaultValue={filter.to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">공간</span>
          <select name="space" defaultValue={filter.spaceId ?? ""} className="input">
            <option value="">전체</option>
            {spaceList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          적용
        </button>
        {filtered && (
          <Link href={tabLink(tab, receiptParam)} className="btn-ghost">
            필터 지우기
          </Link>
        )}
        {canDownload && <span className="ml-auto self-center text-xs text-muted">내려받기는 지금 탭·필터·정렬을 그대로 적용합니다(페이지와 무관하게 전체). 파일에 비밀번호를 겁니다.</span>}
      </form>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              {sortHeader("no", "신청번호")}
              <th scope="col" className="px-4 py-2">단체 / 행사</th>
              <th scope="col" className="px-4 py-2">공간</th>
              {sortHeader("starts", "이용 일시")}
              <th scope="col" className="px-4 py-2">금액</th>
              <th scope="col" className="px-4 py-2">상태</th>
              {sortHeader("paid", "결제·접수")}
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
            {rows.map(({ app, spaceName, isOverdue }) => (
              <tr key={app.id} className="hover:bg-cream/40">
                <td className="px-4 py-2">
                  <Link href={`/admin/applications/${app.applicationNo}`} className="font-medium text-navy underline">
                    {app.applicationNo}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{app.orgName}</div>
                  <div className="text-xs text-muted">{app.eventTitle}</div>
                  {app.receiptRequest && <div className="mt-0.5 text-xs text-warning">증빙: {receiptKindLabel(app.receiptRequest as ReceiptRequest)}</div>}
                </td>
                <td className="px-4 py-2">{spaceName}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs">
                  {formatKst(app.startsAt)}–{formatKst(app.endsAt).slice(-5)}
                </td>
                <td className="px-4 py-2">{formatWon(app.totalAmount ?? 0)}</td>
                <td className="px-4 py-2">
                  {isOverdue ? <span className="badge bg-warning/10 text-warning">미입금</span> : <StatusBadge status={app.status} />}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{app.paidAt ? formatKst(app.paidAt) : formatKst(app.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="mt-3 flex flex-wrap items-center gap-1 text-sm" aria-label="페이지">
        {page > 1 && (
          <Link href={link({ page: String(page - 1) })} className="btn-ghost px-2">
            ‹ 이전
          </Link>
        )}
        {pageNumbers(page, pageCount).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden>
              …
            </span>
          ) : n === page ? (
            <span key={n} aria-current="page" className="min-w-8 rounded bg-navy px-2 py-1 text-center font-semibold text-white">
              {n}
            </span>
          ) : (
            <Link key={n} href={link({ page: String(n) })} className="min-w-8 rounded px-2 py-1 text-center text-navy hover:bg-cream">
              {n}
            </Link>
          ),
        )}
        {page < pageCount && (
          <Link href={link({ page: String(page + 1) })} className="btn-ghost px-2">
            다음 ›
          </Link>
        )}
        <span className="ml-auto text-xs text-muted">총 {total}건</span>
      </nav>
    </div>
  );
}

