import { and, eq, gt, lte, sql } from "drizzle-orm";
import { payments, slotOccupancies } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import { getSettings } from "@/server/settings/service";

/**
 * 계좌이체 입금 기한 임박 알림. 기한 N시간 전(알림 설정)에 아직 입금 확인 전인 신청에 한 번만 보낸다.
 * 작업 프로세스가 10분마다 실행한다.
 */
export async function sendDepositReminders(db: Db, now: Date = new Date()): Promise<number> {
  const settings = await getSettings(db, now);
  const until = new Date(now.getTime() + settings["notification.paymentDeadlineHours"] * 3_600_000);
  const due = await db
    .selectDistinct({ applicationId: slotOccupancies.applicationId })
    .from(slotOccupancies)
    .innerJoin(payments, eq(payments.applicationId, slotOccupancies.applicationId))
    .where(
      and(
        eq(slotOccupancies.kind, "pending_payment"),
        gt(slotOccupancies.expiresAt, now),
        lte(slotOccupancies.expiresAt, until),
        eq(payments.method, "bank_transfer"),
        eq(payments.status, "ready"),
        sql`not exists (select 1 from notification_logs n where n.application_id = ${slotOccupancies.applicationId} and n.event = 'deposit_reminder')`,
      ),
    )
    .limit(200);
  let count = 0;
  for (const { applicationId } of due) {
    if (!applicationId) continue;
    await db.transaction((tx) => enqueueApplicationNotification(tx, "deposit_reminder", applicationId));
    count += 1;
  }
  if (count > 0) await flushNotifications(db).catch(() => undefined);
  return count;
}
