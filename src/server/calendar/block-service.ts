import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { blockInputSchema } from "@/domain/calendar/block-input";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { applications, scheduleBlocks, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

export function tstzRange(from: Date, to: Date): string {
  return `[${from.toISOString()},${to.toISOString()})`;
}

export async function listUpcomingBlocks(db: DbOrTx, now: Date = new Date()) {
  return db
    .select({ block: scheduleBlocks, spaceName: spaces.name })
    .from(scheduleBlocks)
    .leftJoin(spaces, eq(spaces.id, scheduleBlocks.spaceId))
    .where(gt(scheduleBlocks.endsAt, now))
    .orderBy(asc(scheduleBlocks.startsAt));
}

export interface BlockConflict {
  spaceName: string;
  label: string;
}

/** 차단하려는 시간과 겹치는 기존 점유 */
async function findOverlaps(db: DbOrTx, spaceIds: string[], from: Date, to: Date): Promise<BlockConflict[]> {
  const rows = await db
    .select({
      spaceName: spaces.name,
      kind: slotOccupancies.kind,
      applicationNo: applications.applicationNo,
      blockReason: scheduleBlocks.reason,
    })
    .from(slotOccupancies)
    .innerJoin(spaces, eq(spaces.id, slotOccupancies.spaceId))
    .leftJoin(applications, eq(applications.id, slotOccupancies.applicationId))
    .leftJoin(scheduleBlocks, eq(scheduleBlocks.id, slotOccupancies.scheduleBlockId))
    .where(and(inArray(slotOccupancies.spaceId, spaceIds), sql`${slotOccupancies.during} && ${tstzRange(from, to)}::tstzrange`));
  return rows.map((r) => ({
    spaceName: r.spaceName,
    label: r.applicationNo ? `신청 ${r.applicationNo}` : `차단: ${r.blockReason ?? ""}`,
  }));
}

export type CreateBlockResult =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Partial<Record<string, string>>; conflicts?: BlockConflict[] };

/**
 * 일정 차단 등록. 공간을 고르지 않으면 모든 공간에 등록한다.
 * 이미 신청·차단이 있는 시간과 겹치면 등록하지 않고 겹치는 목록을 돌려준다.
 */
export async function createBlock(
  db: Db,
  params: { actor: Actor; raw: Record<string, unknown> },
): Promise<CreateBlockResult> {
  assertCanManage(params.actor.role, "blocks");
  const parsed = blockInputSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;

  const targetSpaces = input.spaceId
    ? [input.spaceId]
    : (await db.select({ id: spaces.id }).from(spaces)).map((s) => s.id);
  if (targetSpaces.length === 0) return { ok: false, formError: "등록된 공간이 없습니다." };

  try {
    await db.transaction(async (tx) => {
      const [block] = await tx
        .insert(scheduleBlocks)
        .values({ ...input, createdBy: params.actor.id })
        .returning();
      await tx.insert(slotOccupancies).values(
        targetSpaces.map((spaceId) => ({
          spaceId,
          during: tstzRange(input.startsAt, input.endsAt),
          kind: "block" as const,
          scheduleBlockId: block!.id,
        })),
      );
      await writeAudit(tx, {
        actorType: "admin",
        actorId: params.actor.id,
        action: "block.create",
        targetType: "schedule_block",
        targetId: block!.id,
        after: { ...input, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), spaces: targetSpaces.length },
        reason: input.reason,
        ip: params.actor.ip,
      });
    });
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) !== "23P01") throw e;
    const conflicts = await findOverlaps(db, targetSpaces, input.startsAt, input.endsAt);
    return {
      ok: false,
      formError: "이미 신청이나 다른 차단이 있는 시간과 겹쳐 등록하지 못했습니다.",
      conflicts,
    };
  }
}

export async function deleteBlock(db: Db, params: { actor: Actor; id: string; reason: string }): Promise<MutationResult> {
  assertCanManage(params.actor.role, "blocks");
  if (params.reason.trim().length < 2) return { ok: false, formError: "삭제 사유를 입력하세요." };
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, params.id)).for("update");
    if (!before) return { ok: false, formError: "차단을 찾을 수 없습니다." } as const;
    await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.id, params.id)); // 점유 행은 cascade로 삭제
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: "block.delete",
      targetType: "schedule_block",
      targetId: params.id,
      before: { ...before, startsAt: before.startsAt.toISOString(), endsAt: before.endsAt.toISOString() },
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true } as const;
  });
}
