import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import type { Actor, MutationResult } from "@/server/actor";
import { payments, refundBasis, refunds } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { enqueueApplicationNotification } from "@/server/notifications/queue";
import type { PaymentGateway } from "./gateway";

export type RefundBasis = (typeof refundBasis.enumValues)[number];
export const MAX_REFUND_ATTEMPTS = 5;

export const refundBasisLabels: Record<RefundBasis, string> = {
  rejected: "반려",
  revision_expired: "보완기한 만료",
  withdrawn: "승인 전 철회",
  cancelled: "확정 후 취소",
  venue_fault: "기념관 사정",
  late_payment: "기한 후 결제",
  payment_error: "결제 오류",
};

/**
 * 환불 요청 생성 (결제 1건 기준). 환불 가능 잔액을 넘지 않게 금액을 정한다.
 * 금액이 0원이면 만들지 않고 null을 돌려준다.
 */
export async function createRefund(
  tx: DbOrTx,
  params: { applicationId: string; basis: RefundBasis; ratePercent: number; reason: string; requestedBy?: string | null },
): Promise<string | null> {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.applicationId, params.applicationId), eq(payments.status, "paid")))
    .orderBy(desc(payments.paidAt))
    .limit(1);
  if (!payment || payment.amount === 0) return null;
  const [{ used }] = (await tx
    .select({ used: sql<number>`coalesce(sum(${refunds.amount}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["requested", "succeeded"])))) as [{ used: number }];
  const amount = Math.min(Math.floor((payment.amount * params.ratePercent) / 100), payment.amount - used);
  if (amount <= 0) return null;
  const [row] = await tx
    .insert(refunds)
    .values({
      paymentId: payment.id,
      applicationId: params.applicationId,
      basis: params.basis,
      ratePercent: params.ratePercent,
      amount,
      reason: params.reason,
      requestedBy: params.requestedBy ?? null,
    })
    .returning({ id: refunds.id });
  return row!.id;
}

async function markSucceeded(tx: DbOrTx, refund: typeof refunds.$inferSelect, patch: Partial<typeof refunds.$inferInsert>) {
  await tx.update(refunds).set({ status: "succeeded", completedAt: new Date(), failureReason: null, ...patch }).where(eq(refunds.id, refund.id));
  const [{ total }] = (await tx
    .select({ total: sql<number>`coalesce(sum(${refunds.amount}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.paymentId, refund.paymentId), eq(refunds.status, "succeeded")))) as [{ total: number }];
  const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId));
  if (payment && total >= payment.amount) await tx.update(payments).set({ status: "cancelled" }).where(eq(payments.id, payment.id));
  await writeAudit(tx, {
    actorType: patch.completedBy ? "admin" : "system",
    actorId: patch.completedBy ?? null,
    action: "refund.succeeded",
    targetType: "refund",
    targetId: refund.id,
    after: { amount: refund.amount, basis: refund.basis, manual: Boolean(patch.manualNote) },
  });
  await enqueueApplicationNotification(tx, "refunded", refund.applicationId, { refundAmount: refund.amount });
}

/**
 * 환불 처리. PG 결제는 PortOne 취소를 호출하고, 계좌이체는 담당자가 이체한 뒤 수동 완료한다.
 * 실패하면 시도 횟수를 늘리고, 최대 횟수를 넘으면 재처리 목록(failed)으로 보낸다.
 */
export async function processRefund(db: Db, gateway: PaymentGateway | null, refundId: string): Promise<"succeeded" | "requested" | "failed" | "manual" | "skipped"> {
  return db.transaction(async (tx) => {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!refund || refund.status !== "requested") return "skipped" as const;
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId));
    if (!payment) return "skipped" as const;
    if (payment.method === "bank_transfer") return "manual" as const;
    if (payment.method === "free") {
      await markSucceeded(tx, refund, {});
      return "succeeded" as const;
    }
    const attempts = refund.attemptCount + 1;
    if (!gateway) {
      await tx.update(refunds).set({ attemptCount: attempts, failureReason: "결제 연동이 설정되지 않았습니다.", status: attempts >= MAX_REFUND_ATTEMPTS ? "failed" : "requested" }).where(eq(refunds.id, refund.id));
      return attempts >= MAX_REFUND_ATTEMPTS ? ("failed" as const) : ("requested" as const);
    }
    const result = await gateway.cancel(payment.orderId, refund.amount, refund.reason ?? "대관 환불");
    if (result.status === "SUCCEEDED") {
      await markSucceeded(tx, refund, { attemptCount: attempts, providerRaw: result.raw as object });
      return "succeeded" as const;
    }
    if (result.status === "REQUESTED") {
      // PG가 비동기로 처리하는 경우: 웹훅이나 다음 조회에서 확정
      await tx.update(refunds).set({ attemptCount: attempts, providerRaw: result.raw as object, failureReason: "PG 처리 대기" }).where(eq(refunds.id, refund.id));
      return "requested" as const;
    }
    const failed = attempts >= MAX_REFUND_ATTEMPTS;
    await tx
      .update(refunds)
      .set({ attemptCount: attempts, status: failed ? "failed" : "requested", failureReason: result.failureReason, providerRaw: result.raw as object })
      .where(eq(refunds.id, refund.id));
    if (failed) {
      await writeAudit(tx, { actorType: "system", action: "refund.failed", targetType: "refund", targetId: refund.id, after: { reason: result.failureReason } });
    }
    return failed ? ("failed" as const) : ("requested" as const);
  });
}

/** 작업 프로세스: 요청 상태 PG 환불 재시도 */
export async function processPendingRefunds(db: Db, gateway: PaymentGateway | null, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(eq(refunds.status, "requested"), eq(payments.method, "pg"), or(eq(refunds.attemptCount, 0), lt(refunds.updatedAt, new Date(now.getTime() - 60_000)))))
    .limit(50);
  let done = 0;
  for (const r of due) if ((await processRefund(db, gateway, r.id)) === "succeeded") done += 1;
  return done;
}

/** 계좌이체 환불 등 담당자가 직접 처리한 환불을 완료로 기록 */
export async function completeManualRefund(db: Db, params: { actor: Actor; refundId: string; note: string }): Promise<MutationResult> {
  if (params.note.trim().length < 2) return { ok: false, formError: "처리 내용을 입력하세요(예: 입금 계좌·이체일)." };
  return db.transaction(async (tx) => {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, params.refundId)).for("update");
    if (!refund || (refund.status !== "requested" && refund.status !== "failed")) return { ok: false, formError: "처리할 수 있는 환불이 아닙니다." } as const;
    await markSucceeded(tx, refund, { manualNote: params.note.trim(), completedBy: params.actor.id });
    return { ok: true } as const;
  });
}

/** 실패한 PG 환불 다시 시도 */
export async function retryRefund(db: Db, gateway: PaymentGateway | null, params: { actor: Actor; refundId: string }): Promise<MutationResult> {
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, params.refundId));
  if (!refund || refund.status !== "failed") return { ok: false, formError: "재처리할 수 있는 환불이 아닙니다." };
  await db.update(refunds).set({ status: "requested", attemptCount: 0, failureReason: null }).where(eq(refunds.id, refund.id));
  await writeAudit(db, { actorType: "admin", actorId: params.actor.id, action: "refund.retry", targetType: "refund", targetId: refund.id, ip: params.actor.ip });
  const r = await processRefund(db, gateway, refund.id);
  return r === "succeeded" ? { ok: true } : { ok: false, formError: r === "requested" ? "PG 처리 대기 중입니다." : "다시 실패했습니다. PG 관리자 화면을 확인하세요." };
}
