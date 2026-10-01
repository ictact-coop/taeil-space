import { describe, expect, it } from "vitest";
import { isValidBusinessNoChecksum, normalizeRegNo, validateRegNo } from "@/domain/organization/reg-no";
import { calculatePrice } from "@/domain/pricing/calculate";
import type { ClosureRule } from "@/domain/calendar/closures";
import { checkBooking, checkDate, halfYearRange, type RuleContext } from "./rules";
import { slotStarts, toMinutes } from "./time";

describe("고유번호·사업자등록번호 (계획서 2.5)", () => {
  it("하이픈·공백을 빼고 10자리로 정규화", () => {
    expect(normalizeRegNo(" 123-45-67890 ")).toBe("1234567890");
  });
  it("사업자등록번호는 검증번호를 확인한다", () => {
    // 124-81-00998 은 검증번호가 맞는 번호, 마지막 자리를 바꾸면 틀림
    expect(isValidBusinessNoChecksum("1248100998")).toBe(true);
    expect(isValidBusinessNoChecksum("1248100997")).toBe(false);
    expect(validateRegNo("business_no", "124-81-00997")).toMatchObject({ ok: false });
  });
  it("고유번호는 형식(10자리)만 본다", () => {
    expect(validateRegNo("unique_no", "101-82-12345")).toEqual({ ok: true, digits: "1018212345" });
    expect(validateRegNo("unique_no", "101-82-1234")).toMatchObject({ ok: false });
  });
});

describe("요금 계산 ([요구] 16장)", () => {
  const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
  const dayEnd = toMinutes("18:00");

  it("기본시간 안이면 기본요금만", () => {
    const q = calculatePrice({ fee, startMinutes: toMinutes("14:00"), endMinutes: toMinutes("17:00"), dayEndMinutes: dayEnd });
    expect(q.total).toBe(60000);
    expect(q.items).toHaveLength(1);
  });

  it("추가시간은 단위로 올림하고, 야간은 분 단위 비례", () => {
    // 15:00~19:30 = 270분 → 추가 90분 → 2단위(40,000) / 야간 90분 → 15,000
    const q = calculatePrice({ fee, startMinutes: toMinutes("15:00"), endMinutes: toMinutes("19:30"), dayEndMinutes: dayEnd });
    expect(q.items.map((i) => [i.kind, i.amount])).toEqual([
      ["base", 60000],
      ["extra", 40000],
      ["night", 15000],
    ]);
    expect(q.total).toBe(115000);
  });

  it("옵션과 감면", () => {
    const options = [
      { key: "mic", name: "마이크", fee: 5000, unit: "per_booking" as const },
      { key: "beam", name: "빔", fee: 3000, unit: "per_hour" as const },
    ];
    const q = calculatePrice({
      fee,
      startMinutes: toMinutes("10:00"),
      endMinutes: toMinutes("13:00"),
      dayEndMinutes: dayEnd,
      options,
      selectedOptionKeys: ["mic", "beam"],
      discount: { name: "공익", kind: "percent", value: 50 },
    });
    expect(q.subtotal).toBe(60000 + 5000 + 9000);
    expect(q.discountAmount).toBe(37000);
    expect(q.total).toBe(37000);
  });

  it("금액 감면은 소계를 넘지 않는다(전액 감면 → 0원)", () => {
    const q = calculatePrice({ fee, startMinutes: 600, endMinutes: 780, dayEndMinutes: dayEnd, discount: { name: "전액", kind: "amount", value: 999999 } });
    expect(q.total).toBe(0);
  });
});

describe("운영시간 칸", () => {
  it("야간 포함 여부에 따라 마지막 칸이 달라진다", () => {
    const h = { dayStart: 600, dayEnd: 1080, nightEnabled: true, nightEnd: 1260 };
    expect(slotStarts(h, 60).at(-1)).toBe(1200); // 20:00
    expect(slotStarts({ ...h, nightEnabled: false }, 60).at(-1)).toBe(1020); // 17:00
  });
});

describe("신청 규칙 (BR-01~08, AT-01~05)", () => {
  const monday: ClosureRule = {
    id: "m", type: "weekly", name: "월요일", publicMessage: "매주 월요일은 휴관일입니다.", spaceId: null, weekday: 1,
    month: null, day: null, startDate: null, endDate: null, activeFrom: null, activeUntil: null, isActive: true,
  };
  const base: RuleContext = {
    today: "2026-10-29",
    nowMinutes: 600,
    paidRentalStartDate: "2026-10-29",
    hours: { dayStart: 600, dayEnd: 1080, nightEnabled: true, nightEnd: 1260 },
    space: { id: "hall", name: "공연장", capacity: 60, minHeadcount: 20, leadDays: 14, slotMinutes: 60, minDurationMinutes: 120, isPublic: true },
    closureRules: [monday],
    bookingWindow: null,
    overlaps: [],
    organization: null,
    rules: { onePerOrgPerDay: true, halfYearLimitEnabled: true, halfYearLimitCount: 2 },
  };
  const ok = { date: "2026-11-13", startMinutes: 600, endMinutes: 780, headcount: 30 };
  const codes = (r: ReturnType<typeof checkBooking>) => r.map((v) => v.code);

  it("조건을 모두 만족하면 위반 없음", () => {
    expect(checkBooking(ok, base)).toEqual([]);
  });
  it("AT-01 휴관일은 안내 문구와 함께 막는다", () => {
    const r = checkBooking({ ...ok, date: "2026-11-16" }, base);
    expect(r[0]).toMatchObject({ code: "BR-01", message: "매주 월요일은 휴관일입니다." });
  });
  it("AT-02 공연장 20명 미만·정원 초과를 막는다", () => {
    expect(codes(checkBooking({ ...ok, headcount: 19 }, base))).toEqual(["BR-08"]);
    expect(codes(checkBooking({ ...ok, headcount: 61 }, base))).toEqual(["BR-05"]);
  });
  it("AT-03 이용일 14일 전 규칙", () => {
    expect(codes(checkBooking({ ...ok, date: "2026-11-11" }, base))).toEqual(["LEAD_TIME"]);
    expect(checkBooking({ ...ok, date: "2026-11-12" }, base)).toEqual([]);
  });
  it("AT-04 교육실은 공개된 접수기간 안에서만", () => {
    const edu = { ...base, space: { ...base.space, leadDays: null, minHeadcount: null }, bookingWindow: { from: "2026-10-29", until: "2026-11-05" } };
    expect(checkDate("2026-11-05", edu)).toBeNull();
    expect(checkDate("2026-11-06", edu)?.code).toBe("BOOKING_WINDOW");
    expect(checkDate("2026-10-30", { ...edu, bookingWindow: null })?.code).toBe("BOOKING_WINDOW");
  });
  it("운영시간·시간 단위·최소 시간·야간 사용 여부", () => {
    expect(codes(checkBooking({ ...ok, startMinutes: 540 }, base))).toContain("HOURS");
    expect(codes(checkBooking({ ...ok, endMinutes: 1320 }, base))).toContain("HOURS"); // 22:00, 하루 안 운영 종료 이후
    expect(codes(checkBooking({ ...ok, startMinutes: 630, endMinutes: 810 }, base))).toContain("SLOT");
    expect(codes(checkBooking({ ...ok, endMinutes: 660 }, base))).toContain("MIN_DURATION");
    expect(codes(checkBooking({ ...ok, startMinutes: 960, endMinutes: 1200 }, { ...base, hours: { ...base.hours, nightEnabled: false } }))).toEqual(["NIGHT_DISABLED"]);
  });
  it("BR-02 차단 시간, BR-06 다른 신청과 겹침", () => {
    expect(codes(checkBooking(ok, { ...base, overlaps: ["block"] }))).toEqual(["BR-02"]);
    expect(codes(checkBooking(ok, { ...base, overlaps: ["pending_payment"] }))).toEqual(["BR-06"]);
  });
  it("BR-03 같은 단체 같은 날, BR-04 6개월 횟수", () => {
    expect(codes(checkBooking(ok, { ...base, organization: { sameDayCount: 1, periodCount: 0 } }))).toEqual(["BR-03"]);
    expect(codes(checkBooking(ok, { ...base, organization: { sameDayCount: 0, periodCount: 2 } }))).toEqual(["BR-04"]);
    expect(checkBooking(ok, { ...base, organization: { sameDayCount: 1, periodCount: 5 }, rules: { onePerOrgPerDay: false, halfYearLimitEnabled: false, halfYearLimitCount: 2 } })).toEqual([]);
  });
  it("유료 전환일 이전·지난 날짜", () => {
    expect(checkDate("2026-10-28", base)?.code).toBe("PAST");
    expect(checkDate("2026-11-20", { ...base, paidRentalStartDate: "2026-12-01" })?.code).toBe("PAID_START");
  });
});

describe("6개월 산정 기간 (P-03)", () => {
  it("최근 6개월 / 반기", () => {
    expect(halfYearRange("2026-11-15", "rolling")).toEqual({ from: "2026-05-16", to: "2026-11-15" });
    expect(halfYearRange("2026-11-15", "calendarHalf")).toEqual({ from: "2026-07-01", to: "2026-12-31" });
    expect(halfYearRange("2027-03-02", "calendarHalf")).toEqual({ from: "2027-01-01", to: "2027-06-30" });
  });
});
