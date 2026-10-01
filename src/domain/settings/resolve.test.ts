import { describe, expect, it } from "vitest";
import { classifyHistory, pickEffectiveRow, resolveAll, resolveSetting, upcomingRows, type PolicyRow } from "./resolve";

const t = (iso: string) => new Date(iso);
const row = (id: number, key: string, value: unknown, effectiveFrom: string): PolicyRow => ({
  id,
  key,
  value,
  effectiveFrom: t(effectiveFrom),
});

describe("pickEffectiveRow", () => {
  const rows = [
    row(1, "k", 1, "2026-10-01T00:00:00Z"),
    row(2, "k", 2, "2026-11-01T00:00:00Z"),
    row(3, "k", 3, "2026-11-01T00:00:00Z"), // 같은 시각이면 나중 행(id 큰 행)이 이긴다
  ];

  it("기준 시각 이전의 가장 최근 행을 고른다", () => {
    expect(pickEffectiveRow(rows, t("2026-10-15T00:00:00Z"))?.id).toBe(1);
  });
  it("적용 시각 정각부터 적용된다", () => {
    expect(pickEffectiveRow(rows, t("2026-11-01T00:00:00Z"))?.id).toBe(3);
  });
  it("아무 행도 적용 전이면 null", () => {
    expect(pickEffectiveRow(rows, t("2026-09-01T00:00:00Z"))).toBeNull();
  });
});

describe("resolveSetting", () => {
  it("저장된 값이 없으면 기본값", () => {
    const r = resolveSetting("payment.pgHoldMinutes", [], new Date());
    expect(r).toMatchObject({ value: 30, source: "default", invalidStored: false });
  });

  it("저장된 값을 적용한다", () => {
    const r = resolveSetting("payment.pgHoldMinutes", [row(1, "payment.pgHoldMinutes", 45, "2026-01-01T00:00:00Z")], new Date());
    expect(r).toMatchObject({ value: 45, source: "stored" });
  });

  it("저장된 값이 현재 정의의 허용 범위를 벗어나면 기본값으로 대체하고 표시한다", () => {
    const r = resolveSetting("payment.pgHoldMinutes", [row(1, "payment.pgHoldMinutes", 9999, "2026-01-01T00:00:00Z")], new Date());
    expect(r).toMatchObject({ value: 30, source: "default", invalidStored: true });
  });

  it("다른 키의 행은 무시한다", () => {
    const r = resolveSetting("payment.pgHoldMinutes", [row(1, "payment.bankTransferHoldHours", 48, "2026-01-01T00:00:00Z")], new Date());
    expect(r.source).toBe("default");
  });
});

describe("resolveAll", () => {
  it("모든 설정 키에 값이 채워진다", () => {
    const { values } = resolveAll([], new Date());
    expect(values["operation.dayStart"]).toBe("10:00");
    expect(values["notification.staffEmails"]).toEqual([]);
  });
});

describe("upcomingRows", () => {
  it("기준 시각 이후의 예약만, 같은 시각은 최종 행만 시간순으로 돌려준다", () => {
    const rows = [
      row(1, "k", "a", "2026-10-01T00:00:00Z"),
      row(2, "k", "b", "2026-12-01T00:00:00Z"),
      row(3, "k", "c", "2026-11-01T00:00:00Z"),
      row(4, "k", "d", "2026-11-01T00:00:00Z"),
      row(5, "other", "x", "2026-11-01T00:00:00Z"),
    ];
    expect(upcomingRows(rows, "k", t("2026-10-15T00:00:00Z"), "z").map((r) => r.id)).toEqual([4, 2]);
  });

  it("취소된 예약(직전 값과 같은 행)은 뺀다", () => {
    const rows = [row(1, "k", 90, "2026-11-01T00:00:00Z"), row(2, "k", 100, "2026-11-01T00:00:00Z")];
    expect(upcomingRows(rows, "k", t("2026-10-15T00:00:00Z"), 100)).toEqual([]);
  });
});

describe("classifyHistory", () => {
  const now = t("2026-10-10T00:00:00Z");
  it("적용 중·과거·예약·취소·대체를 구분한다", () => {
    const rows = [
      row(1, "k", 50, "2026-10-01T00:00:00Z"), // 과거
      row(2, "k", 60, "2026-10-05T00:00:00Z"), // 적용 중
      row(3, "k", 90, "2026-11-01T00:00:00Z"), // 같은 시각의 나중 행(4)에 대체됨
      row(4, "k", 60, "2026-11-01T00:00:00Z"), // 직전 값과 같음 → 취소된 예약
      row(5, "k", 70, "2026-12-01T00:00:00Z"), // 예약
    ];
    const status = classifyHistory(rows, now, 100);
    expect(Object.fromEntries(status)).toEqual({ 1: "past", 2: "active", 3: "superseded", 4: "cancelled", 5: "scheduled" });
  });

  it("저장된 값이 없던 설정의 예약을 취소하면 기본값과 비교한다", () => {
    const rows = [row(1, "k", 90, "2026-11-01T00:00:00Z"), row(2, "k", 100, "2026-11-01T00:00:00Z")];
    expect(Object.fromEntries(classifyHistory(rows, now, 100))).toEqual({ 1: "superseded", 2: "cancelled" });
  });
});
