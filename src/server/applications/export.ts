import type { ReceiptRequest } from "@/domain/booking/receipt";
import { formatRegNo, regTypeLabels } from "@/domain/organization/reg-no";
import { toCsv } from "@/lib/csv";
import { formatKst, kstDateOf } from "@/lib/time";
import type { listApplicationsForExport } from "./admin-queries";
import { statusLabels } from "./transition";

type ExportRow = Awaited<ReturnType<typeof listApplicationsForExport>>[number];

const methodLabels = { pg: "카드(PG)", bank_transfer: "계좌이체", free: "0원" } as const;
const phone = (v: string) => v.replace(/^(01\d|02|0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
const time = (d: Date) => formatKst(d).slice(-5);
const consentAt = (app: ExportRow["app"]) => Boolean((app.consents as Record<string, string> | null)?.smsReceive);

/** 신청 목록 내려받기(필터 적용) */
export function applicationsCsv(rows: ExportRow[]): string {
  const header = [
    "신청번호", "상태", "공간", "이용일", "시작", "종료", "단체명", "단체번호 종류", "단체번호", "담당자", "휴대전화", "이메일",
    "행사명", "예상 인원", "행사 목적·내용", "금액(원, 부가세 포함)", "감면", "결제 방식", "받은 금액(원)", "입금·결제 누계(원)", "환불 완료(원)", "환불 처리 중(원)",
    "입금·결제 확인", "신청일시", "입금자명", "문자 수신 동의", "노션에서 가져옴",
    ...receiptHeaders,
  ];
  const lines = rows.map(({ app, spaceName, org, method, paidAmount, refundedAmount, refundPendingAmount, depositorName, isOverdue }) => {
    const discount = (app.policySnapshot as { discount?: { name: string } | null } | null)?.discount?.name ?? "";
    return [
      app.applicationNo,
      isOverdue ? "미입금" : statusLabels[app.status],
      spaceName,
      kstDateOf(app.startsAt),
      time(app.startsAt),
      time(app.endsAt),
      app.orgName,
      org ? regTypeLabels[org.regType] : "",
      org ? formatRegNo(org.regNo) : "",
      app.contactName,
      phone(app.contactPhone),
      app.contactEmail,
      app.eventTitle,
      app.expectedHeadcount,
      app.eventPurpose,
      app.totalAmount ?? 0,
      discount,
      method ? methodLabels[method] : "",
      Math.max(0, paidAmount - refundedAmount - refundPendingAmount),
      paidAmount,
      refundedAmount,
      refundPendingAmount,
      app.paidAt ? formatKst(app.paidAt) : "",
      formatKst(app.submittedAt ?? app.createdAt),
      depositorName,
      consentAt(app) ? "동의" : "",
      app.importRef ? "예" : "",
      ...receiptCells({ app, spaceName, paidAmount, refundedAmount, refundPendingAmount }),
    ];
  });
  return toCsv([header, ...lines]);
}

/** 부가세 포함 금액을 공급가액·세액으로 나눈다(공급가액은 원 단위 반올림) */
export function splitVat(total: number): { supply: number; vat: number } {
  const supply = Math.round(total / 1.1);
  return { supply, vat: total - supply };
}

const receiptHeaders = [
  "증빙 발행 희망", "현금영수증 용도", "현금영수증 번호(휴대전화·사업자번호)",
  "사업자등록번호", "상호(법인명)", "대표자", "받을 이메일", "사업장 주소", "업태", "종목",
  "발행 금액(원, 합계)", "공급가액(원)", "세액(원)", "품목", "증빙 비고",
];

/** 발행 금액은 받은 금액에서 완료·처리 중 환불을 뺀 금액. 입금 전에는 신청 금액을 표시한다. */
function receiptCells({ app, spaceName, paidAmount, refundedAmount, refundPendingAmount }: Pick<ExportRow, "app" | "spaceName" | "paidAmount" | "refundedAmount" | "refundPendingAmount">) {
  const r = app.receiptRequest as ReceiptRequest | null;
  if (!r) return ["미요청", ...Array<string>(receiptHeaders.length - 1).fill("")];
  const paid = paidAmount > 0;
  const amount = paid ? paidAmount - refundedAmount - refundPendingAmount : (app.totalAmount ?? 0);
  const { supply, vat } = splitVat(amount);
  const note = [!paid ? "입금 전" : "", refundedAmount + refundPendingAmount > 0 ? `환불 ${(refundedAmount + refundPendingAmount).toLocaleString("ko-KR")}원 반영` : ""].filter(Boolean).join(", ");
  const tail = [amount, supply, vat, `대관료(${spaceName}, ${kstDateOf(app.startsAt)})`, note];
  if (r.type === "cash") {
    const number = r.purpose === "income" ? phone(r.number) : formatRegNo(r.number);
    return ["현금영수증", r.purpose === "income" ? "소득공제" : "지출증빙", number, "", "", "", "", "", "", "", ...tail];
  }
  return ["세금계산서", "", "", formatRegNo(r.bizNo), r.company, r.ceo, r.email, r.address, r.bizType, r.bizItem, ...tail];
}
