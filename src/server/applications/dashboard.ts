import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { addDays } from "@/domain/calendar/closures";
import { kstDateOf, kstStartOfDay } from "@/lib/time";
import { applications, notificationLogs, refunds, scheduleBlocks, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { getSettings } from "@/server/settings/service";

/** 대시보드 (ADM-001): 처리할 일과 오늘 일정 */
export async function getDashboard(db: DbOrTx, now: Date = new Date()) {
  const settings = await getSettings(db, now);
  const today = kstDateOf(now);
  const dayStart = kstStartOfDay(today);
  const dayEnd = kstStartOfDay(addDays(today, 1));
  const statusCounts = await db.select({ status: applications.status, n: count() }).from(applications).groupBy(applications.status);
  const c = (s: string) => statusCounts.find((x) => x.status === s)?.n ?? 0;
  const warnBefore = new Date(now.getTime() - settings["payment.reviewDelayWarningDays"] * 24 * 3600_000);
  const [delayed] = await db
    .select({ n: count() })
    .from(applications)
    .where(and(inArray(applications.status, ["submitted", "reviewing"]), lt(applications.paidAt, warnBefore)));
  const [refundTodo] = await db.select({ n: count() }).from(refunds).where(inArray(refunds.status, ["requested", "failed"]));
  const [refundFailed] = await db.select({ n: count() }).from(refunds).where(eq(refunds.status, "failed"));
  const [mailFailed] = await db.select({ n: count() }).from(notificationLogs).where(eq(notificationLogs.status, "failed"));
  const todays = await db
    .select({ applicationNo: applications.applicationNo, orgName: applications.orgName, eventTitle: applications.eventTitle, startsAt: applications.startsAt, endsAt: applications.endsAt, spaceName: spaces.name, status: applications.status })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(and(inArray(applications.status, ["confirmed", "submitted", "reviewing"]), gte(applications.startsAt, dayStart), lt(applications.startsAt, dayEnd)))
    .orderBy(applications.startsAt);
  const blocksToday = await db
    .select({ reason: scheduleBlocks.reason, startsAt: scheduleBlocks.startsAt, endsAt: scheduleBlocks.endsAt })
    .from(scheduleBlocks)
    .where(and(lt(scheduleBlocks.startsAt, dayEnd), sql`${scheduleBlocks.endsAt} > ${dayStart.toISOString()}::timestamptz`));
  return {
    newApplications: c("submitted"),
    reviewing: c("reviewing"),
    revision: c("revision_requested"),
    pendingPayment: c("pending_payment"),
    delayed: delayed?.n ?? 0,
    delayDays: settings["payment.reviewDelayWarningDays"],
    refundTodo: refundTodo?.n ?? 0,
    refundFailed: refundFailed?.n ?? 0,
    mailFailed: mailFailed?.n ?? 0,
    todays,
    blocksToday,
  };
}

/** 대관 캘린더 (ADM-002): 월 단위 신청·예약·차단 */
export async function getMonthSchedule(db: DbOrTx, month: string, spaceId: string | null) {
  const from = kstStartOfDay(`${month}-01`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const to = kstStartOfDay(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
  const apps = await db
    .select({ applicationNo: applications.applicationNo, orgName: applications.orgName, status: applications.status, startsAt: applications.startsAt, endsAt: applications.endsAt, spaceName: spaces.name, spaceId: spaces.id })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(
      and(
        inArray(applications.status, ["pending_payment", "submitted", "reviewing", "revision_requested", "confirmed", "completed"]),
        gte(applications.startsAt, from),
        lt(applications.startsAt, to),
        spaceId ? eq(applications.spaceId, spaceId) : undefined,
      ),
    )
    .orderBy(applications.startsAt);
  const blocks = await db
    .select({ id: scheduleBlocks.id, reason: scheduleBlocks.reason, startsAt: scheduleBlocks.startsAt, endsAt: scheduleBlocks.endsAt, spaceId: scheduleBlocks.spaceId })
    .from(scheduleBlocks)
    .where(and(lt(scheduleBlocks.startsAt, to), sql`${scheduleBlocks.endsAt} > ${from.toISOString()}::timestamptz`));
  return { apps, blocks: spaceId ? blocks.filter((b) => b.spaceId === null || b.spaceId === spaceId) : blocks };
}
