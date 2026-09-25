/** 하루 안의 시각을 분(0~1440)으로 다룬다. 대관은 하루를 넘기지 않는다(BR-07). */

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface OperatingHours {
  dayStart: number;
  dayEnd: number;
  nightEnabled: boolean;
  nightEnd: number;
}

export function hoursFromSettings(s: {
  "operation.dayStart": string;
  "operation.dayEnd": string;
  "operation.nightEnabled": boolean;
  "operation.nightEnd": string;
}): OperatingHours {
  return {
    dayStart: toMinutes(s["operation.dayStart"]),
    dayEnd: toMinutes(s["operation.dayEnd"]),
    nightEnabled: s["operation.nightEnabled"],
    nightEnd: toMinutes(s["operation.nightEnd"]),
  };
}

/** 대관 가능한 마지막 시각 */
export function closingMinutes(h: OperatingHours): number {
  return h.nightEnabled ? h.nightEnd : h.dayEnd;
}

/** 시간 단위로 나눈 칸의 시작 시각들 */
export function slotStarts(h: OperatingHours, slotMinutes: number): number[] {
  const result: number[] = [];
  for (let t = h.dayStart; t + slotMinutes <= closingMinutes(h); t += slotMinutes) result.push(t);
  return result;
}

/** 야간(주간 종료 시각 이후)을 포함하는지 */
export function includesNight(endMinutes: number, h: OperatingHours): boolean {
  return endMinutes > h.dayEnd;
}

/** KST 날짜와 분을 UTC Date로 */
export function kstDateTime(date: string, minutes: number): Date {
  return new Date(`${date}T${fromMinutes(minutes)}:00+09:00`);
}
