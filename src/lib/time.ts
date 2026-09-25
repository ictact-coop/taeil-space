/** 한국 표준시(KST, UTC+9) 표시·입력 도우미. 저장은 항상 UTC(timestamptz). (NFR-09) */

export const KST_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET = "+09:00";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 2026. 10. 22. 14:00 형태 */
export function formatKst(date: Date): string {
  return dateTimeFormatter.format(date);
}

function kstParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** <input type="datetime-local">용 KST 문자열 (YYYY-MM-DDTHH:mm) */
export function toKstLocalInput(date: Date): string {
  const p = kstParts(date);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** datetime-local 입력값(KST)을 Date로. 형식이 틀리면 null. */
export function parseKstLocalInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${KST_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 해당 시각의 KST 날짜 (YYYY-MM-DD) */
export function kstDateOf(date: Date): string {
  return toKstLocalInput(date).slice(0, 10);
}

/** KST 날짜의 시작 시각(00:00 KST) */
export function kstStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}
