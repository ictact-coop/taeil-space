import { formatRegNo, isValidBusinessNoChecksum, normalizeRegNo } from "@/domain/organization/reg-no";

/**
 * 증빙 발행 희망(현금영수증·세금계산서). 신청서에서 선택 입력하고, 담당자가 입금 확인 후 홈택스 등에서 발행한다.
 * 현금영수증: 소득공제용(휴대전화 번호) 또는 지출증빙용(사업자등록번호)
 * 세금계산서: 사업자등록번호·상호·대표자·받을 이메일(필수), 주소·업태·종목(선택)
 */
export type ReceiptRequest =
  | { type: "cash"; purpose: "income" | "expense"; number: string }
  | { type: "tax_invoice"; bizNo: string; company: string; ceo: string; email: string; address: string; bizType: string; bizItem: string };

export const RECEIPT_FIELDS = ["receiptType", "cashPurpose", "cashNumber", "taxBizNo", "taxCompany", "taxCeo", "taxEmail", "taxAddress", "taxBizType", "taxBizItem"] as const;
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

export function receiptRawFromForm(form: FormData): Record<ReceiptField, string> {
  return Object.fromEntries(RECEIPT_FIELDS.map((k) => [k, String(form.get(k) ?? "").trim()])) as Record<ReceiptField, string>;
}

export function parseReceiptRequest(
  raw: Partial<Record<ReceiptField, string>>,
): { ok: true; value: ReceiptRequest | null } | { ok: false; errors: Partial<Record<ReceiptField, string>> } {
  const v = (k: ReceiptField) => (raw[k] ?? "").trim();
  const type = v("receiptType");
  if (type === "" || type === "none") return { ok: true, value: null };
  const errors: Partial<Record<ReceiptField, string>> = {};
  if (type === "cash") {
    const purpose = v("cashPurpose") === "expense" ? "expense" : "income";
    const digits = v("cashNumber").replace(/[\s-]/g, "");
    if (purpose === "income" && !/^01\d{8,9}$/.test(digits)) errors.cashNumber = "현금영수증을 받을 휴대전화 번호를 확인하세요(예: 010-1234-5678).";
    if (purpose === "expense" && !isValidBusinessNoChecksum(digits)) errors.cashNumber = "지출증빙용은 사업자등록번호 10자리를 입력하세요.";
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { type: "cash", purpose, number: digits } };
  }
  if (type === "tax_invoice") {
    const bizNo = normalizeRegNo(v("taxBizNo"));
    if (!isValidBusinessNoChecksum(bizNo)) errors.taxBizNo = "사업자등록번호를 확인하세요(숫자 10자리).";
    if (!v("taxCompany")) errors.taxCompany = "상호(법인명)를 입력하세요.";
    if (!v("taxCeo")) errors.taxCeo = "대표자 이름을 입력하세요.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("taxEmail"))) errors.taxEmail = "세금계산서를 받을 이메일을 확인하세요.";
    for (const [k, max] of [["taxCompany", 100], ["taxCeo", 50], ["taxEmail", 200], ["taxAddress", 200], ["taxBizType", 50], ["taxBizItem", 50]] as const) {
      if (v(k).length > max) errors[k] = `${max}자 이하로 입력하세요.`;
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      value: { type: "tax_invoice", bizNo, company: v("taxCompany"), ceo: v("taxCeo"), email: v("taxEmail").toLowerCase(), address: v("taxAddress"), bizType: v("taxBizType"), bizItem: v("taxBizItem") },
    };
  }
  return { ok: false, errors: { receiptType: "증빙 종류를 다시 고르세요." } };
}

/** 관리자 화면·메일용 한 줄 요약 */
export function describeReceipt(r: ReceiptRequest | null | undefined): string {
  if (!r) return "";
  if (r.type === "cash") {
    const n = r.purpose === "income" ? r.number.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : formatRegNo(r.number);
    return `현금영수증(${r.purpose === "income" ? "소득공제" : "지출증빙"}) · ${n}`;
  }
  return [`세금계산서 · ${formatRegNo(r.bizNo)} · ${r.company} · 대표 ${r.ceo} · ${r.email}`, r.address, [r.bizType, r.bizItem].filter(Boolean).join("/")]
    .filter(Boolean)
    .join(" · ");
}
