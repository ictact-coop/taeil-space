import { and, eq, inArray } from "drizzle-orm";
import { repriceWithDiscount, type PriceQuote } from "@/domain/pricing/calculate";
import { formatWon } from "@/domain/pricing/fee-schedule";
import type { Actor, MutationResult } from "@/server/actor";
import { writeAudit } from "@/server/audit/log";
import { assertPermission } from "@/server/auth/permissions";
import { applicationStatusHistory, applications, discountRules, payments, refunds } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import type { PaymentGateway } from "@/server/payments/gateway";
import { createRefund, processRefund } from "@/server/payments/refunds";
import { lockApplication, TransitionError } from "./transition";

/** 감면을 나중에 적용·변경할 수 있는 상태 */
export const DISCOUNT_EDITABLE_STATUSES = ["pending_payment", "submitted", "reviewing", "revision_requested", "confirmed"] as const;

/**
 * 관리자가 신청의 감면을 나중에 적용·변경·해제한다(증빙을 따로 받은 경우 등).
 * - 요금은 신청 당시 계산한 금액(기본·추가·옵션)을 그대로 두고 감면만 다시 계산한다.
 * - 입금 전(입금 대기): 받을 금액을 바꾼다. 입금 화면·입금 확인 금액이 새 금액이 된다.
 * - 입금 후: 줄어든 만큼 환불 요청을 만든다(계좌이체는 환불 처리 목록에서 이체 후 완료). 금액이 늘어나는 변경은 막는다.
 */
export async function changeApplicationDiscount(
  db: Db,
  gateway: PaymentGateway | null,
  p: { actor: Actor; applicationId: string; discountRuleId: string | null; reason: string },
): Promise<MutationResult<{ total: number; refundAmount: number }>> {
  assertPermission(p.actor, "applications.review");
  const reason = p.reason.trim();
  if (reason.length < 2) return { ok: false, formError: "변경 사유를 입력하세요." };
  let refundId: string | null = null;
  let result = { total: 0, refundAmount: 0 };
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      if (!(DISCOUNT_EDITABLE_STATUSES as readonly string[]).includes(app.status)) throw new TransitionError("이 상태의 신청은 감면을 바꿀 수 없습니다.");
      const price = app.priceSnapshot as PriceQuote | null;
      if (!price?.items?.length) throw new TransitionError("요금 내역이 없어 감면을 계산할 수 없습니다(요금표 없이 들어온 신청).");
      const [rule] = p.discountRuleId ? await tx.select().from(discountRules).where(eq(discountRules.id, p.discountRuleId)) : [];
      if (p.discountRuleId && !rule) throw new TransitionError("감면 항목을 찾을 수 없습니다.");
      if ((rule?.id ?? null) === app.discountRuleId) throw new TransitionError("지금과 같은 감면입니다.");

      const next = repriceWithDiscount(price, rule ? { name: rule.name, kind: rule.kind, value: rule.value } : null);
      const before = app.totalAmount ?? 0;
      const paid = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.applicationId, app.id), eq(payments.status, "paid")));
      // 실제로 받은 돈 = 결제액 − 이미 요청·완료한 환불(같은 신청에서 감면을 여러 번 바꿔도 겹쳐 환불하지 않게)
      const refunded = paid.length
        ? await tx
            .select({ amount: refunds.amount })
            .from(refunds)
            .where(and(eq(refunds.applicationId, app.id), inArray(refunds.status, ["requested", "succeeded"])))
        : [];
      const paidAmount = paid.reduce((s, x) => s + x.amount, 0) - refunded.reduce((s, x) => s + x.amount, 0);

      if (app.status === "pending_payment") {
        await tx
          .update(payments)
          .set({ amount: next.total })
          .where(and(eq(payments.applicationId, app.id), inArray(payments.status, ["ready"])));
      } else if (next.total > paidAmount) {
        throw new TransitionError(`이미 받은 금액(${formatWon(paidAmount)})보다 커지는 변경은 여기서 할 수 없습니다. 차액은 따로 안내해 받으세요.`);
      } else if (next.total < paidAmount) {
        refundId = await createRefund(tx, {
          applicationId: app.id,
          basis: "discount",
          ratePercent: 0,
          amount: paidAmount - next.total,
          reason: `감면 적용 차액: ${reason}`,
          requestedBy: p.actor.id,
        });
      }

      const policy = (app.policySnapshot as Record<string, unknown> | null) ?? {};
      await tx
        .update(applications)
        .set({
          discountRuleId: rule?.id ?? null,
          priceSnapshot: next,
          totalAmount: next.total,
          policySnapshot: {
            ...policy,
            discount: rule ? { id: rule.id, name: rule.name, kind: rule.kind, value: rule.value, proofRequired: rule.proofRequired } : null,
            discountChangedBy: p.actor.id,
          },
        })
        .where(eq(applications.id, app.id));
      const label = rule ? `감면 적용: ${rule.name}` : "감면 해제";
      await tx.insert(applicationStatusHistory).values({
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: app.status,
        actorType: "admin",
        actorId: p.actor.id,
        reason: `${label} (${formatWon(before)} → ${formatWon(next.total)}): ${reason}`,
      });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.actor.id,
        action: "application.discount_changed",
        targetType: "application",
        targetId: app.id,
        before: { discountRuleId: app.discountRuleId, totalAmount: before },
        after: { discountRuleId: rule?.id ?? null, totalAmount: next.total },
        reason,
        ip: p.actor.ip,
      });
      result = { total: next.total, refundAmount: next.total < paidAmount && app.status !== "pending_payment" ? paidAmount - next.total : 0 };
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  if (refundId) await processRefund(db, gateway, refundId);
  return { ok: true, value: result };
}
