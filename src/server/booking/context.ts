import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { effectiveBookingWindow } from "@/domain/calendar/booking-window";
import type { ClosureRule } from "@/domain/calendar/closures";
import { hoursFromSettings, type OperatingHours } from "@/domain/booking/time";
import type { BookingSpace } from "@/domain/booking/rules";
import type { SettingValues } from "@/domain/settings/definitions";
import { kstDateOf, toKstLocalInput } from "@/lib/time";
import { discountRules, slotOccupancies, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { getManualWindow } from "@/server/calendar/booking-window-service";
import { listClosureRules, toClosureRule } from "@/server/calendar/closure-service";
import { getFeeScheduleAt } from "@/server/pricing/fee-service";
import { getSettings } from "@/server/settings/service";
import type { FeeScheduleItems } from "@/domain/pricing/fee-schedule";

export type SpaceRow = typeof spaces.$inferSelect;

export interface BookingContext {
  now: Date;
  today: string;
  nowMinutes: number;
  settings: SettingValues;
  hours: OperatingHours;
  space: SpaceRow;
  bookingSpace: BookingSpace;
  closureRules: ClosureRule[];
  bookingWindow: { from: string; until: string } | null;
  fee: { id: number; items: FeeScheduleItems } | null;
}

export function toBookingSpace(s: SpaceRow): BookingSpace {
  return {
    id: s.id,
    name: s.name,
    capacity: s.capacity,
    minHeadcount: s.minHeadcount,
    leadDays: s.leadDays,
    slotMinutes: s.slotMinutes,
    minDurationMinutes: s.minDurationMinutes,
    isPublic: s.isPublic,
  };
}

export async function listPublicSpaces(db: DbOrTx): Promise<SpaceRow[]> {
  return db.select().from(spaces).where(eq(spaces.isPublic, true)).orderBy(asc(spaces.sortOrder), asc(spaces.name));
}

export async function findSpace(db: DbOrTx, idOrCode: string): Promise<SpaceRow | null> {
  const isUuid = /^[0-9a-f-]{36}$/.test(idOrCode);
  const [row] = await db
    .select()
    .from(spaces)
    .where(isUuid ? eq(spaces.id, idOrCode) : eq(spaces.code, idOrCode));
  return row ?? null;
}

/** 신청 규칙·가용성 계산에 필요한 값을 한 번에 읽는다. */
export async function loadBookingContext(db: DbOrTx, space: SpaceRow, now: Date = new Date()): Promise<BookingContext> {
  const settings = await getSettings(db, now);
  const today = kstDateOf(now);
  const [hh, mm] = toKstLocalInput(now).slice(11).split(":").map(Number) as [number, number];
  const closureRules = (await listClosureRules(db)).map(toClosureRule);
  const bookingWindow =
    space.leadDays === null
      ? effectiveBookingWindow({
          mode: settings["schedule.bookingWindowMode"],
          autoDays: settings["schedule.bookingWindowAutoDays"],
          manual: await getManualWindow(db, space.id),
          today,
        })
      : null;
  return {
    now,
    today,
    nowMinutes: hh * 60 + mm,
    settings,
    hours: hoursFromSettings(settings),
    space,
    bookingSpace: toBookingSpace(space),
    closureRules,
    bookingWindow,
    fee: await getFeeScheduleAt(db, now),
  };
}

export function listActiveDiscounts(db: DbOrTx) {
  return db.select().from(discountRules).where(eq(discountRules.isActive, true)).orderBy(asc(discountRules.sortOrder));
}

export interface BusyInterval {
  from: Date;
  to: Date;
  kind: "pending_payment" | "held" | "confirmed" | "block";
}

/** 기간과 겹치는 유효한 점유 (만료된 결제대기는 빈 것으로 본다) */
export async function loadBusyIntervals(db: DbOrTx, spaceId: string, from: Date, to: Date, now: Date): Promise<BusyInterval[]> {
  const rows = await db
    .select({
      from: sql<string>`lower(${slotOccupancies.during})`,
      to: sql<string>`upper(${slotOccupancies.during})`,
      kind: slotOccupancies.kind,
    })
    .from(slotOccupancies)
    .where(
      and(
        eq(slotOccupancies.spaceId, spaceId),
        sql`${slotOccupancies.during} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`,
        or(isNull(slotOccupancies.expiresAt), gt(slotOccupancies.expiresAt, now)),
      ),
    );
  return rows.map((r) => ({ from: new Date(r.from), to: new Date(r.to), kind: r.kind }));
}
