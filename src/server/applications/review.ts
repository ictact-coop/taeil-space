import { and, asc, desc, eq, ne } from "drizzle-orm";
import { checkBooking, halfYearRange, type Violation } from "@/domain/booking/rules";
import { kstDateOf } from "@/lib/time";
import { toMinutesOfDay } from "@/lib/time-of-day";
import type { Actor, MutationResult } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { occupancyRange } from "@/server/booking/availability";
import { loadBookingContext, loadBusyIntervals } from "@/server/booking/context";
import { applicationNotes, applications, adminUsers, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import type { PaymentGateway } from "@/server/payments/gateway";
import { createRefund, processRefund } from "@/server/payments/refunds";
import { getSettings } from "@/server/settings/service";
import { lockApplication, transition, TransitionError, type ApplicationRow } from "./transition";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 트랜잭션 안에서 신청을 잠그고 작업한 뒤, 커밋 후 환불·알림을 처리한다. */
async function withApplication(
  db: Db,
  gateway: PaymentGateway | null,
  applicationId: string,
  fn: (tx: Tx, app: ApplicationRow) => Promise<{ refundIds?: string[] } | void>,
): Promise<MutationResult> {
  let refundIds: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      const r = await fn(tx, app);
      refundIds = r?.refundIds ?? [];
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  for (const id of refundIds) await processRefund(db, gateway, id);
  await flushNotifications(db).catch(() => undefined);
  return { ok: true };
}

const reasonOf = (s: string, label: string) => {
  const r = s.trim();
  if (r.length < 2) throw new TransitionError(`${label}을(를) 입력하세요.`);
  return r;
};

export async function startReview(db: Db, p: { actor: Actor; applicationId: string }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  return withApplication(db, null, p.applicationId, async (tx, app) => {
    await transition(tx, app, "reviewing", { actorType: "admin", actorId: p.actor.id, reason: "검토 시작", patch: { reviewStartedAt: new Date() }, ip: p.actor.ip });
  });
}

export async function requestRevision(db: Db, p: { actor: Actor; applicationId: string; message: string; now?: Date }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  const now = p.now ?? new Date();
  return withApplication(db, null, p.applicationId, async (tx, app) => {
    const message = reasonOf(p.message, "보완 요청 내용");
    const days = (await getSettings(tx, now))["application.revisionDeadlineDays"];
    const deadline = new Date(now.getTime() + days * 24 * 3600_000);
    await transition(tx, app, "revision_requested", {
      actorType: "admin",
      actorId: p.actor.id,
      reason: message,
      patch: { revisionMessage: message, revisionDeadline: deadline },
      ip: p.actor.ip,
    });
    await enqueueApplicationNotification(tx, "revision_requested", app.id, {
      revisionMessage: message,
      revisionDeadline: `${kstDateOf(deadline)} ${deadline.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })}까지`,
    });
  });
}

/** 반려: 일정을 풀고 결제 금액 전액을 자동 환불한다 (AT-13) */
export async function rejectApplication(db: Db, gateway: PaymentGateway | null, p: { actor: Actor; applicationId: string; reason: string }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  return withApplication(db, gateway, p.applicationId, async (tx, app) => {
    const reason = reasonOf(p.reason, "반려 사유");
    await transition(tx, app, "rejected", { actorType: "admin", actorId: p.actor.id, reason, patch: { decidedAt: new Date(), decidedBy: p.actor.id, decisionReason: reason }, ip: p.actor.ip });
    await tx.delete(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id));
    const refundId = await createRefund(tx, { applicationId: app.id, basis: "rejected", ratePercent: 100, reason: `반려: ${reason}`, requestedBy: p.actor.id });
    await enqueueApplicationNotification(tx, "rejected", app.id, { reason });
    return { refundIds: refundId ? [refundId] : [] };
  });
}

/** 승인: 예약확정 (v0.2: 결제 후 승인하면 확정) */
export async function approveApplication(db: Db, p: { actor: Actor; applicationId: string; note?: string }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  return withApplication(db, null, p.applicationId, async (tx, app) => {
    const [occ] = await tx.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id)).for("update");
    if (!occ || occ.kind !== "held") throw new TransitionError("일정 확보 상태가 올바르지 않아 승인할 수 없습니다. 시스템 관리자에게 문의하세요.");
    await transition(tx, app, "confirmed", {
      actorType: "admin",
      actorId: p.actor.id,
      reason: p.note?.trim() || "승인",
      patch: { decidedAt: new Date(), decidedBy: p.actor.id, decisionReason: p.note?.trim() || null },
      ip: p.actor.ip,
    });
    await tx.update(slotOccupancies).set({ kind: "confirmed" }).where(eq(slotOccupancies.id, occ.id));
    await enqueueApplicationNotification(tx, "approved", app.id);
  });
}

/** 계좌이체 입금 확인 → 신청접수 */
export async function confirmDeposit(db: Db, p: { actor: Actor; applicationId: string; note: string; now?: Date }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  const now = p.now ?? new Date();
  return withApplication(db, null, p.applicationId, async (tx, app) => {
    const note = reasonOf(p.note, "입금 확인 내용(입금자·일시)");
    const [pay] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.applicationId, app.id), eq(payments.method, "bank_transfer"), eq(payments.status, "ready")))
      .for("update");
    if (!pay) throw new TransitionError("입금 확인할 계좌이체 결제가 없습니다.");
    const [hold] = await tx.select().from(slotOccupancies).where(and(eq(slotOccupancies.applicationId, app.id), eq(slotOccupancies.kind, "pending_payment"))).for("update");
    if (!hold) throw new TransitionError("입금 기한이 지나 일정이 풀렸습니다. 신청자에게 다시 신청하도록 안내하세요.");
    await tx.update(payments).set({ status: "paid", paidAt: now, providerRaw: { manual: true, note, confirmedBy: p.actor.id } }).where(eq(payments.id, pay.id));
    await tx.update(slotOccupancies).set({ kind: "held", expiresAt: null }).where(eq(slotOccupancies.id, hold.id));
    await transition(tx, app, "submitted", { actorType: "admin", actorId: p.actor.id, reason: `입금 확인: ${note}`, patch: { paidAt: now }, ip: p.actor.ip });
    await enqueueApplicationNotification(tx, "submitted", app.id);
  });
}

export async function addNote(db: Db, p: { actor: Actor; applicationId: string; body: string }): Promise<MutationResult> {
  assertCanManage(p.actor.role, "review");
  const body = p.body.trim();
  if (body.length < 1) return { ok: false, formError: "메모를 입력하세요." };
  await db.insert(applicationNotes).values({ applicationId: p.applicationId, authorId: p.actor.id, body: body.slice(0, 2000) });
  return { ok: true };
}

export function listNotes(db: DbOrTx, applicationId: string) {
  return db
    .select({ note: applicationNotes, authorName: adminUsers.name })
    .from(applicationNotes)
    .innerJoin(adminUsers, eq(adminUsers.id, applicationNotes.authorId))
    .where(eq(applicationNotes.applicationId, applicationId))
    .orderBy(asc(applicationNotes.id));
}

/**
 * 심사 화면의 자동검증 결과 (ADM-003): 지금 기준으로 규칙을 다시 검사한다(자기 점유는 제외).
 * 신청기한·지난 날짜처럼 신청 당시에만 의미 있는 규칙은 빼고 보여 준다.
 */
export async function reviewChecks(db: DbOrTx, app: ApplicationRow, now: Date = new Date()): Promise<Violation[]> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, app.spaceId));
  if (!space) return [];
  const ctx = await loadBookingContext(db, space, now);
  const date = kstDateOf(app.startsAt);
  const startMinutes = toMinutesOfDay(app.startsAt);
  const endMinutes = toMinutesOfDay(app.endsAt);
  const range = occupancyRange(space, date, startMinutes, endMinutes);
  const busy = await loadBusyIntervals(db, space.id, range.from, range.to, now, app.id);
  let organization: { sameDayCount: number; periodCount: number } | null = null;
  if (app.organizationId) {
    const others = await db
      .select({ startsAt: applications.startsAt, status: applications.status })
      .from(applications)
      .where(and(eq(applications.organizationId, app.organizationId), ne(applications.id, app.id)));
    const period = halfYearRange(date, ctx.settings["application.halfYearLimitMethod"]);
    const active = ["pending_payment", "submitted", "reviewing", "revision_requested", "confirmed", "completed"];
    const counted = ctx.settings["application.halfYearLimitTarget"] === "confirmed" ? ["confirmed", "completed"] : active.filter((s) => s !== "pending_payment");
    organization = {
      sameDayCount: others.filter((o) => active.includes(o.status) && kstDateOf(o.startsAt) === date).length,
      periodCount: others.filter((o) => counted.includes(o.status) && kstDateOf(o.startsAt) >= period.from && kstDateOf(o.startsAt) <= period.to).length,
    };
  }
  const violations = checkBooking(
    { date, startMinutes, endMinutes, headcount: app.expectedHeadcount },
    {
      today: ctx.today,
      nowMinutes: ctx.nowMinutes,
      paidRentalStartDate: ctx.settings["operation.paidRentalStartDate"],
      hours: ctx.hours,
      space: ctx.bookingSpace,
      closureRules: ctx.closureRules,
      bookingWindow: ctx.bookingWindow,
      overlaps: busy.map((b) => b.kind),
      organization,
      rules: {
        onePerOrgPerDay: ctx.settings["application.onePerOrgPerDay"],
        halfYearLimitEnabled: ctx.settings["application.halfYearLimitEnabled"],
        halfYearLimitCount: ctx.settings["application.halfYearLimitCount"],
      },
    },
  );
  return violations.filter((v) => !["LEAD_TIME", "BOOKING_WINDOW", "PAST", "PAID_START"].includes(v.code));
}

/** 같은 단체(단체번호)의 다른 신청 */
export function organizationHistory(db: DbOrTx, app: ApplicationRow) {
  if (!app.organizationId) return Promise.resolve([]);
  return db
    .select({ applicationNo: applications.applicationNo, status: applications.status, startsAt: applications.startsAt, orgName: applications.orgName })
    .from(applications)
    .where(and(eq(applications.organizationId, app.organizationId), ne(applications.id, app.id)))
    .orderBy(desc(applications.startsAt))
    .limit(20);
}

