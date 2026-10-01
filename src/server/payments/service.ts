import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import { applications, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import { lockApplication, transition } from "@/server/applications/transition";
import type { PaymentGateway } from "./gateway";
import { createRefund, processRefund } from "./refunds";

export type ConfirmOutcome =
  | { outcome: "paid"; applicationNo: string }
  | { outcome: "already"; applicationNo: string }
  | { outcome: "late_refunded"; applicationNo: string }
  | { outcome: "amount_mismatch"; applicationNo: string }
  | { outcome: "not_paid"; applicationNo: string; status: string | null; reason: string | null }
  | { outcome: "unknown" };

/**
 * 결제 확정 ([요구] 17장, AT-07). 웹훅·브라우저 복귀·주기 대사 어디서 불러도 결과가 같다(멱등).
 * - 게이트웨이에 조회한 결제가 PAID이고 금액이 맞을 때만 확정한다.
 * - 결제대기 점유가 남아 있으면 신청접수로 바꾸고 일정을 계속 잡아 둔다.
 * - 이미 기한이 지나 풀린 신청에 결제가 들어오면 전액 자동 환불한다.
 */
export async function confirmPayment(db: Db, gateway: PaymentGateway, paymentId: string, now: Date = new Date()): Promise<ConfirmOutcome> {
  const remote = await gateway.getPayment(paymentId);
  const refundIds: string[] = [];
  const result = await db.transaction(async (tx): Promise<ConfirmOutcome> => {
    const [pay] = await tx.select().from(payments).where(eq(payments.orderId, paymentId)).for("update");
    if (!pay) return { outcome: "unknown" };
    const app = await lockApplication(tx, { id: pay.applicationId });
    if (!app) return { outcome: "unknown" };
    const no = app.applicationNo;
    if (pay.status === "paid") return { outcome: "already", applicationNo: no };

    if (!remote || remote.status !== "PAID") {
      if (remote && (remote.status === "FAILED" || remote.status === "CANCELLED") && pay.status === "ready") {
        await tx.update(payments).set({ status: "failed", failureReason: remote.failureReason ?? remote.status, providerRaw: remote.raw as object }).where(eq(payments.id, pay.id));
      }
      return { outcome: "not_paid", applicationNo: no, status: remote?.status ?? null, reason: remote?.failureReason ?? null };
    }

    // 돈은 들어왔으므로 결제 기록은 남긴다
    await tx
      .update(payments)
      .set({ status: "paid", providerTxId: remote.transactionId, paidAt: remote.paidAt ?? now, providerRaw: remote.raw as object })
      .where(eq(payments.id, pay.id));

    if (remote.amountTotal !== pay.amount) {
      await writeAudit(tx, {
        actorType: "system",
        action: "payment.amount_mismatch",
        targetType: "payment",
        targetId: pay.id,
        after: { expected: pay.amount, paid: remote.amountTotal },
      });
      // 금액이 다르면 신청을 진행하지 않고 받은 금액 전액을 돌려준다
      await tx.update(payments).set({ amount: remote.amountTotal }).where(eq(payments.id, pay.id));
      const id = await createRefund(tx, { applicationId: app.id, basis: "payment_error", ratePercent: 100, reason: "결제 금액 불일치" });
      if (id) refundIds.push(id);
      return { outcome: "amount_mismatch", applicationNo: no };
    }

    const [hold] = await tx
      .select()
      .from(slotOccupancies)
      .where(and(eq(slotOccupancies.applicationId, app.id), eq(slotOccupancies.kind, "pending_payment")))
      .for("update");
    if (app.status === "pending_payment" && hold) {
      await tx.update(slotOccupancies).set({ kind: "held", expiresAt: null }).where(eq(slotOccupancies.id, hold.id));
      await transition(tx, app, "submitted", { actorType: "system", reason: "결제 완료", patch: { paidAt: remote.paidAt ?? now } });
      await enqueueApplicationNotification(tx, "submitted", app.id);
      return { outcome: "paid", applicationNo: no };
    }

    const id = await createRefund(tx, { applicationId: app.id, basis: "late_payment", ratePercent: 100, reason: "결제 기한이 지난 뒤 결제되어 자동 환불" });
    if (id) refundIds.push(id);
    await writeAudit(tx, { actorType: "system", action: "payment.late", targetType: "application", targetId: app.id, after: { status: app.status } });
    return { outcome: "late_refunded", applicationNo: no };
  });
  for (const id of refundIds) await processRefund(db, gateway, id);
  await flushNotifications(db).catch(() => undefined);
  return result;
}

export interface CheckoutInfo {
  paymentId: string;
  amount: number;
  orderName: string;
  customer: { fullName: string; phoneNumber: string; email: string };
  expiresAt: Date;
}

/**
 * 결제창을 열기 전 준비: 결제대기이고 기한이 남은 신청만. 이전 시도가 실패했으면 새 주문번호를 만든다.
 */
export async function prepareCheckout(db: Db, applicationId: string, now: Date = new Date()): Promise<{ ok: true; checkout: CheckoutInfo } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, { id: applicationId });
    if (!app || app.status !== "pending_payment") return { ok: false, error: "결제할 수 있는 신청이 아닙니다." } as const;
    const [hold] = await tx
      .select()
      .from(slotOccupancies)
      .where(and(eq(slotOccupancies.applicationId, app.id), eq(slotOccupancies.kind, "pending_payment"), gt(slotOccupancies.expiresAt, now)));
    if (!hold?.expiresAt) return { ok: false, error: "결제 기한이 지났습니다. 다시 신청해 주세요." } as const;
    const [last] = await tx.select().from(payments).where(eq(payments.applicationId, app.id)).orderBy(desc(payments.createdAt)).limit(1);
    if (!last || last.method !== "pg") return { ok: false, error: "온라인 결제 대상이 아닙니다." } as const;
    let paymentId = last.orderId;
    if (last.status !== "ready") {
      paymentId = `${app.applicationNo}-${randomBytes(4).toString("hex")}`;
      await tx.insert(payments).values({ applicationId: app.id, orderId: paymentId, method: "pg", amount: app.totalAmount ?? 0 });
    }
    const [space] = await tx.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, app.spaceId));
    return {
      ok: true,
      checkout: {
        paymentId,
        amount: app.totalAmount ?? 0,
        orderName: `${space?.name ?? "공간"} 대관 ${app.applicationNo}`.slice(0, 40),
        customer: { fullName: app.contactName, phoneNumber: app.contactPhone, email: app.contactEmail },
        expiresAt: hold.expiresAt,
      },
    } as const;
  });
}

/**
 * 작업 프로세스: 웹훅이 오지 않았을 때를 대비해 결제 진행 중인 건을 PortOne에 다시 조회한다.
 * 기한이 지난 뒤 들어온 결제도 여기서 찾아 자동 환불한다.
 */
export async function reconcilePayments(db: Db, gateway: PaymentGateway, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ orderId: payments.orderId })
    .from(payments)
    .innerJoin(applications, eq(applications.id, payments.applicationId))
    .where(
      and(
        // 기한 만료·철회로 취소 처리된 결제도 실제로는 결제됐을 수 있으므로 함께 조회한다(한 번도 결제 확인 안 된 것만)
        inArray(payments.status, ["ready", "cancelled"]),
        isNull(payments.paidAt),
        eq(payments.method, "pg"),
        lt(payments.createdAt, new Date(now.getTime() - 2 * 60_000)),
        gt(payments.createdAt, new Date(now.getTime() - 2 * 24 * 3600_000)),
        inArray(applications.status, ["pending_payment", "payment_expired", "withdrawn"]),
      ),
    )
    .limit(100);
  let changed = 0;
  for (const r of rows) {
    const out = await confirmPayment(db, gateway, r.orderId, now);
    if (out.outcome === "paid" || out.outcome === "late_refunded") changed += 1;
  }
  return changed;
}
