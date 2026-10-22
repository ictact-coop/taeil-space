import { toCsv } from "@/lib/csv";
import { formatKst } from "@/lib/time";
import type { listRefunds } from "@/server/applications/admin-queries";
import { refundBasisLabels } from "./refunds";

type RefundRow = Awaited<ReturnType<typeof listRefunds>>[number];
const statusLabels = { requested: "처리 대기", failed: "실패(재처리 필요)", succeeded: "환불 완료" } as const;

export function refundsCsv(rows: RefundRow[]): string {
  return toCsv([
    ["신청번호", "단체명", "담당자", "환불 사유", "상세 사유", "환불 금액(원)", "환불률(%)", "결제 방식", "상태", "요청일시", "완료일시", "수동 처리 메모", "실패 사유"],
    ...rows.map(({ refund: r, payment: p, applicationNo, orgName, contactName }) => [
      applicationNo, orgName, contactName, refundBasisLabels[r.basis], r.reason, r.amount, r.ratePercent,
      p.method === "bank_transfer" ? "계좌이체(수동)" : p.method === "pg" ? "카드(PG)" : "0원",
      statusLabels[r.status], formatKst(r.createdAt), r.completedAt ? formatKst(r.completedAt) : "", r.manualNote, r.failureReason,
    ]),
  ]);
}
