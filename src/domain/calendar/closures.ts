/**
 * 휴관 규칙 판정 (계획서 2.6, BR-01).
 * 날짜는 KST 기준 'YYYY-MM-DD' 문자열로 다룬다.
 * 우선순위: 예외 개관일 > 특정 날짜·기간 > 매년 같은 날 > 정기 휴관 요일
 */

export type ClosureRuleType = "weekly" | "annual" | "date_range" | "open_exception";

export interface ClosureRule {
  id: string;
  type: ClosureRuleType;
  name: string;
  publicMessage: string;
  spaceId: string | null;
  weekday: number | null;
  month: number | null;
  day: number | null;
  startDate: string | null;
  endDate: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  isActive: boolean;
}

export type ClosureResult =
  | { closed: false; openedBy: ClosureRule | null }
  | { closed: true; rule: ClosureRule };

const PRIORITY: Record<ClosureRuleType, number> = { open_exception: 4, date_range: 3, annual: 2, weekly: 1 };

export const closureTypeLabels: Record<ClosureRuleType, string> = {
  weekly: "정기 휴관 요일",
  annual: "매년 같은 날",
  date_range: "특정 날짜·기간",
  open_exception: "예외 개관일",
};

export const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** 'YYYY-MM-DD'의 요일 (0=일) */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ruleMatches(rule: ClosureRule, date: string, spaceId: string | null): boolean {
  if (!rule.isActive) return false;
  if (rule.spaceId !== null && rule.spaceId !== spaceId) return false;
  if (rule.activeFrom && date < rule.activeFrom) return false;
  if (rule.activeUntil && date > rule.activeUntil) return false;
  switch (rule.type) {
    case "weekly":
      return rule.weekday === weekdayOf(date);
    case "annual": {
      const [, m, d] = date.split("-").map(Number);
      return rule.month === m && rule.day === d;
    }
    case "date_range":
    case "open_exception":
      return rule.startDate !== null && rule.endDate !== null && rule.startDate <= date && date <= rule.endDate;
  }
}

/**
 * 해당 날짜에 공간이 휴관인지 판단한다.
 * spaceId가 null이면 전체 공간 규칙만 본다(기념관 전체 휴관 여부).
 */
export function evaluateClosure(date: string, spaceId: string | null, rules: readonly ClosureRule[]): ClosureResult {
  let best: ClosureRule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, date, spaceId)) continue;
    // 같은 우선순위면 공간 전용 규칙이 전체 규칙보다 우선
    if (
      !best ||
      PRIORITY[rule.type] > PRIORITY[best.type] ||
      (PRIORITY[rule.type] === PRIORITY[best.type] && rule.spaceId !== null && best.spaceId === null)
    ) {
      best = rule;
    }
  }
  if (!best) return { closed: false, openedBy: null };
  if (best.type === "open_exception") return { closed: false, openedBy: best };
  return { closed: true, rule: best };
}

/** 기간 안의 휴관일 목록 */
export function closedDatesBetween(
  from: string,
  to: string,
  spaceId: string | null,
  rules: readonly ClosureRule[],
): { date: string; rule: ClosureRule }[] {
  const result: { date: string; rule: ClosureRule }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = evaluateClosure(d, spaceId, rules);
    if (r.closed) result.push({ date: d, rule: r.rule });
  }
  return result;
}

/** 규칙 요약 문구 (예: "매주 월요일", "매년 1월 1일", "2027-02-06 ~ 2027-02-08") */
export function describeClosureRule(rule: Pick<ClosureRule, "type" | "weekday" | "month" | "day" | "startDate" | "endDate">): string {
  switch (rule.type) {
    case "weekly":
      return `매주 ${weekdayLabels[rule.weekday ?? 0]}요일`;
    case "annual":
      return `매년 ${rule.month}월 ${rule.day}일`;
    case "date_range":
    case "open_exception":
      return rule.startDate === rule.endDate ? `${rule.startDate}` : `${rule.startDate} ~ ${rule.endDate}`;
  }
}
