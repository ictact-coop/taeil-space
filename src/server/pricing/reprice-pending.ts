import { and, eq, inArray, sql } from "drizzle-orm";
import { calculatePrice, type DiscountForPrice, type PriceQuote } from "@/domain/pricing/calculate";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { toMinutes } from "@/domain/booking/time";
import { toMinutesOfDay } from "@/lib/time-of-day";
import { writeAudit } from "@/server/audit/log";
import { applications, applicationStatusHistory, payments } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { getSettings } from "@/server/settings/service";
import { getFeeScheduleAt } from "./fee-service";

/**
 * 새 요금표가 적용되면 아직 입금(결제) 전인 신청의 금액을 새 요금표로 다시 계산한다(2026-10 결정).
 * - 대상: 결제대기(pending_payment)이고 계좌이체 결제가 아직 ready인 신청 중 신청 당시 요금표 id가 지금 요금표와 다른 것
 *   (PG 결제창이 이미 열린 건은 금액이 어긋나므로 건드리지 않는다)
 * - 감면은 신청에 적용된 감면 그대로, 옵션은 새 요금표에 남아 있는 것만 다시 계산한다
 * - 새 요금표에 그 공간 요금이 없으면 금액은 그대로 두고 요금표 id만 기록한다(같은 요금표로 매번 다시 보지 않게)
 * 저장 직후(즉시 적용)와 작업 큐(1분마다, 예약 적용분)에서 실행한다. 바뀐 건수를 돌려준다.
 */
export async function repricePendingApplications(db: Db, now: Date = new Date()): Promise<number> {
  const fee = await getFeeScheduleAt(db, now);
  if (!fee) return 0;
  const stale = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.status, "pending_payment"),
        sql`(${applications.policySnapshot}->>'feeScheduleId') is distinct from ${String(fee.id)}`,
        sql`exists (select 1 from payments p where p.application_id = ${applications.id} and p.status = 'ready' and p.method = 'bank_transfer')`,
      ),
    );
  if (stale.length === 0) return 0;
  const dayEnd = toMinutes((await getSettings(db, now))["operation.dayEnd"]);

  let changed = 0;
  for (const { id } of stale) {
    const done = await db.transaction(async (tx) => {
      const [app] = await tx.select().from(applications).where(eq(applications.id, id)).for("update");
      if (!app || app.status !== "pending_payment") return false;
      const policy = (app.policySnapshot as Record<string, unknown> | null) ?? {};
      if (policy.feeScheduleId === fee.id) return false;
      const spaceFee = app.spaceId ? fee.items.spaces[app.spaceId] : undefined;
      const discount = (policy.discount as DiscountForPrice | null | undefined) ?? null;
      const start = toMinutesOfDay(app.startsAt);
      // 자정에 끝나는 신청은 24:00으로 본다
      const end = toMinutesOfDay(app.endsAt) || 24 * 60;
      const next: PriceQuote | null =
        spaceFee && end > start
          ? calculatePrice({
              fee: spaceFee,
              startMinutes: start,
              endMinutes: end,
              dayEndMinutes: dayEnd,
              options: fee.items.options,
              selectedOptionKeys: app.optionKeys,
              discount: discount ? { name: discount.name, kind: discount.kind, value: discount.value } : null,
            })
          : null;
      const before = app.totalAmount ?? 0;
      const policyNext = { ...policy, feeScheduleId: fee.id, repricedFrom: policy.feeScheduleId ?? null };
      if (!next || next.total <= 0) {
        // 요금이 없거나 0원이 되는 경우는 자동으로 바꾸지 않는다(0원은 결제 없이 접수되는 흐름이라 관리자가 판단)
        await tx.update(applications).set({ policySnapshot: policyNext }).where(eq(applications.id, id));
        return false;
      }
      await tx.update(applications).set({ priceSnapshot: next, totalAmount: next.total, policySnapshot: policyNext }).where(eq(applications.id, id));
      if (next.total === before) return false;
      await tx
        .update(payments)
        .set({ amount: next.total, updatedAt: now })
        .where(and(eq(payments.applicationId, id), inArray(payments.status, ["ready"])));
      const reason = `새 요금표 적용으로 금액 변경 (${formatWon(before)} → ${formatWon(next.total)})`;
      await tx.insert(applicationStatusHistory).values({
        applicationId: id,
        fromStatus: app.status,
        toStatus: app.status,
        actorType: "system",
        reason,
      });
      await writeAudit(tx, {
        actorType: "system",
        action: "application.repriced",
        targetType: "application",
        targetId: id,
        before: { feeScheduleId: policy.feeScheduleId ?? null, totalAmount: before },
        after: { feeScheduleId: fee.id, totalAmount: next.total },
        reason,
      });
      return true;
    });
    if (done) changed++;
  }
  return changed;
}
