import { evaluateClosure, type ClosureRule } from "@/domain/calendar/closures";
import { addDays } from "@/domain/calendar/closures";
import { closingMinutes, fromMinutes, type OperatingHours } from "./time";

/**
 * 신청 조건 자동 검증 ([요구] 10장 BR-01~08, AT-01~05).
 * 순수 함수: DB 조회 결과(겹치는 점유, 단체 신청 수 등)를 받아 위반 목록을 돌려준다.
 */
export type ViolationCode =
  | "PAST"
  | "PAID_START"
  | "NOT_PUBLIC"
  | "BR-01"
  | "LEAD_TIME"
  | "BOOKING_WINDOW"
  | "HOURS"
  | "SLOT"
  | "MIN_DURATION"
  | "NIGHT_DISABLED"
  | "BR-02"
  | "BR-06"
  | "BR-05"
  | "BR-08"
  | "BR-03"
  | "BR-04";

export interface Violation {
  code: ViolationCode;
  field: "date" | "time" | "headcount" | "organization" | "space";
  message: string;
}

export interface BookingSpace {
  id: string;
  name: string;
  capacity: number;
  minHeadcount: number | null;
  leadDays: number | null;
  slotMinutes: number;
  minDurationMinutes: number;
  isPublic: boolean;
}

export interface RuleContext {
  today: string;
  nowMinutes: number;
  paidRentalStartDate: string;
  hours: OperatingHours;
  space: BookingSpace;
  closureRules: readonly ClosureRule[];
  /** 신청기한 대신 접수기간으로 받는 공간의 현재 접수기간 */
  bookingWindow: { from: string; until: string } | null;
  /** 요청 범위(준비·철수 시간 포함)와 겹치는 점유 종류 */
  overlaps: readonly ("pending_payment" | "held" | "confirmed" | "block")[];
  /** 단체번호가 있을 때만: 같은 날 진행 중 신청 수, 6개월 기간 안 신청 수 */
  organization: { sameDayCount: number; periodCount: number } | null;
  rules: { onePerOrgPerDay: boolean; halfYearLimitEnabled: boolean; halfYearLimitCount: number };
}

export interface BookingRequest {
  date: string;
  startMinutes: number;
  endMinutes: number;
  /** 아직 입력 전이면 null (인원 규칙은 건너뜀) */
  headcount: number | null;
}

/** 날짜만으로 판단하는 규칙 (달력 표시에 사용) */
export function checkDate(date: string, ctx: Omit<RuleContext, "overlaps" | "organization">): Violation | null {
  const { space } = ctx;
  if (!space.isPublic) return { code: "NOT_PUBLIC", field: "space", message: "지금은 신청을 받지 않는 공간입니다." };
  if (date < ctx.today) return { code: "PAST", field: "date", message: "지난 날짜는 신청할 수 없습니다." };
  if (date < ctx.paidRentalStartDate) {
    return { code: "PAID_START", field: "date", message: `온라인 대관은 ${ctx.paidRentalStartDate} 이용분부터 신청할 수 있습니다.` };
  }
  const closure = evaluateClosure(date, space.id, ctx.closureRules);
  if (closure.closed) return { code: "BR-01", field: "date", message: closure.rule.publicMessage };
  if (space.leadDays !== null) {
    const earliest = addDays(ctx.today, space.leadDays);
    if (date < earliest) {
      return { code: "LEAD_TIME", field: "date", message: `${space.name}은(는) 이용일 ${space.leadDays}일 전까지 신청해야 합니다(${earliest}부터 선택 가능).` };
    }
  } else {
    const w = ctx.bookingWindow;
    if (!w || date < w.from || date > w.until) {
      return {
        code: "BOOKING_WINDOW",
        field: "date",
        message: w ? `${space.name}은(는) 공개된 접수기간(${w.from} ~ ${w.until}) 안에서만 신청할 수 있습니다.` : `${space.name}은(는) 지금 공개된 접수기간이 없습니다.`,
      };
    }
  }
  return null;
}

export function checkBooking(req: BookingRequest, ctx: RuleContext): Violation[] {
  const v: Violation[] = [];
  const { space, hours } = ctx;
  const dateViolation = checkDate(req.date, ctx);
  if (dateViolation) v.push(dateViolation);

  const closing = closingMinutes(hours);
  if (!hours.nightEnabled && req.endMinutes > hours.dayEnd && req.endMinutes <= hours.nightEnd && req.startMinutes >= hours.dayStart && req.startMinutes < req.endMinutes) {
    v.push({ code: "NIGHT_DISABLED", field: "time", message: `지금은 야간 대관을 받지 않습니다. ${fromMinutes(hours.dayEnd)} 이전에 끝나도록 정해 주세요.` });
  } else if (req.startMinutes < hours.dayStart || req.endMinutes > closing || req.startMinutes >= req.endMinutes) {
    v.push({ code: "HOURS", field: "time", message: `대관 시간은 ${fromMinutes(hours.dayStart)}~${fromMinutes(closing)} 사이에서 같은 날 안에 정해야 합니다.` });
  } else {
    if ((req.startMinutes - hours.dayStart) % space.slotMinutes !== 0 || (req.endMinutes - req.startMinutes) % space.slotMinutes !== 0) {
      v.push({ code: "SLOT", field: "time", message: `${space.name}은(는) ${space.slotMinutes}분 단위로 예약합니다.` });
    }
    if (req.endMinutes - req.startMinutes < space.minDurationMinutes) {
      v.push({ code: "MIN_DURATION", field: "time", message: `최소 대관시간은 ${space.minDurationMinutes}분입니다.` });
    }
    if (req.date === ctx.today && req.startMinutes <= ctx.nowMinutes) {
      v.push({ code: "PAST", field: "time", message: "이미 지난 시간입니다." });
    }
  }

  if (ctx.overlaps.includes("block")) {
    v.push({ code: "BR-02", field: "time", message: "기념관 일정으로 대관할 수 없는 시간입니다." });
  } else if (ctx.overlaps.length > 0) {
    v.push({ code: "BR-06", field: "time", message: "이미 다른 신청이 진행 중이거나 예약된 시간입니다(준비·철수 시간 포함)." });
  }

  if (req.headcount !== null) {
    if (req.headcount > space.capacity) {
      v.push({ code: "BR-05", field: "headcount", message: `${space.name} 정원은 ${space.capacity}명입니다.` });
    }
    if (space.minHeadcount !== null && req.headcount < space.minHeadcount) {
      v.push({ code: "BR-08", field: "headcount", message: `${space.name}은(는) ${space.minHeadcount}명 이상일 때 신청할 수 있습니다.` });
    }
  }

  if (ctx.organization) {
    if (ctx.rules.onePerOrgPerDay && ctx.organization.sameDayCount > 0) {
      v.push({ code: "BR-03", field: "organization", message: "같은 단체가 같은 날 이미 신청했습니다. 한 단체는 하루 1건만 신청할 수 있습니다." });
    }
    if (ctx.rules.halfYearLimitEnabled && ctx.organization.periodCount >= ctx.rules.halfYearLimitCount) {
      v.push({ code: "BR-04", field: "organization", message: `6개월 동안 신청할 수 있는 횟수(${ctx.rules.halfYearLimitCount}회)를 모두 사용했습니다.` });
    }
  }
  return v;
}

/** 6개월 이용 횟수를 셀 기간 (BR-04, P-03) */
export function halfYearRange(date: string, method: "rolling" | "calendarHalf"): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  if (method === "calendarHalf") {
    return m <= 6 ? { from: `${y}-01-01`, to: `${y}-06-30` } : { from: `${y}-07-01`, to: `${y}-12-31` };
  }
  // 이용일을 포함해 거슬러 6개월 (예: 2026-11-15 → 2026-05-16 ~ 2026-11-15)
  const d = new Date(`${date}T00:00:00Z`);
  const back = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 6, d.getUTCDate() + 1));
  return { from: back.toISOString().slice(0, 10), to: date };
}
