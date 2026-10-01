import { addDays } from "./closures";

/**
 * 교육실처럼 접수기간 안에서만 신청받는 공간의 실제 접수 가능 기간 (P-08, AT-04).
 * manual: 담당자가 공개한 기간 / auto: 오늘부터 N일
 * 오늘 이전 날짜는 신청 대상이 아니므로 시작일은 오늘 이후로 자른다.
 */
export function effectiveBookingWindow(params: {
  mode: "manual" | "auto";
  autoDays: number;
  manual: { opensFrom: string; opensUntil: string } | null;
  today: string;
}): { from: string; until: string } | null {
  if (params.mode === "auto") return { from: params.today, until: addDays(params.today, params.autoDays) };
  if (!params.manual) return null;
  const from = params.manual.opensFrom > params.today ? params.manual.opensFrom : params.today;
  if (from > params.manual.opensUntil) return null;
  return { from, until: params.manual.opensUntil };
}
