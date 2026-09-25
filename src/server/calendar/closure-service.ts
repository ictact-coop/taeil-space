import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { closureInputSchema } from "@/domain/calendar/closure-input";
import { evaluateClosure, type ClosureRule } from "@/domain/calendar/closures";
import { kstDateOf } from "@/lib/time";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, requireReason } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { applications, closureRules, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

/** 일정을 점유하고 있는(아직 끝나지 않은) 신청 상태 */
export const ACTIVE_APPLICATION_STATUSES = [
  "pending_payment",
  "submitted",
  "reviewing",
  "revision_requested",
  "confirmed",
  "cancel_requested",
] as const;

type ClosureRow = typeof closureRules.$inferSelect;

export function toClosureRule(row: ClosureRow): ClosureRule {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    publicMessage: row.publicMessage,
    spaceId: row.spaceId,
    weekday: row.weekday,
    month: row.month,
    day: row.day,
    startDate: row.startDate,
    endDate: row.endDate,
    activeFrom: row.activeFrom,
    activeUntil: row.activeUntil,
    isActive: row.isActive,
  };
}

export async function listClosureRules(db: DbOrTx, opts: { includeInactive?: boolean } = {}): Promise<ClosureRow[]> {
  return db
    .select()
    .from(closureRules)
    .where(opts.includeInactive ? undefined : eq(closureRules.isActive, true))
    .orderBy(desc(closureRules.isActive), asc(closureRules.type), asc(closureRules.startDate), asc(closureRules.createdAt));
}

export interface ClosureConflict {
  applicationNo: string;
  spaceName: string;
  date: string;
  orgName: string;
  status: string;
}

/** 새 규칙을 넣으면 휴관이 되는 날짜에 걸린 진행 중 신청 */
async function findConflicts(db: DbOrTx, rule: ClosureRule, now: Date): Promise<ClosureConflict[]> {
  if (rule.type === "open_exception") return [];
  const existing = (await listClosureRules(db)).map(toClosureRule);
  const rows = await db
    .select({
      applicationNo: applications.applicationNo,
      spaceId: applications.spaceId,
      spaceName: spaces.name,
      startsAt: applications.startsAt,
      orgName: applications.orgName,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(and(inArray(applications.status, [...ACTIVE_APPLICATION_STATUSES]), gte(applications.startsAt, now)));
  return rows
    .map((r) => ({ ...r, date: kstDateOf(r.startsAt) }))
    .filter((r) => !evaluateClosure(r.date, r.spaceId, existing).closed && evaluateClosure(r.date, r.spaceId, [...existing, rule]).closed)
    .map(({ applicationNo, spaceName, date, orgName, status }) => ({ applicationNo, spaceName, date, orgName, status }));
}

export type CreateClosureResult =
  | { ok: true; value: ClosureRow; conflicts: ClosureConflict[] }
  | { ok: false; formError?: string; fieldErrors?: Partial<Record<string, string>>; conflicts?: ClosureConflict[] };

/**
 * 휴관 규칙 추가. 진행 중인 신청과 겹치면 confirmConflicts=true로 다시 호출해야 저장한다.
 * 기존 신청은 자동으로 취소하지 않는다(계획서 2.6).
 */
export async function createClosureRule(
  db: Db,
  params: { actor: Actor; raw: Record<string, unknown>; reason: string; confirmConflicts?: boolean; now?: Date },
): Promise<CreateClosureResult> {
  assertCanManage(params.actor.role, "closures");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  const parsed = closureInputSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;
  const now = params.now ?? new Date();

  return db.transaction(async (tx) => {
    const conflicts = await findConflicts(tx, { ...input, id: "new", isActive: true }, now);
    if (conflicts.length > 0 && !params.confirmConflicts) {
      return {
        ok: false,
        formError: `이 규칙을 넣으면 진행 중인 신청 ${conflicts.length}건의 이용일이 휴관일이 됩니다. 확인 후 다시 저장하세요.`,
        conflicts,
      } as const;
    }
    const [created] = await tx.insert(closureRules).values({ ...input, createdBy: params.actor.id }).returning();
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: "closure.create",
      targetType: "closure_rule",
      targetId: created!.id,
      after: { ...input, conflicts: conflicts.map((c) => c.applicationNo) },
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true, value: created!, conflicts } as const;
  });
}

/** 휴관 규칙 끄기 (기록 보존을 위해 지우지 않는다) */
export async function deactivateClosureRule(
  db: Db,
  params: { actor: Actor; id: string; reason: string },
): Promise<MutationResult> {
  assertCanManage(params.actor.role, "closures");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(closureRules).where(eq(closureRules.id, params.id)).for("update");
    if (!before || !before.isActive) return { ok: false, formError: "이미 꺼진 규칙이거나 찾을 수 없습니다." } as const;
    await tx.update(closureRules).set({ isActive: false }).where(eq(closureRules.id, params.id));
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: "closure.deactivate",
      targetType: "closure_rule",
      targetId: params.id,
      before: toClosureRule(before),
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true } as const;
  });
}
