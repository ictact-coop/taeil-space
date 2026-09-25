import { desc, eq, sql } from "drizzle-orm";
import { feeScheduleItemsSchema, type FeeScheduleItems } from "@/domain/pricing/fee-schedule";
import { classifyHistory, pickEffectiveRow, type HistoryStatus, type PolicyRow } from "@/domain/settings/resolve";
import { sameJson } from "@/lib/stable-json";
import { writeAudit } from "@/server/audit/log";
import { type Actor, type MutationResult, requireReason } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { adminUsers, feeSchedules, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

const PAST_TOLERANCE_MS = 10 * 60 * 1000;

export interface FeeScheduleVersion {
  id: number;
  effectiveFrom: Date;
  items: FeeScheduleItems | null;
  reason: string;
  createdAt: Date;
  createdByName: string | null;
  status: HistoryStatus;
}

const asRow = (r: { id: number; effectiveFrom: Date; items: unknown }): PolicyRow => ({
  id: r.id,
  key: "fee_schedule",
  value: r.items,
  effectiveFrom: r.effectiveFrom,
});

async function loadRows(db: DbOrTx) {
  return db.select({ id: feeSchedules.id, effectiveFrom: feeSchedules.effectiveFrom, items: feeSchedules.items }).from(feeSchedules);
}

/** 모든 요금표 버전 (최신 적용 시각 순) */
export async function listFeeSchedules(db: DbOrTx, now: Date = new Date()): Promise<FeeScheduleVersion[]> {
  const rows = await db
    .select({
      id: feeSchedules.id,
      effectiveFrom: feeSchedules.effectiveFrom,
      items: feeSchedules.items,
      reason: feeSchedules.reason,
      createdAt: feeSchedules.createdAt,
      createdByName: adminUsers.name,
    })
    .from(feeSchedules)
    .leftJoin(adminUsers, eq(adminUsers.id, feeSchedules.createdBy))
    .orderBy(desc(feeSchedules.effectiveFrom), desc(feeSchedules.id));
  const statuses = classifyHistory(rows.map(asRow), now, null);
  return rows.map((r) => {
    const parsed = feeScheduleItemsSchema.safeParse(r.items);
    return { ...r, items: parsed.success ? parsed.data : null, status: statuses.get(r.id) ?? "past" };
  });
}

/** 기준 시각에 적용되는 요금표 (없으면 null). 신청 스냅샷에는 id를 남긴다. */
export async function getFeeScheduleAt(db: DbOrTx, at: Date = new Date()): Promise<{ id: number; items: FeeScheduleItems } | null> {
  const row = pickEffectiveRow((await loadRows(db)).map(asRow), at);
  if (!row) return null;
  const parsed = feeScheduleItemsSchema.safeParse(row.value);
  return parsed.success ? { id: row.id, items: parsed.data } : null;
}

async function lock(tx: DbOrTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fee_schedules'))`);
}

/**
 * 새 요금표 버전 저장. 모든 공개 공간의 요금이 있어야 한다.
 * fieldErrors의 키는 "spaces.<공간id>.<항목>" 또는 "options.<순번>.<항목>".
 */
export async function saveFeeSchedule(
  db: Db,
  params: { actor: Actor; items: unknown; effectiveFrom: Date; reason: string; now?: Date },
): Promise<MutationResult<{ id: number }>> {
  assertCanManage(params.actor.role, "fees");
  const now = params.now ?? new Date();
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  if (params.effectiveFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return { ok: false, formError: "적용 시작 시각은 과거로 정할 수 없습니다." };
  }
  const effectiveFrom = params.effectiveFrom.getTime() < now.getTime() ? now : params.effectiveFrom;

  const parsed = feeScheduleItemsSchema.safeParse(params.items);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, formError: "입력값을 확인하세요.", fieldErrors };
  }
  const items = parsed.data;
  const keys = items.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) return { ok: false, formError: "옵션 키가 중복되었습니다." };

  return db.transaction(async (tx) => {
    await lock(tx);
    const allSpaces = await tx.select({ id: spaces.id, name: spaces.name, isPublic: spaces.isPublic }).from(spaces);
    const known = new Set(allSpaces.map((s) => s.id));
    const unknown = Object.keys(items.spaces).filter((id) => !known.has(id));
    if (unknown.length > 0) return { ok: false, formError: "없는 공간의 요금이 포함되어 있습니다." } as const;
    const missing = allSpaces.filter((s) => s.isPublic && !items.spaces[s.id]);
    if (missing.length > 0) {
      return { ok: false, formError: `공개 공간의 요금을 모두 입력하세요: ${missing.map((s) => s.name).join(", ")}` } as const;
    }
    const rows = await loadRows(tx);
    const current = pickEffectiveRow(rows.map(asRow), effectiveFrom);
    if (current && sameJson(current.value, items)) {
      return { ok: false, formError: "적용 중인 요금표와 같습니다." } as const;
    }
    const [created] = await tx
      .insert(feeSchedules)
      .values({ effectiveFrom, items, reason: params.reason.trim(), createdBy: params.actor.id })
      .returning({ id: feeSchedules.id });
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: effectiveFrom.getTime() > now.getTime() ? "fee_schedule.schedule" : "fee_schedule.create",
      targetType: "fee_schedule",
      targetId: String(created!.id),
      before: current ? { feeScheduleId: current.id } : null,
      after: { effectiveFrom: effectiveFrom.toISOString(), items },
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true, value: { id: created!.id } } as const;
  });
}

/** 예약된 요금표 취소: 같은 적용 시각에 직전 요금표를 다시 추가한다. */
export async function cancelScheduledFeeSchedule(
  db: Db,
  params: { actor: Actor; id: number; reason: string; now?: Date },
): Promise<MutationResult> {
  assertCanManage(params.actor.role, "fees");
  const now = params.now ?? new Date();
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  return db.transaction(async (tx) => {
    await lock(tx);
    const rows = (await loadRows(tx)).map(asRow);
    const status = classifyHistory(rows, now, null).get(params.id);
    const target = rows.find((r) => r.id === params.id);
    if (!target || status !== "scheduled") return { ok: false, formError: "취소할 수 있는 예약이 아닙니다." } as const;
    const previous = pickEffectiveRow(
      rows.filter((r) => r.effectiveFrom.getTime() < target.effectiveFrom.getTime()),
      target.effectiveFrom,
    );
    if (!previous) {
      return { ok: false, formError: "이전 요금표가 없어 취소할 수 없습니다. 적용 시작 시각을 바꾼 새 요금표를 저장하세요." } as const;
    }
    await tx.insert(feeSchedules).values({
      effectiveFrom: target.effectiveFrom,
      items: previous.value,
      reason: params.reason.trim(),
      createdBy: params.actor.id,
    });
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: "fee_schedule.cancel_scheduled",
      targetType: "fee_schedule",
      targetId: String(params.id),
      after: { restoredFrom: previous.id, effectiveFrom: target.effectiveFrom.toISOString() },
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true } as const;
  });
}
