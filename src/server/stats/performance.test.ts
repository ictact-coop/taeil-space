import { describe, expect, it } from "vitest";
import { monthBuckets, parseReportParams, weekBuckets } from "./performance";

describe("통계 기간 나누기", () => {
  it("월: 1일 00:00 KST부터 다음 달 1일 전까지", () => {
    const months = monthBuckets(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ key: "2026-01-01", label: "1월", range: "1/1~1/31" });
    expect(months[0]!.from.toISOString()).toBe("2025-12-31T15:00:00.000Z");
    expect(months[1]!.range).toBe("2/1~2/28");
    expect(months[11]!.to.toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });

  it("주: 월요일 시작, 목요일이 있는 달의 주", () => {
    // 2026-10-01은 목요일 → 9/28 주가 10월 1주
    expect(weekBuckets(2026, 10).map((w) => `${w.label} ${w.range}`)).toEqual([
      "10월 1주 9/28~10/4",
      "10월 2주 10/5~10/11",
      "10월 3주 10/12~10/18",
      "10월 4주 10/19~10/25",
      "10월 5주 10/26~11/1",
    ]);
    // 9월은 8/31 주부터 9/21 주까지 (9/28 주는 10월)
    expect(weekBuckets(2026, 9).map((w) => w.key)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    // 해를 넘는 주: 2026-01-01(목) → 2025-12-29 주가 1월 1주
    expect(weekBuckets(2026, 1)[0]).toMatchObject({ key: "2025-12-29", label: "1월 1주" });
    // 2030-03-01은 금요일 → 2/25 주는 2월, 3월 1주는 3/4
    expect(weekBuckets(2030, 3)[0]!.key).toBe("2030-03-04");
    expect(weekBuckets(2030, 3)[0]!.from.toISOString()).toBe("2030-03-03T15:00:00.000Z");
  });

  it("주소 값 검사: 잘못된 값은 오늘(KST) 기준", () => {
    const now = new Date("2026-12-31T16:00:00Z"); // KST 2027-01-01 01:00
    expect(parseReportParams({}, now)).toEqual({ granularity: "month", year: 2027 });
    expect(parseReportParams({ view: "week", year: "2026", month: "13" }, now)).toEqual({ granularity: "week", year: 2026, month: 1 });
    expect(parseReportParams({ view: "week", year: "1999", month: "3" }, now)).toEqual({ granularity: "week", year: 2027, month: 3 });
    expect(parseReportParams({ view: "month", year: "2026; drop" }, now)).toEqual({ granularity: "month", year: 2027 });
  });
});
