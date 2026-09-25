import { desc, eq, isNull } from "drizzle-orm";
import { addDays, isValidDateString } from "@/domain/calendar/closures";
import { effectiveBookingWindow } from "@/domain/calendar/booking-window";
import { kstDateOf } from "@/lib/time";
import { writeAudit } from "@/server/audit/log";
import { type Actor, type MutationResult, requireReason } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { bookingWindows, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { getSettings } from "@/server/settings/service";

/** 신청기한(leadDays) 대신 접수기간으로 받는 공간 */
export function listWindowSpaces(db: DbOrTx) {
  return db.select().from(spaces).where(isNull(spaces.leadDays)).orderBy(spaces.sortOrder);
}

export async function getManualWindow(db: DbOrTx, spaceId: string) {
  const [row] = await db
    .select()
    .from(bookingWindows)
    .where(eq(bookingWindows.spaceId, spaceId))
    .orderBy(desc(bookingWindows.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getBookingWindowView(db: DbOrTx, spaceId: string, now: Date = new Date()) {
  const settings = await getSettings(db, now);
  const manual = await getManualWindow(db, spaceId);
  const today = kstDateOf(now);
  return {
    mode: settings["schedule.bookingWindowMode"],
    autoDays: settings["schedule.bookingWindowAutoDays"],
    extendDays: settings["schedule.bookingWindowExtendDays"],
    manual,
    effective: effectiveBookingWindow({
      mode: settings["schedule.bookingWindowMode"],
      autoDays: settings["schedule.bookingWindowAutoDays"],
      manual,
      today,
    }),
    today,
  };
}

async function insertWindow(
  db: Db,
  actor: Actor,
  spaceId: string,
  opensFrom: string,
  opensUntil: string,
  reason: string,
  action: string,
): Promise<MutationResult> {
  return db.transaction(async (tx) => {
    const [space] = await tx.select({ id: spaces.id, leadDays: spaces.leadDays }).from(spaces).where(eq(spaces.id, spaceId));
    if (!space) return { ok: false, formError: "공간을 찾을 수 없습니다." } as const;
    if (space.leadDays !== null) return { ok: false, formError: "이 공간은 접수기간이 아니라 신청기한으로 운영합니다." } as const;
    const before = await getManualWindow(tx, spaceId);
    const [created] = await tx
      .insert(bookingWindows)
      .values({ spaceId, opensFrom, opensUntil, createdBy: actor.id })
      .returning();
    await writeAudit(tx, {
      actorType: "admin",
      actorId: actor.id,
      action,
      targetType: "booking_window",
      targetId: spaceId,
      before: before ? { opensFrom: before.opensFrom, opensUntil: before.opensUntil } : null,
      after: { opensFrom: created!.opensFrom, opensUntil: created!.opensUntil },
      reason: reason.trim(),
      ip: actor.ip,
    });
    return { ok: true } as const;
  });
}

export async function setBookingWindow(
  db: Db,
  params: { actor: Actor; spaceId: string; opensFrom: string; opensUntil: string; reason: string },
): Promise<MutationResult> {
  assertCanManage(params.actor.role, "bookingWindows");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  const fieldErrors: Record<string, string> = {};
  if (!isValidDateString(params.opensFrom)) fieldErrors.opensFrom = "시작일을 입력하세요.";
  if (!isValidDateString(params.opensUntil)) fieldErrors.opensUntil = "종료일을 입력하세요.";
  else if (params.opensFrom > params.opensUntil) fieldErrors.opensUntil = "종료일은 시작일과 같거나 늦어야 합니다.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return insertWindow(db, params.actor, params.spaceId, params.opensFrom, params.opensUntil, params.reason, "booking_window.set");
}

/** 접수기간을 설정된 일수만큼 연장한다. 공개 중인 기간이 없으면 오늘부터 연다. */
export async function extendBookingWindow(
  db: Db,
  params: { actor: Actor; spaceId: string; reason: string; now?: Date },
): Promise<MutationResult> {
  assertCanManage(params.actor.role, "bookingWindows");
  const reasonError = requireReason(params.reason);
  if (reasonError) return { ok: false, formError: reasonError };
  const now = params.now ?? new Date();
  const today = kstDateOf(now);
  const days = (await getSettings(db, now))["schedule.bookingWindowExtendDays"];
  const current = await getManualWindow(db, params.spaceId);
  const active = current && current.opensUntil >= today;
  const opensFrom = active ? current.opensFrom : today;
  const opensUntil = addDays(active ? current.opensUntil : today, days);
  return insertWindow(db, params.actor, params.spaceId, opensFrom, opensUntil, params.reason, "booking_window.extend");
}
