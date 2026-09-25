import { toKstLocalInput } from "./time";

/** KST 기준 하루 중 분 (예: 14:30 → 870) */
export function toMinutesOfDay(date: Date): number {
  const [h, m] = toKstLocalInput(date).slice(11).split(":").map(Number) as [number, number];
  return h * 60 + m;
}
