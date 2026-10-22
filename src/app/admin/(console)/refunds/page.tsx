import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission } from "@/domain/auth/permissions";
import { PageHeader } from "@/components/admin/ui";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { listRefunds, normalizeRefundTab, refundTabs } from "@/server/applications/admin-queries";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { refundBasisLabels } from "@/server/payments/refunds";

export const metadata: Metadata = { title: "환불 처리" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("refunds.manage");
  const tab = normalizeRefundTab((await searchParams).tab);
  const rows = await listRefunds(db, tab);
  const canDownload = hasPermission(admin, "applications.download");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="환불 처리" description="처리 대기 중인 환불과 완료된 환불을 확인합니다. 환불 처리는 신청 상세에서 진행하세요." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="환불 상태별 보기" className="flex gap-1">
          {refundTabs.map((t) => (
            <Link key={t.key} href={`/admin/refunds?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
              className={`rounded px-3 py-1.5 text-sm ${t.key === tab ? "bg-navy text-white" : "bg-white text-ink hover:bg-cream"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        {canDownload && <a href={`/admin/api/refunds/export?tab=${tab}`} className="btn-secondary text-sm">환불 내역 내려받기(CSV)</a>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2">신청</th>
              <th scope="col" className="px-4 py-2">사유</th>
              <th scope="col" className="px-4 py-2">금액</th>
              <th scope="col" className="px-4 py-2">방식</th>
              <th scope="col" className="px-4 py-2">상태</th>
              <th scope="col" className="px-4 py-2">요청</th>
              <th scope="col" className="px-4 py-2">완료</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  {tab === "completed" ? "완료된 환불이 없습니다." : "처리할 환불이 없습니다."}
                </td>
              </tr>
            )}
            {rows.map(({ refund: r, payment: p, applicationNo, orgName }) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link href={`/admin/applications/${applicationNo}`} className="text-navy underline">
                    {applicationNo}
                  </Link>
                  <div className="text-xs text-muted">{orgName}</div>
                </td>
                <td className="px-4 py-2">{refundBasisLabels[r.basis]}</td>
                <td className="px-4 py-2">{formatWon(r.amount)}</td>
                <td className="px-4 py-2">{p.method === "bank_transfer" ? "계좌이체(수동)" : "카드(PG)"}</td>
                <td className="px-4 py-2">
                  {r.status === "succeeded" ? "환불 완료" : r.status === "failed" ? <span className="text-danger">실패 — {r.failureReason}</span> : p.method === "bank_transfer" ? "이체 대기" : `처리 중 (${r.attemptCount}회 시도)`}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{formatKst(r.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{r.completedAt ? formatKst(r.completedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
