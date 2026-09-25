import { desc, eq, sql } from "drizzle-orm";
import type { AdminRoleName } from "@/domain/settings/define";
import { crossValidate } from "@/domain/settings/cross-validate";
import {
  getDefinition,
  isSettingKey,
  type SettingKey,
  type SettingValue,
  type SettingValues,
} from "@/domain/settings/definitions";
import { pickEffectiveRow, resolveAll, resolveSetting, type PolicyRow } from "@/domain/settings/resolve";
import { writeAudit } from "@/server/audit/log";
import { adminUsers, policyValues } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

export interface SettingsActor {
  id: string;
  role: AdminRoleName;
  ip?: string | null;
}

/** 지금보다 이만큼 과거까지는 "지금 적용"으로 받아준다(폼 작성 시간 감안). */
const PAST_TOLERANCE_MS = 10 * 60 * 1000;
const MIN_REASON_LENGTH = 2;

export function canEditSetting(role: AdminRoleName, key: SettingKey): boolean {
  return role === "system" || getDefinition(key).editableBy.includes(role);
}

export async function loadPolicyRows(db: DbOrTx): Promise<PolicyRow[]> {
  return db
    .select({
      id: policyValues.id,
      key: policyValues.key,
      value: policyValues.value,
      effectiveFrom: policyValues.effectiveFrom,
    })
    .from(policyValues);
}

/** 기준 시각에 적용되는 전체 설정값 */
export async function getSettings(db: DbOrTx, at: Date = new Date()): Promise<SettingValues> {
  return resolveAll(await loadPolicyRows(db), at).values;
}

export async function getSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
  at: Date = new Date(),
): Promise<SettingValue<K>> {
  const rows = await db
    .select({
      id: policyValues.id,
      key: policyValues.key,
      value: policyValues.value,
      effectiveFrom: policyValues.effectiveFrom,
    })
    .from(policyValues)
    .where(eq(policyValues.key, key));
  return resolveSetting(key, rows, at).value;
}

/**
 * 신청 건에 남길 설정 스냅샷(계획서 2.7). 값과 함께 어떤 버전(policy_values.id)이 적용됐는지 기록한다.
 */
export async function getSettingsSnapshot(
  db: DbOrTx,
  at: Date = new Date(),
): Promise<{ at: string; values: SettingValues; versions: Record<string, number | null> }> {
  const { values, resolved } = resolveAll(await loadPolicyRows(db), at);
  const versions: Record<string, number | null> = {};
  for (const [key, r] of Object.entries(resolved)) versions[key] = r.source === "stored" ? (r.row?.id ?? null) : null;
  return { at: at.toISOString(), values, versions };
}

export type SaveResult =
  | { ok: true; savedKeys: SettingKey[] }
  | { ok: false; formError?: string; fieldErrors: Partial<Record<string, string>> };

interface TypedChange {
  key: SettingKey;
  value: unknown;
}

async function lockPolicies(tx: DbOrTx) {
  // 설정 변경을 한 번에 하나씩 처리한다(동시에 저장해서 검증을 우회하는 일 방지).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('policy_values'))`);
}

async function applyChanges(
  tx: DbOrTx,
  params: {
    actor: SettingsActor;
    changes: TypedChange[];
    effectiveFrom: Date;
    reason: string;
    action: string;
    rows: PolicyRow[];
  },
): Promise<void> {
  const { actor, changes, effectiveFrom, reason, action, rows } = params;
  const inserted = await tx
    .insert(policyValues)
    .values(
      changes.map((c) => ({
        key: c.key,
        value: c.value,
        effectiveFrom,
        reason,
        createdBy: actor.id,
      })),
    )
    .returning({ id: policyValues.id, key: policyValues.key });

  await writeAudit(
    tx,
    changes.map((c) => {
      const before = resolveSetting(c.key, rows, effectiveFrom);
      return {
        actorType: "admin" as const,
        actorId: actor.id,
        action,
        targetType: "setting",
        targetId: c.key,
        before: { value: before.value, source: before.source },
        after: {
          value: c.value,
          effectiveFrom: effectiveFrom.toISOString(),
          policyValueId: inserted.find((i) => i.key === c.key)?.id ?? null,
        },
        reason,
        ip: actor.ip ?? null,
      };
    }),
  );
}

function crossIssuesFor(
  rows: PolicyRow[],
  changes: TypedChange[],
  at: Date,
): Partial<Record<string, string>> {
  const merged = { ...resolveAll(rows, at).values } as Record<SettingKey, unknown>;
  for (const c of changes) merged[c.key] = c.value;
  const changedKeys = new Set(changes.map((c) => c.key));
  const errors: Partial<Record<string, string>> = {};
  for (const issue of crossValidate(merged as SettingValues)) {
    if (!issue.keys.some((k) => changedKeys.has(k))) continue; // 이번 변경과 무관한 기존 문제는 막지 않는다
    for (const k of issue.keys) errors[k] ??= issue.message;
  }
  return errors;
}

/**
 * 설정 페이지 폼 저장. 바뀐 항목만 새 버전으로 추가한다.
 * rawValues: 설정 키 → 폼 문자열
 */
export async function saveSettingChanges(
  db: Db,
  params: {
    actor: SettingsActor;
    rawValues: Record<string, string>;
    effectiveFrom: Date;
    reason: string;
    now?: Date;
  },
): Promise<SaveResult> {
  const now = params.now ?? new Date();
  const reason = params.reason.trim();
  const fieldErrors: Partial<Record<string, string>> = {};

  if (reason.length < MIN_REASON_LENGTH) {
    return { ok: false, formError: "변경 사유를 입력하세요.", fieldErrors };
  }
  if (params.effectiveFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return { ok: false, formError: "적용 시작 시각은 과거로 정할 수 없습니다.", fieldErrors };
  }
  const effectiveFrom = params.effectiveFrom.getTime() < now.getTime() ? now : params.effectiveFrom;

  const parsed: TypedChange[] = [];
  for (const [key, raw] of Object.entries(params.rawValues)) {
    if (!isSettingKey(key)) return { ok: false, formError: `알 수 없는 설정: ${key}`, fieldErrors };
    if (!canEditSetting(params.actor.role, key)) {
      fieldErrors[key] = "이 설정을 수정할 권한이 없습니다.";
      continue;
    }
    const result = getDefinition(key).parse(raw);
    if (!result.ok) fieldErrors[key] = result.error;
    else parsed.push({ key, value: result.value });
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return db.transaction(async (tx) => {
    await lockPolicies(tx);
    const rows = await loadPolicyRows(tx);
    const current = resolveAll(rows, effectiveFrom).values as Record<SettingKey, unknown>;
    const changes = parsed.filter((c) => JSON.stringify(current[c.key]) !== JSON.stringify(c.value));
    if (changes.length === 0) {
      return { ok: false, formError: "바뀐 값이 없습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const crossErrors = crossIssuesFor(rows, changes, effectiveFrom);
    if (Object.keys(crossErrors).length > 0) {
      return { ok: false, fieldErrors: crossErrors } satisfies SaveResult;
    }
    await applyChanges(tx, {
      actor: params.actor,
      changes,
      effectiveFrom,
      reason,
      action: effectiveFrom.getTime() > now.getTime() ? "setting.schedule" : "setting.change",
      rows,
    });
    return { ok: true, savedKeys: changes.map((c) => c.key) } satisfies SaveResult;
  });
}

/** 이력의 특정 버전 값으로 되돌린다(지금부터 적용). 기존 행은 지우지 않고 새 행을 추가한다. */
export async function revertSetting(
  db: Db,
  params: { actor: SettingsActor; policyValueId: number; reason: string; now?: Date },
): Promise<SaveResult> {
  const now = params.now ?? new Date();
  const reason = params.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) return { ok: false, formError: "변경 사유를 입력하세요.", fieldErrors: {} };

  return db.transaction(async (tx) => {
    await lockPolicies(tx);
    const rows = await loadPolicyRows(tx);
    const target = rows.find((r) => r.id === params.policyValueId);
    if (!target || !isSettingKey(target.key)) {
      return { ok: false, formError: "되돌릴 버전을 찾을 수 없습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const key = target.key;
    if (!canEditSetting(params.actor.role, key)) {
      return { ok: false, formError: "이 설정을 수정할 권한이 없습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const parsed = getDefinition(key).schema.safeParse(target.value);
    if (!parsed.success) {
      return {
        ok: false,
        formError: "이 버전의 값은 현재 허용 범위를 벗어나 되돌릴 수 없습니다.",
        fieldErrors: {},
      } satisfies SaveResult;
    }
    const current = resolveSetting(key, rows, now);
    if (JSON.stringify(current.value) === JSON.stringify(parsed.data)) {
      return { ok: false, formError: "이미 이 값이 적용되어 있습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const changes = [{ key, value: parsed.data }];
    const crossErrors = crossIssuesFor(rows, changes, now);
    if (Object.keys(crossErrors).length > 0) {
      return { ok: false, formError: Object.values(crossErrors)[0], fieldErrors: {} } satisfies SaveResult;
    }
    await applyChanges(tx, { actor: params.actor, changes, effectiveFrom: now, reason, action: "setting.revert", rows });
    return { ok: true, savedKeys: [key] } satisfies SaveResult;
  });
}

/**
 * 예약된(아직 적용 전) 변경을 취소한다.
 * 같은 적용 시각에, 그 직전까지 적용되던 값을 새 행으로 추가한다(같은 시각이면 나중 행이 이김).
 */
export async function cancelScheduledSetting(
  db: Db,
  params: { actor: SettingsActor; policyValueId: number; reason: string; now?: Date },
): Promise<SaveResult> {
  const now = params.now ?? new Date();
  const reason = params.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) return { ok: false, formError: "취소 사유를 입력하세요.", fieldErrors: {} };

  return db.transaction(async (tx) => {
    await lockPolicies(tx);
    const rows = await loadPolicyRows(tx);
    const target = rows.find((r) => r.id === params.policyValueId);
    if (!target || !isSettingKey(target.key)) {
      return { ok: false, formError: "예약된 변경을 찾을 수 없습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const key = target.key;
    if (!canEditSetting(params.actor.role, key)) {
      return { ok: false, formError: "이 설정을 수정할 권한이 없습니다.", fieldErrors: {} } satisfies SaveResult;
    }
    if (target.effectiveFrom.getTime() <= now.getTime()) {
      return { ok: false, formError: "이미 적용된 변경은 취소할 수 없습니다. 되돌리기를 사용하세요.", fieldErrors: {} } satisfies SaveResult;
    }
    const sameTime = rows.filter((r) => r.key === key && r.effectiveFrom.getTime() === target.effectiveFrom.getTime());
    const latestAtThatTime = sameTime.reduce((a, b) => (b.id > a.id ? b : a));
    if (latestAtThatTime.id !== target.id) {
      return { ok: false, formError: "이미 취소되었거나 다른 값으로 바뀐 예약입니다.", fieldErrors: {} } satisfies SaveResult;
    }
    const earlierRows = rows.filter((r) => r.key === key && r.effectiveFrom.getTime() < target.effectiveFrom.getTime());
    const previous = pickEffectiveRow(earlierRows, target.effectiveFrom);
    const def = getDefinition(key);
    const prevParsed = previous ? def.schema.safeParse(previous.value) : null;
    const restoreValue = prevParsed?.success ? prevParsed.data : def.defaultValue;

    await applyChanges(tx, {
      actor: params.actor,
      changes: [{ key, value: restoreValue }],
      effectiveFrom: target.effectiveFrom,
      reason,
      action: "setting.cancel_scheduled",
      rows,
    });
    return { ok: true, savedKeys: [key] } satisfies SaveResult;
  });
}

export interface SettingHistoryEntry {
  id: number;
  value: unknown;
  displayValue: string;
  effectiveFrom: Date;
  reason: string;
  createdAt: Date;
  createdByName: string | null;
}

export async function getSettingHistory(db: DbOrTx, key: SettingKey): Promise<SettingHistoryEntry[]> {
  const def = getDefinition(key);
  const rows = await db
    .select({
      id: policyValues.id,
      value: policyValues.value,
      effectiveFrom: policyValues.effectiveFrom,
      reason: policyValues.reason,
      createdAt: policyValues.createdAt,
      createdByName: adminUsers.name,
    })
    .from(policyValues)
    .leftJoin(adminUsers, eq(adminUsers.id, policyValues.createdBy))
    .where(eq(policyValues.key, key))
    .orderBy(desc(policyValues.effectiveFrom), desc(policyValues.id));
  return rows.map((r) => {
    const parsed = def.schema.safeParse(r.value);
    return { ...r, displayValue: parsed.success ? def.format(parsed.data) : `(현재 정의와 맞지 않는 값: ${JSON.stringify(r.value)})` };
  });
}
