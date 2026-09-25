import { describe, expect, it } from "vitest";
import { getDefinition, settingKeys } from "./definitions";

describe("설정 정의", () => {
  it("모든 기본값이 자기 정의의 검증을 통과한다", () => {
    for (const key of settingKeys) {
      const def = getDefinition(key);
      expect(def.schema.safeParse(def.defaultValue).success, key).toBe(true);
    }
  });

  it("모든 기본값은 폼 문자열로 바꿨다가 다시 읽어도 같다", () => {
    for (const key of settingKeys) {
      const def = getDefinition(key);
      const parsed = def.parse(def.toInput(def.defaultValue));
      expect(parsed, key).toEqual({ ok: true, value: def.defaultValue });
    }
  });
});

describe("폼 값 해석", () => {
  it("정수: 범위와 형식을 검사한다", () => {
    const def = getDefinition("payment.pgHoldMinutes");
    expect(def.parse("45")).toEqual({ ok: true, value: 45 });
    expect(def.parse("4")).toMatchObject({ ok: false });
    expect(def.parse("3.5")).toMatchObject({ ok: false });
    expect(def.parse("")).toMatchObject({ ok: false });
    expect(def.parse("abc")).toMatchObject({ ok: false });
  });

  it("비율: 0~100", () => {
    const def = getDefinition("payment.withdrawRefundPercent");
    expect(def.parse("0")).toEqual({ ok: true, value: 0 });
    expect(def.parse("101")).toMatchObject({ ok: false });
  });

  it("불리언: true/false 외 값은 거부", () => {
    const def = getDefinition("application.onePerOrgPerDay");
    expect(def.parse("false")).toEqual({ ok: true, value: false });
    expect(def.parse("yes")).toMatchObject({ ok: false });
  });

  it("선택지: 목록에 없는 값은 거부", () => {
    const def = getDefinition("payment.method");
    expect(def.parse("bankTransfer")).toEqual({ ok: true, value: "bankTransfer" });
    expect(def.parse("cash")).toMatchObject({ ok: false });
  });

  it("시각: HH:MM", () => {
    const def = getDefinition("operation.dayStart");
    expect(def.parse("09:30")).toEqual({ ok: true, value: "09:30" });
    expect(def.parse("9:30")).toMatchObject({ ok: false });
    expect(def.parse("25:00")).toMatchObject({ ok: false });
  });

  it("날짜: 존재하지 않는 날짜는 거부", () => {
    const def = getDefinition("operation.paidRentalStartDate");
    expect(def.parse("2026-11-01")).toEqual({ ok: true, value: "2026-11-01" });
    expect(def.parse("2026-02-30")).toMatchObject({ ok: false });
  });

  it("월-일: 2월 29일은 허용, 4월 31일은 거부", () => {
    const def = getDefinition("operation.winterEnd");
    expect(def.parse("02-29")).toEqual({ ok: true, value: "02-29" });
    expect(def.parse("04-31")).toMatchObject({ ok: false });
  });

  it("목록: 정규화하고 중복·형식 오류를 거부", () => {
    const ext = getDefinition("application.attachmentExtensions");
    expect(ext.parse(".PDF, hwp ,")).toEqual({ ok: true, value: ["pdf", "hwp"] });
    expect(ext.parse("pdf, pdf")).toMatchObject({ ok: false });
    expect(ext.parse("p d f")).toMatchObject({ ok: false });

    const emails = getDefinition("notification.staffEmails");
    expect(emails.parse("A@Taeil.org\nb@taeil.org")).toEqual({ ok: true, value: ["a@taeil.org", "b@taeil.org"] });
    expect(emails.parse("not-an-email")).toMatchObject({ ok: false });
    expect(emails.parse("")).toEqual({ ok: true, value: [] });
  });

  it("필수 텍스트: 빈 값 거부", () => {
    expect(getDefinition("operation.reviewPeriodText").parse("  ")).toMatchObject({ ok: false });
  });
});
