import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import { applications, applicationStatusHistory, payments, slotOccupancies } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";

/** 결제대기 → 미결제취소 처리 (한 건) */
async function expireOne(tx: DbOrTx, applicationId: string, now: Date): Promise<boolean> {
  const updated = await tx
    .update(applications)
    .set({ status: "payment_expired" })
    .where(and(eq(applications.id, applicationId), eq(applications.status, "pending_payment")))
    .returning({ id: applications.id, applicationNo: applications.applicationNo });
  await tx.delete(slotOccupancies).where(and(eq(slotOccupancies.applicationId, applicationId), eq(slotOccupancies.kind, "pending_payment")));
  if (updated.length === 0) return false;
  await tx
    .update(payments)
    .set({ status: "cancelled", failureReason: "결제 유효시간 만료" })
    .where(and(eq(payments.applicationId, applicationId), eq(payments.status, "ready")));
  await tx.insert(applicationStatusHistory).values({
    applicationId,
    fromStatus: "pending_payment",
    toStatus: "payment_expired",
    actorType: "system",
    reason: "결제 유효시간 만료",
  });
  await writeAudit(tx, {
    actorType: "system",
    action: "application.payment_expired",
    targetType: "application",
    targetId: applicationId,
    after: { applicationNo: updated[0]!.applicationNo, expiredAt: now.toISOString() },
  });
  return true;
}

/** 결제 유효시간이 지난 신청을 모두 미결제취소로 바꾸고 일정을 다시 연다 (AT-08). 작업 큐가 1분마다 실행한다. */
export async function expirePendingApplications(db: Db, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ applicationId: slotOccupancies.applicationId })
    .from(slotOccupancies)
    .where(and(eq(slotOccupancies.kind, "pending_payment"), isNotNull(slotOccupancies.expiresAt), lte(slotOccupancies.expiresAt, now)))
    .limit(500);
  let count = 0;
  for (const { applicationId } of due) {
    if (!applicationId) continue;
    const done = await db.transaction(async (tx) => {
      // 결제 완료 처리와 동시에 일어나지 않도록 신청 행을 잠근다(잠겨 있으면 다음 차례에)
      const locked = await tx.execute(sql`select id from applications where id = ${applicationId} for update skip locked`);
      if (locked.rows.length === 0) return false;
      return expireOne(tx, applicationId, now);
    });
    if (done) count += 1;
  }
  return count;
}

/** 새 신청이 들어올 때, 요청 범위와 겹치는 만료된 결제대기를 같은 트랜잭션에서 먼저 정리한다. */
export async function releaseExpiredOverlapping(tx: DbOrTx, spaceId: string, from: Date, to: Date, now: Date): Promise<void> {
  const rows = await tx
    .select({ applicationId: slotOccupancies.applicationId })
    .from(slotOccupancies)
    .where(
      and(
        eq(slotOccupancies.spaceId, spaceId),
        eq(slotOccupancies.kind, "pending_payment"),
        lte(slotOccupancies.expiresAt, now),
        sql`${slotOccupancies.during} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`,
      ),
    );
  for (const r of rows) if (r.applicationId) await expireOne(tx, r.applicationId, now);
}
