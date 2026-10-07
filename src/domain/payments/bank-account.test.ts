import { describe, expect, it } from "vitest";
import { extractAccountNumber } from "./bank-account";

describe("입금 계좌 안내에서 계좌번호 찾기", () => {
  it("은행·예금주가 섞인 문구에서 계좌번호만", () => {
    expect(extractAccountNumber("국민은행 123456-01-234567 (예금주 전태일재단)")).toBe("123456-01-234567");
    expect(extractAccountNumber("농협 301-1234-5678-91\n예금주: 전태일재단")).toBe("301-1234-5678-91");
    expect(extractAccountNumber("신한 110123456789")).toBe("110123456789");
  });
  it("전화번호는 건너뛰고, 없으면 null", () => {
    expect(extractAccountNumber("문의 02-318-0903, 우리은행 1005-123-456789")).toBe("1005-123-456789");
    expect(extractAccountNumber("기념관에서 따로 안내합니다. 문의 02-318-0903")).toBeNull();
    expect(extractAccountNumber("")).toBeNull();
  });
});
