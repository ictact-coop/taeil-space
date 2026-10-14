import { describe, expect, it } from "vitest";
import { describeReceipt, parseReceiptRequest } from "./receipt";

describe("증빙 발행 희망", () => {
  it("선택 안 하면 null", () => {
    expect(parseReceiptRequest({ receiptType: "" })).toEqual({ ok: true, value: null });
    expect(parseReceiptRequest({ receiptType: "none", cashNumber: "아무거나" })).toEqual({ ok: true, value: null });
  });
  it("현금영수증: 소득공제는 휴대전화, 지출증빙은 사업자번호", () => {
    expect(parseReceiptRequest({ receiptType: "cash", cashPurpose: "income", cashNumber: "010-1234-5678" })).toEqual({ ok: true, value: { type: "cash", purpose: "income", number: "01012345678" } });
    expect(parseReceiptRequest({ receiptType: "cash", cashPurpose: "income", cashNumber: "02-123-4567" })).toMatchObject({ ok: false, errors: { cashNumber: expect.any(String) } });
    expect(parseReceiptRequest({ receiptType: "cash", cashPurpose: "expense", cashNumber: "123-82-87650" })).toEqual({ ok: true, value: { type: "cash", purpose: "expense", number: "1238287650" } });
    expect(parseReceiptRequest({ receiptType: "cash", cashPurpose: "expense", cashNumber: "124-81-00997" })).toMatchObject({ ok: false });
  });
  it("세금계산서: 필수 항목 확인", () => {
    const r = parseReceiptRequest({ receiptType: "tax_invoice", taxBizNo: "123-82-87650", taxCompany: "○○협동조합", taxCeo: "홍길동", taxEmail: "Tax@Example.org", taxBizType: "서비스", taxBizItem: "교육" });
    expect(r).toEqual({ ok: true, value: { type: "tax_invoice", bizNo: "1238287650", company: "○○협동조합", ceo: "홍길동", email: "tax@example.org", address: "", bizType: "서비스", bizItem: "교육" } });
    if (r.ok) expect(describeReceipt(r.value)).toBe("세금계산서 · 123-82-87650 · ○○협동조합 · 대표 홍길동 · tax@example.org · 서비스/교육");
    expect(parseReceiptRequest({ receiptType: "tax_invoice", taxBizNo: "1", taxEmail: "x" })).toMatchObject({ ok: false, errors: { taxBizNo: expect.any(String), taxCompany: expect.any(String), taxCeo: expect.any(String), taxEmail: expect.any(String) } });
  });
});
