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
    "행사명", "예상 인원", "행사 목적·내용", "금액(원, 부가세 포함)", "감면", "결제 방식", "받은 금액(원)", "환불 완료(원)", "환불 처리 중(원)",
    "입금·결제 확인", "신청일시", "증빙 발행 희망", "문자 수신 동의", "노션에서 가져옴",
  ];
  const lines = rows.map(({ app, spaceName, org, method, paidAmount, refundedAmount, refundPendingAmount }) => {
    const discount = (app.policySnapshot as { discount?: { name: string } | null } | null)?.discount?.name ?? "";
    const receipt = app.receiptRequest as ReceiptRequest | null;
    return [
      app.applicationNo,
      statusLabels[app.status],
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
      paidAmount,
      refundedAmount,
      refundPendingAmount,
      app.paidAt ? formatKst(app.paidAt) : "",
      formatKst(app.submittedAt ?? app.createdAt),
      !receipt ? "" : receipt.type === "cash" ? "현금영수증" : "세금계산서",
      consentAt(app) ? "동의" : "",
      app.importRef ? "예" : "",
    ];
  });
  return toCsv([header, ...lines]);
}

/** 부가세 포함 금액을 공급가액·세액으로 나눈다(공급가액은 원 단위 반올림) */
export function splitVat(total: number): { supply: number; vat: number } {
  const supply = Math.round(total / 1.1);
  return { supply, vat: total - supply };
}

/**
 * 현금영수증·세금계산서 발행 정보 내려받기: 필터에 맞는 신청 중 발행을 희망한 건만.
 * 발행 금액 = 받은 금액 − 환불(완료·처리 중). 아직 입금 전이면 신청 금액을 적고 '입금 전'으로 표시한다.
 */
export function receiptsCsv(rows: ExportRow[]): string {
  const header = [
    "구분", "신청번호", "상태", "입금 확인", "이용일", "공간", "단체명", "담당자", "담당자 휴대전화",
    "현금영수증 용도", "현금영수증 번호(휴대전화·사업자번호)",
    "사업자등록번호", "상호(법인명)", "대표자", "받을 이메일", "사업장 주소", "업태", "종목",
    "발행 금액(원, 합계)", "공급가액(원)", "세액(원)", "품목", "비고",
  ];
  const lines = rows
    .filter((r) => r.app.receiptRequest)
    .map(({ app, spaceName, paidAmount, refundedAmount, refundPendingAmount }) => {
      const r = app.receiptRequest as ReceiptRequest;
      const paid = paidAmount > 0;
      const amount = paid ? paidAmount - refundedAmount - refundPendingAmount : (app.totalAmount ?? 0);
      const { supply, vat } = splitVat(amount);
      const note = [!paid ? "입금 전" : "", refundedAmount + refundPendingAmount > 0 ? `환불 ${(refundedAmount + refundPendingAmount).toLocaleString("ko-KR")}원 반영` : ""].filter(Boolean).join(", ");
      const base = [statusLabels[app.status], app.paidAt ? formatKst(app.paidAt) : "", kstDateOf(app.startsAt), spaceName, app.orgName, app.contactName, phone(app.contactPhone)];
      const item = `대관료(${spaceName}, ${kstDateOf(app.startsAt)})`;
      if (r.type === "cash") {
        const number = r.purpose === "income" ? phone(r.number) : formatRegNo(r.number);
        return ["현금영수증", app.applicationNo, ...base, r.purpose === "income" ? "소득공제" : "지출증빙", number, "", "", "", "", "", "", "", amount, supply, vat, item, note];
      }
      return ["세금계산서", app.applicationNo, ...base, "", "", formatRegNo(r.bizNo), r.company, r.ceo, r.email, r.address, r.bizType, r.bizItem, amount, supply, vat, item, note];
    });
  return toCsv([header, ...lines]);
}
