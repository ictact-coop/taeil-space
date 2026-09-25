import { asc, eq } from "drizzle-orm";
import { discountInputSchema } from "@/domain/pricing/discount-input";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, requireReason } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { discountRules } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

export type DiscountRule = typeof discountRules.$inferSelect;

export function listDiscountRules(db: DbOrTx): Promise<DiscountRule[]> {
  return db.select().from(discountRules).orderBy(asc(discountRules.sortOrder), asc(discountRules.createdAt));
}

function auditView(d: DiscountRule) {
  const { createdAt: _c, updatedAt: _u, ...rest } = d;
  return rest;
}

export async function saveDiscountRule(
  db: Db,
  params: { actor: Actor; id: string | null; raw: Record<string, unknown>; reason: string },
): Promise<MutationResult<DiscountRule>> {
  assertCanManage(params.actor.role, "discounts");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  const parsed = discountInputSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  return db.transaction(async (tx) => {
    if (params.id === null) {
      const [created] = await tx.insert(discountRules).values({ ...parsed.data, createdBy: params.actor.id }).returning();
      await writeAudit(tx, {
        actorType: "admin",
        actorId: params.actor.id,
        action: "discount.create",
        targetType: "discount_rule",
        targetId: created!.id,
        after: auditView(created!),
        reason: params.reason.trim(),
        ip: params.actor.ip,
      });
      return { ok: true, value: created! } as const;
    }
    const [before] = await tx.select().from(discountRules).where(eq(discountRules.id, params.id)).for("update");
    if (!before) return { ok: false, formError: "감면 규칙을 찾을 수 없습니다." } as const;
    const [after] = await tx.update(discountRules).set(parsed.data).where(eq(discountRules.id, params.id)).returning();
    await writeAudit(tx, {
      actorType: "admin",
      actorId: params.actor.id,
      action: "discount.update",
      targetType: "discount_rule",
      targetId: params.id,
      before: auditView(before),
      after: auditView(after!),
      reason: params.reason.trim(),
      ip: params.actor.ip,
    });
    return { ok: true, value: after! } as const;
  });
}
