import { describe, expect, it } from "vitest";
import { refundPercentFor, refundTiersSchema } from "@/domain/refund/tiers";
import { spaceInputSchema } from "@/domain/spaces/space-input";
import { blockInputSchema } from "@/domain/calendar/block-input";
import { discountInputSchema } from "./discount-input";
import { feeScheduleItemsSchema } from "./fee-schedule";

describe("시점별 환불률 (P-06)", () => {
  it("일수가 큰 순서로 정렬하고 구간을 고른다", () => {
    const tiers = refundTiersSchema.parse([
      { daysBefore: 3, percent: 50 },
      { daysBefore: 7, percent: 100 },
      { daysBefore: 1, percent: 20 },
    ]);
    expect(tiers.map((t) => t.daysBefore)).toEqual([7, 3, 1]);
    expect(refundPercentFor(10, tiers)).toBe(100);
    expect(refundPercentFor(7, tiers)).toBe(100);
    expect(refundPercentFor(6, tiers)).toBe(50);
    expect(refundPercentFor(1, tiers)).toBe(20);
    expect(refundPercentFor(0, tiers)).toBe(0); // 어느 구간에도 들지 않으면 0%
  });
  it("이용일이 가까울수록 환불률이 높아지면 거부", () => {
    expect(refundTiersSchema.safeParse([{ daysBefore: 7, percent: 50 }, { daysBefore: 3, percent: 80 }]).success).toBe(false);
  });
  it("같은 일수 중복, 범위 밖 값 거부", () => {
    expect(refundTiersSchema.safeParse([{ daysBefore: 7, percent: 50 }, { daysBefore: 7, percent: 40 }]).success).toBe(false);
    expect(refundTiersSchema.safeParse([{ daysBefore: 7, percent: 120 }]).success).toBe(false);
    expect(refundTiersSchema.safeParse([{ daysBefore: Number.NaN, percent: 50 }]).success).toBe(false);
  });
});

describe("요금표 형식 (P-01)", () => {
  const id = "0b5a8a8e-1c1b-4d7e-9c55-2a2f3f0e8f11";
  const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
  it("올바른 요금표", () => {
    expect(feeScheduleItemsSchema.safeParse({ spaces: { [id]: fee }, options: [{ key: "beam", name: "빔프로젝터", fee: 10000, unit: "per_booking" }] }).success).toBe(true);
  });
  it("음수·빈 값·15분 단위가 아닌 시간은 거부", () => {
    expect(feeScheduleItemsSchema.safeParse({ spaces: { [id]: { ...fee, baseFee: -1 } }, options: [] }).success).toBe(false);
    expect(feeScheduleItemsSchema.safeParse({ spaces: { [id]: { ...fee, extraFee: Number.NaN } }, options: [] }).success).toBe(false);
    expect(feeScheduleItemsSchema.safeParse({ spaces: { [id]: { ...fee, baseMinutes: 100 } }, options: [] }).success).toBe(false);
  });
});

describe("공간 입력 (P-02)", () => {
  const base = {
    code: "seminar", name: "세미나실", capacity: "15", minHeadcount: "", description: "", equipment: "빔, 화이트보드", notice: "",
    leadDays: "14", slotMinutes: "60", minDurationMinutes: "120", bufferBeforeMinutes: "10", bufferAfterMinutes: "0",
    extraConsents: [], isPublic: true, sortOrder: "1",
  };
  it("올바른 입력을 변환한다", () => {
    expect(spaceInputSchema.parse(base)).toMatchObject({ capacity: 15, minHeadcount: null, equipment: ["빔", "화이트보드"], leadDays: 14 });
  });
  it("최소 대관시간은 시간 단위의 배수, 최소 인원은 정원 이하", () => {
    expect(spaceInputSchema.safeParse({ ...base, minDurationMinutes: "90" }).success).toBe(false);
    expect(spaceInputSchema.safeParse({ ...base, minHeadcount: "20" }).success).toBe(false);
    expect(spaceInputSchema.safeParse({ ...base, bufferBeforeMinutes: "7" }).success).toBe(false);
    expect(spaceInputSchema.safeParse({ ...base, extraConsents: ["unknown"] }).success).toBe(false);
  });
  it("신청기한을 비우면 접수기간 방식(null)", () => {
    expect(spaceInputSchema.parse({ ...base, leadDays: "" }).leadDays).toBeNull();
  });
});

describe("일정 차단 입력 (BR-02)", () => {
  it("KST 입력을 UTC로 바꾸고 순서를 검사한다", () => {
    const r = blockInputSchema.parse({ kind: "event", spaceId: "", startsAt: "2026-11-11T10:00", endsAt: "2026-11-11T18:00", reason: "자체행사" });
    expect(r.startsAt.toISOString()).toBe("2026-11-11T01:00:00.000Z");
    expect(blockInputSchema.safeParse({ kind: "event", spaceId: "", startsAt: "2026-11-11T18:00", endsAt: "2026-11-11T10:00", reason: "x" }).success).toBe(false);
  });
});

describe("감면 입력 (P-07)", () => {
  const base = { name: "공익", description: "", kind: "percent", value: "50", proofRequired: true, proofGuide: "고유번호증", isActive: true, sortOrder: "0" };
  it("비율은 1~100, 증빙 필수면 안내 필요", () => {
    expect(discountInputSchema.safeParse(base).success).toBe(true);
    expect(discountInputSchema.safeParse({ ...base, value: "150" }).success).toBe(false);
    expect(discountInputSchema.safeParse({ ...base, proofGuide: "" }).success).toBe(false);
    expect(discountInputSchema.safeParse({ ...base, kind: "amount", value: "150000" }).success).toBe(true);
  });
});
