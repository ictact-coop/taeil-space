import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { listRefundsNeedingAction } from "@/server/applications/admin-queries";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { refundBasisLabels } from "@/server/payments/refunds";

export const metadata: Metadata = { title: "환불 처리" };

export default async function RefundsPage() {
  await requireAdmin();
  const rows = await listRefundsNeedingAction(db);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="환불 처리" description="계좌이체 환불(담당자가 이체 후 완료 처리)과 PG 환불 실패 건입니다. 신청 상세에서 처리하세요." />
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
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  처리할 환불이 없습니다.
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
                  {r.status === "failed" ? <span className="text-danger">실패 — {r.failureReason}</span> : p.method === "bank_transfer" ? "이체 대기" : `처리 중 (${r.attemptCount}회 시도)`}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{formatKst(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
