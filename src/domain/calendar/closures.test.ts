import { describe, expect, it } from "vitest";
import { effectiveBookingWindow } from "./booking-window";
import { closureInputSchema } from "./closure-input";
import { addDays, closedDatesBetween, describeClosureRule, evaluateClosure, weekdayOf, type ClosureRule } from "./closures";

let seq = 0;
const rule = (r: Partial<ClosureRule> & Pick<ClosureRule, "type">): ClosureRule => ({
  id: `r${++seq}`,
  name: r.type,
  publicMessage: "",
  spaceId: null,
  weekday: null,
  month: null,
  day: null,
  startDate: null,
  endDate: null,
  activeFrom: null,
  activeUntil: null,
  isActive: true,
  ...r,
});

const monday = rule({ type: "weekly", weekday: 1, name: "월요일" });
const newYear = rule({ type: "annual", month: 1, day: 1, name: "신정" });

describe("날짜 도우미", () => {
  it("요일과 날짜 더하기", () => {
    expect(weekdayOf("2026-10-26")).toBe(1); // 월요일
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("evaluateClosure (BR-01, AT-01)", () => {
  it("정기 휴관 요일", () => {
    expect(evaluateClosure("2026-10-26", null, [monday])).toMatchObject({ closed: true, rule: { name: "월요일" } });
    expect(evaluateClosure("2026-10-27", null, [monday]).closed).toBe(false);
  });

  it("매년 같은 날", () => {
    expect(evaluateClosure("2027-01-01", null, [newYear]).closed).toBe(true);
    expect(evaluateClosure("2027-01-02", null, [newYear]).closed).toBe(false);
  });

  it("2월 29일 규칙은 윤년에만 걸린다", () => {
    const leap = rule({ type: "annual", month: 2, day: 29 });
    expect(evaluateClosure("2028-02-29", null, [leap]).closed).toBe(true);
    expect(closedDatesBetween("2027-02-01", "2027-03-01", null, [leap])).toEqual([]);
  });

  it("특정 기간은 시작·종료일을 포함한다", () => {
    const seollal = rule({ type: "date_range", startDate: "2027-02-06", endDate: "2027-02-08", name: "설" });
    expect(closedDatesBetween("2027-02-05", "2027-02-09", null, [seollal]).map((d) => d.date)).toEqual(["2027-02-06", "2027-02-07", "2027-02-08"]);
  });

  it("예외 개관일이 다른 모든 규칙보다 우선한다", () => {
    const open = rule({ type: "open_exception", startDate: "2026-10-26", endDate: "2026-10-26", name: "특별 개관" });
    expect(evaluateClosure("2026-10-26", null, [monday, open])).toMatchObject({ closed: false, openedBy: { name: "특별 개관" } });
  });

  it("공간 전용 규칙은 그 공간에만 적용된다", () => {
    const hallOnly = rule({ type: "date_range", startDate: "2026-11-03", endDate: "2026-11-03", spaceId: "hall" });
    expect(evaluateClosure("2026-11-03", "hall", [hallOnly]).closed).toBe(true);
    expect(evaluateClosure("2026-11-03", "seminar", [hallOnly]).closed).toBe(false);
    expect(evaluateClosure("2026-11-03", null, [hallOnly]).closed).toBe(false);
  });

  it("공간 전용 예외 개관일은 전체 휴관 요일을 그 공간에서만 연다", () => {
    const open = rule({ type: "open_exception", startDate: "2026-10-26", endDate: "2026-10-26", spaceId: "hall" });
    expect(evaluateClosure("2026-10-26", "hall", [monday, open]).closed).toBe(false);
    expect(evaluateClosure("2026-10-26", "seminar", [monday, open]).closed).toBe(true);
  });

  it("규칙 적용 기간과 꺼진 규칙", () => {
    const tuesdayFrom2027 = rule({ type: "weekly", weekday: 2, activeFrom: "2027-01-01" });
    expect(evaluateClosure("2026-12-29", null, [tuesdayFrom2027]).closed).toBe(false);
    expect(evaluateClosure("2027-01-05", null, [tuesdayFrom2027]).closed).toBe(true);
    expect(evaluateClosure("2026-10-26", null, [{ ...monday, isActive: false }]).closed).toBe(false);
  });

  it("규칙 요약 문구", () => {
    expect(describeClosureRule(monday)).toBe("매주 월요일");
    expect(describeClosureRule(newYear)).toBe("매년 1월 1일");
  });
});

describe("closureInputSchema", () => {
  const base = { name: "설", publicMessage: "휴관", spaceId: "", weekday: "", month: "", day: "", startDate: "", endDate: "", activeFrom: "", activeUntil: "" };
  it("유형별 필수 칸을 검사한다", () => {
    expect(closureInputSchema.safeParse({ ...base, type: "date_range" }).success).toBe(false);
    expect(closureInputSchema.safeParse({ ...base, type: "annual", month: "4", day: "31" }).success).toBe(false);
    expect(closureInputSchema.safeParse({ ...base, type: "date_range", startDate: "2027-02-08", endDate: "2027-02-06" }).success).toBe(false);
  });
  it("유형과 무관한 칸은 비운다", () => {
    const r = closureInputSchema.parse({ ...base, type: "weekly", weekday: "1", startDate: "2027-01-01" });
    expect(r).toMatchObject({ weekday: 1, startDate: null, spaceId: null });
  });
});

describe("effectiveBookingWindow (AT-04)", () => {
  it("자동 방식은 오늘부터 N일", () => {
    expect(effectiveBookingWindow({ mode: "auto", autoDays: 14, manual: null, today: "2026-10-06" })).toEqual({ from: "2026-10-06", until: "2026-10-20" });
  });
  it("수동 방식은 공개 기간 중 오늘 이후만", () => {
    const manual = { opensFrom: "2026-10-01", opensUntil: "2026-10-14" };
    expect(effectiveBookingWindow({ mode: "manual", autoDays: 14, manual, today: "2026-10-06" })).toEqual({ from: "2026-10-06", until: "2026-10-14" });
    expect(effectiveBookingWindow({ mode: "manual", autoDays: 14, manual, today: "2026-10-15" })).toBeNull();
    expect(effectiveBookingWindow({ mode: "manual", autoDays: 14, manual: null, today: "2026-10-06" })).toBeNull();
  });
});
