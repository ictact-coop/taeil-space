import { describe, expect, it } from "vitest";
import { crossValidate } from "./cross-validate";
import { resolveAll } from "./resolve";
import type { SettingValues } from "./definitions";

const defaults = () => resolveAll([], new Date()).values;
const withValues = (overrides: Partial<SettingValues>): SettingValues => ({ ...defaults(), ...overrides });

describe("crossValidate", () => {
  it("기본값 조합에는 문제가 없다", () => {
    expect(crossValidate(defaults())).toEqual([]);
  });

  it("대관 시작이 주간 종료보다 늦으면 오류", () => {
    const issues = crossValidate(withValues({ "operation.dayStart": "19:00" }));
    expect(issues[0]?.keys).toContain("operation.dayStart");
  });

  it("야간 대관을 받지 않으면 야간 종료 시각은 검사하지 않는다", () => {
    expect(crossValidate(withValues({ "operation.nightEnabled": false, "operation.nightEnd": "17:00" }))).toEqual([]);
    expect(crossValidate(withValues({ "operation.nightEnd": "17:00" }))).toHaveLength(1);
  });

  it("계좌이체 방식에는 입금 계좌 안내가 필요하다", () => {
    expect(crossValidate(withValues({ "payment.method": "bankTransfer" }))[0]?.keys).toContain("payment.bankAccountInfo");
    expect(
      crossValidate(withValues({ "payment.method": "bankTransfer", "payment.bankAccountInfo": "○○은행 000-00" })),
    ).toEqual([]);
  });

  it("입금 기한 임박 알림은 입금 기한보다 짧아야 한다", () => {
    expect(
      crossValidate(withValues({ "payment.bankTransferHoldHours": 3, "notification.paymentDeadlineHours": 3 })),
    ).toHaveLength(1);
  });
});
