import {
  getDefinition,
  isSettingKey,
  settingKeys,
  type SettingKey,
  type SettingValue,
  type SettingValues,
} from "./definitions";
import { sameJson } from "@/lib/stable-json";

/** policy_values 한 행 */
export interface PolicyRow {
  id: number;
  key: string;
  value: unknown;
  effectiveFrom: Date;
}

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValue<K>;
  /** 기본값인지, 저장된 값인지 */
  source: "default" | "stored";
  /** 저장된 값이 현재 정의와 맞지 않아 기본값으로 대체했는지 */
  invalidStored: boolean;
  /** 적용 중인 행 (기본값이면 null) */
  row: PolicyRow | null;
}

/** 같은 적용 시각이면 나중에 저장한 행(id가 큰 행)이 이긴다. 예약 취소도 이 규칙으로 처리한다. */
function isLater(a: PolicyRow, b: PolicyRow): boolean {
  const diff = a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
  return diff > 0 || (diff === 0 && a.id > b.id);
}

/** 기준 시각에 적용되는 행 (없으면 null) */
export function pickEffectiveRow(rows: readonly PolicyRow[], at: Date): PolicyRow | null {
  let best: PolicyRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || isLater(row, best)) best = row;
  }
  return best;
}

export function resolveSetting<K extends SettingKey>(
  key: K,
  rows: readonly PolicyRow[],
  at: Date,
): ResolvedSetting<K> {
  const def = getDefinition(key);
  const row = pickEffectiveRow(
    rows.filter((r) => r.key === key),
    at,
  );
  if (!row) return { key, value: def.defaultValue, source: "default", invalidStored: false, row: null };
  const parsed = def.schema.safeParse(row.value);
  if (!parsed.success) {
    return { key, value: def.defaultValue, source: "default", invalidStored: true, row };
  }
  return { key, value: parsed.data, source: "stored", invalidStored: false, row };
}

export function resolveAll(rows: readonly PolicyRow[], at: Date): {
  values: SettingValues;
  resolved: { [K in SettingKey]: ResolvedSetting<K> };
} {
  const resolved = {} as { [K in SettingKey]: ResolvedSetting<K> };
  const values = {} as Record<SettingKey, unknown>;
  for (const key of settingKeys) {
    const r = resolveSetting(key, rows, at);
    (resolved as Record<SettingKey, ResolvedSetting>)[key] = r as ResolvedSetting;
    values[key] = r.value;
  }
  return { values: values as SettingValues, resolved };
}

/** 기준 시각 이후에 실제로 값이 바뀌는 예약 변경(시간순). 취소되었거나 대체된 행은 뺀다. */
export function upcomingRows(rows: readonly PolicyRow[], key: string, after: Date, defaultValue: unknown): PolicyRow[] {
  const own = rows.filter((r) => r.key === key);
  const statuses = classifyHistory(own, after, defaultValue);
  return own
    .filter((r) => statuses.get(r.id) === "scheduled")
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}

export { isSettingKey };

export type HistoryStatus =
  /** 지금 적용 중 */
  | "active"
  /** 적용 예정 */
  | "scheduled"
  /** 예약이 취소되어 아무 변화가 없는 기록 */
  | "cancelled"
  /** 같은 적용 시각에 나중에 저장한 행이 있어 적용되지 않음 */
  | "superseded"
  /** 과거에 적용됐던 값 */
  | "past";

/**
 * 변경 이력 각 행의 상태를 판단한다. rows는 한 설정 키의 행들이다.
 * sameValue: 두 값이 같은지 비교하는 함수 (기본은 키 순서와 무관한 JSON 비교)
 */
export function classifyHistory(
  rows: readonly PolicyRow[],
  now: Date,
  defaultValue: unknown,
  sameValue: (a: unknown, b: unknown) => boolean = sameJson,
): Map<number, HistoryStatus> {
  const result = new Map<number, HistoryStatus>();
  const active = pickEffectiveRow(rows, now);
  for (const row of rows) {
    const t = row.effectiveFrom.getTime();
    if (rows.some((r) => r.effectiveFrom.getTime() === t && r.id > row.id)) {
      result.set(row.id, "superseded");
    } else if (t > now.getTime()) {
      const previous = pickEffectiveRow(
        rows.filter((r) => r.effectiveFrom.getTime() < t),
        row.effectiveFrom,
      );
      result.set(row.id, sameValue(previous ? previous.value : defaultValue, row.value) ? "cancelled" : "scheduled");
    } else {
      result.set(row.id, active?.id === row.id ? "active" : "past");
    }
  }
  return result;
}
