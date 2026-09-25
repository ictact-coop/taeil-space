import { asc, eq } from "drizzle-orm";
import { spaceInputSchema } from "@/domain/spaces/space-input";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode, requireReason } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

export type Space = typeof spaces.$inferSelect;

export function listSpaces(db: DbOrTx): Promise<Space[]> {
  return db.select().from(spaces).orderBy(asc(spaces.sortOrder), asc(spaces.name));
}

export async function getSpace(db: DbOrTx, id: string): Promise<Space | null> {
  const [row] = await db.select().from(spaces).where(eq(spaces.id, id));
  return row ?? null;
}

function auditView(s: Space) {
  const { createdAt: _c, updatedAt: _u, ...rest } = s;
  return rest;
}

export async function saveSpace(
  db: Db,
  params: { actor: Actor; id: string | null; raw: Record<string, unknown>; reason: string },
): Promise<MutationResult<Space>> {
  assertCanManage(params.actor.role, "spaces");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  const parsed = spaceInputSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      if (params.id === null) {
        const [created] = await tx.insert(spaces).values(input).returning();
        await writeAudit(tx, {
          actorType: "admin",
          actorId: params.actor.id,
          action: "space.create",
          targetType: "space",
          targetId: created!.id,
          after: auditView(created!),
          reason: params.reason.trim(),
          ip: params.actor.ip,
        });
        return { ok: true, value: created! } as const;
      }
      const [before] = await tx.select().from(spaces).where(eq(spaces.id, params.id)).for("update");
      if (!before) return { ok: false, formError: "공간을 찾을 수 없습니다." } as const;
      const [after] = await tx.update(spaces).set(input).where(eq(spaces.id, params.id)).returning();
      await writeAudit(tx, {
        actorType: "admin",
        actorId: params.actor.id,
        action: "space.update",
        targetType: "space",
        targetId: params.id,
        before: auditView(before),
        after: auditView(after!),
        reason: params.reason.trim(),
        ip: params.actor.ip,
      });
      return { ok: true, value: after! } as const;
    });
  } catch (e) {
    if (pgErrorCode(e) === "23505") return { ok: false, fieldErrors: { code: "이미 쓰고 있는 코드입니다." } };
    throw e;
  }
}
