import { addDays } from "@/domain/calendar/closures";
import { checkBooking, checkDate, type Violation } from "@/domain/booking/rules";
import { closingMinutes, fromMinutes, kstDateTime, slotStarts } from "@/domain/booking/time";
import { calculatePrice, type PriceQuote } from "@/domain/pricing/calculate";
import { describeDiscount } from "@/domain/pricing/discount-input";
import type { DbOrTx } from "@/server/db/types";
import { listActiveDiscounts, loadBookingContext, loadBusyIntervals, type BookingContext, type BusyInterval, type SpaceRow } from "./context";

/** 이용자 달력 상태 (USR-003): 예약가능 / 일부 가능 / 신청진행 / 예약완료 / 대관불가 */
export type DayState = "available" | "partial" | "in_progress" | "booked" | "unavailable";

export interface CalendarDay {
  date: string;
  state: DayState;
  reason?: string;
}

function ruleCtx(ctx: BookingContext) {
  return {
    today: ctx.today,
    nowMinutes: ctx.nowMinutes,
    paidRentalStartDate: ctx.settings["operation.paidRentalStartDate"],
    hours: ctx.hours,
    space: ctx.bookingSpace,
    closureRules: ctx.closureRules,
    bookingWindow: ctx.bookingWindow,
    rules: {
      onePerOrgPerDay: ctx.settings["application.onePerOrgPerDay"],
      halfYearLimitEnabled: ctx.settings["application.halfYearLimitEnabled"],
      halfYearLimitCount: ctx.settings["application.halfYearLimitCount"],
    },
  };
}

function overlaps(busy: readonly BusyInterval[], from: Date, to: Date): BusyInterval[] {
  return busy.filter((b) => b.from < to && from < b.to);
}

type SlotState = "free" | "pending" | "booked" | "blocked" | "past";

function slotStatesFor(date: string, ctx: BookingContext, busy: readonly BusyInterval[]): { start: number; end: number; state: SlotState }[] {
  const slot = ctx.space.slotMinutes;
  return slotStarts(ctx.hours, slot).map((start) => {
    const end = start + slot;
    if (date === ctx.today && start <= ctx.nowMinutes) return { start, end, state: "past" };
    const hit = overlaps(busy, kstDateTime(date, start), kstDateTime(date, end));
    if (hit.some((b) => b.kind === "block")) return { start, end, state: "blocked" };
    if (hit.some((b) => b.kind === "confirmed")) return { start, end, state: "booked" };
    if (hit.length > 0) return { start, end, state: "pending" };
    return { start, end, state: "free" };
  });
}

export async function getMonthCalendar(db: DbOrTx, space: SpaceRow, month: string, now: Date = new Date()): Promise<CalendarDay[]> {
  const ctx = await loadBookingContext(db, space, now);
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const busy = await loadBusyIntervals(db, space.id, kstDateTime(first, 0), kstDateTime(addDays(first, days), 0), now);
  const rc = ruleCtx(ctx);
  const result: CalendarDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(first, i);
    const violation = checkDate(date, rc);
    if (violation) {
      result.push({ date, state: "unavailable", reason: violation.message });
      continue;
    }
    const states = slotStatesFor(date, ctx, busy);
    const free = states.filter((s) => s.state === "free").length;
    // 최소 대관시간만큼 연속으로 빈 칸이 있어야 신청 가능
    const need = Math.ceil(ctx.space.minDurationMinutes / ctx.space.slotMinutes);
    let run = 0;
    let bookable = false;
    for (const s of states) {
      run = s.state === "free" ? run + 1 : 0;
      if (run >= need) bookable = true;
    }
    if (bookable) result.push({ date, state: free === states.length ? "available" : "partial" });
    else if (states.some((s) => s.state === "booked")) result.push({ date, state: "booked", reason: "예약이 모두 찼습니다." });
    else if (states.some((s) => s.state === "pending")) result.push({ date, state: "in_progress", reason: "다른 신청이 진행 중입니다." });
    else result.push({ date, state: "unavailable", reason: "신청할 수 있는 시간이 없습니다." });
  }
  return result;
}

export interface DayAvailability {
  date: string;
  dateViolation: Violation | null;
  dayStart: string;
  dayEnd: string;
  closing: string;
  nightEnabled: boolean;
  slotMinutes: number;
  minDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slots: { start: string; end: string; state: SlotState }[];
  /** 준비·철수 시간을 고려한 범위 검사를 위해 넘기는 바쁜 구간(분, 하루 안으로 자름) */
  busy: { from: number; to: number }[];
}

export async function getDayAvailability(db: DbOrTx, space: SpaceRow, date: string, now: Date = new Date()): Promise<DayAvailability> {
  const ctx = await loadBookingContext(db, space, now);
  const dayFrom = kstDateTime(date, 0);
  const dayTo = kstDateTime(addDays(date, 1), 0);
  const busy = await loadBusyIntervals(db, space.id, dayFrom, dayTo, now);
  const toMin = (d: Date) => Math.max(0, Math.min(1440, Math.round((d.getTime() - dayFrom.getTime()) / 60000)));
  return {
    date,
    dateViolation: checkDate(date, ruleCtx(ctx)),
    dayStart: fromMinutes(ctx.hours.dayStart),
    dayEnd: fromMinutes(ctx.hours.dayEnd),
    closing: fromMinutes(closingMinutes(ctx.hours)),
    nightEnabled: ctx.hours.nightEnabled,
    slotMinutes: space.slotMinutes,
    minDurationMinutes: space.minDurationMinutes,
    bufferBeforeMinutes: space.bufferBeforeMinutes,
    bufferAfterMinutes: space.bufferAfterMinutes,
    slots: slotStatesFor(date, ctx, busy).map((s) => ({ start: fromMinutes(s.start), end: fromMinutes(s.end), state: s.state })),
    busy: busy.map((b) => ({ from: toMin(b.from), to: toMin(b.to) })),
  };
}

export interface QuoteRequest {
  date: string;
  startMinutes: number;
  endMinutes: number;
  headcount: number | null;
  discountRuleId?: string | null;
  optionKeys?: string[];
}

export interface QuoteResult {
  violations: Violation[];
  price: PriceQuote | null;
  feeMissing: boolean;
  includesNight: boolean;
  discount: { id: string; name: string; label: string; proofRequired: boolean; proofGuide: string } | null;
}

/** 준비·철수 시간을 포함한 점유 범위 */
export function occupancyRange(space: SpaceRow, date: string, startMinutes: number, endMinutes: number) {
  return {
    from: kstDateTime(date, startMinutes - space.bufferBeforeMinutes),
    to: kstDateTime(date, endMinutes + space.bufferAfterMinutes),
  };
}

/** 선택한 일시에 대한 규칙 검사와 예상 금액 (단체 관련 규칙 BR-03·04는 제출할 때 검사) */
export async function quote(db: DbOrTx, space: SpaceRow, req: QuoteRequest, now: Date = new Date()): Promise<QuoteResult> {
  const ctx = await loadBookingContext(db, space, now);
  const range = occupancyRange(space, req.date, req.startMinutes, req.endMinutes);
  const busy = await loadBusyIntervals(db, space.id, range.from, range.to, now);
  const violations = checkBooking(
    { date: req.date, startMinutes: req.startMinutes, endMinutes: req.endMinutes, headcount: req.headcount },
    { ...ruleCtx(ctx), overlaps: busy.map((b) => b.kind), organization: null },
  );
  const discountRow = req.discountRuleId ? (await listActiveDiscounts(db)).find((d) => d.id === req.discountRuleId) ?? null : null;
  const fee = ctx.fee?.items.spaces[space.id];
  const validTime = !violations.some((v) => v.code === "HOURS");
  const price =
    fee && validTime
      ? calculatePrice({
          fee,
          startMinutes: req.startMinutes,
          endMinutes: req.endMinutes,
          dayEndMinutes: ctx.hours.dayEnd,
          options: ctx.fee?.items.options,
          selectedOptionKeys: req.optionKeys,
          discount: discountRow ? { name: discountRow.name, kind: discountRow.kind, value: discountRow.value } : null,
        })
      : null;
  return {
    violations,
    price,
    feeMissing: !fee,
    includesNight: req.endMinutes > ctx.hours.dayEnd,
    discount: discountRow
      ? { id: discountRow.id, name: discountRow.name, label: describeDiscount(discountRow), proofRequired: discountRow.proofRequired, proofGuide: discountRow.proofGuide }
      : null,
  };
}
