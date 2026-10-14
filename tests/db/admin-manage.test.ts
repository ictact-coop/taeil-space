import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelConfirmedApplication, deleteApplication, setCompleted } from "@/server/applications/admin-manage";
import { PermissionError } from "@/server/auth/permissions";
import { applicationStatusHistory, applications, auditLogs, notificationLogs, payments, refunds, slotOccupancies } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { tstzRange } from "@/server/calendar/block-service";
import { createTestAdmin, createTestApplication, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("확정된 신청 관리: 예약 취소·이용완료·영구 삭제", () => {
  let db: Db;
  let close: () => Promise<void>;
  let staff: Awaited<ReturnType<typeof createTestAdmin>>;
  let superAdmin: Awaited<ReturnType<typeof createTestAdmin>>;
  let spaceId: string;
  let day = 0;

  /** 계좌이체로 입금 확인까지 끝난 예약확정 신청 */
  async function confirmedApp(amount = 100000) {
    day += 1;
    const startsAt = new Date(`2026-12-${String(day).padStart(2, "0")}T01:00:00Z`);
    const endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
    const app = await createTestApplication(db, { spaceId, startsAt, endsAt, status: "confirmed" });
    await db.update(applications).set({ totalAmount: amount }).where(eq(applications.id, app.id));
    await db.insert(slotOccupancies).values({ spaceId, during: tstzRange(startsAt, endsAt), kind: "confirmed", applicationId: app.id });
    await db.insert(payments).values({ applicationId: app.id, orderId: `${app.applicationNo}-p`, method: "bank_transfer", amount, status: "paid", paidAt: new Date() });
    return app;
  }

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    ({ db, close } = await resetTestDb());
    staff = await createTestAdmin(db, "rental");
    superAdmin = await createTestAdmin(db, "system");
    spaceId = (await createTestSpace(db)).id;
  });
  afterAll(async () => close?.());

  it("예약 취소: 일정을 열고, 정한 비율만큼 환불 요청(계좌이체는 수동), 신청자 알림", async () => {
    const app = await confirmedApp(100000);
    const r = await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "기념관 행사 일정 변경", refundPercent: 100, basis: "venue_fault", notify: true });
    expect(r).toEqual({ ok: true, value: { refundAmount: 100000 } });
    const [after] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(after!.status).toBe("cancelled");
    expect(await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id))).toHaveLength(0);
    const [refund] = await db.select().from(refunds).where(eq(refunds.applicationId, app.id));
    expect(refund).toMatchObject({ basis: "venue_fault", ratePercent: 100, amount: 100000, status: "requested" });
    const mails = await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, app.id));
    expect(mails.some((m) => m.event === "cancelled" && m.channel === "email")).toBe(true);
  });

  it("예약 취소: 환불 0%·알림 끄기(테스트 데이터 정리), 잘못된 입력·상태는 거부", async () => {
    const app = await confirmedApp();
    expect(await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "", refundPercent: 0, basis: "cancelled", notify: false })).toMatchObject({ ok: false });
    expect(await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "테스트", refundPercent: 150, basis: "cancelled", notify: false })).toMatchObject({ ok: false });
    expect(await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "테스트 데이터", refundPercent: 0, basis: "cancelled", notify: false })).toEqual({ ok: true, value: { refundAmount: 0 } });
    expect(await db.select().from(refunds).where(eq(refunds.applicationId, app.id))).toHaveLength(0);
    expect(await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, app.id))).toHaveLength(0);
    // 이미 취소된 신청은 다시 취소할 수 없다
    expect(await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "다시", refundPercent: 0, basis: "cancelled", notify: false })).toMatchObject({ ok: false });
    const club = await createTestAdmin(db, "club");
    await expect(cancelConfirmedApplication(db, null, { actor: club.actor, applicationId: app.id, reason: "x x", refundPercent: 0, basis: "cancelled", notify: false })).rejects.toBeInstanceOf(PermissionError);
  });

  it("신청자 이메일이 없으면 메일은 보내지 않고 기록만 남긴다", async () => {
    const app = await confirmedApp();
    await db.update(applications).set({ contactEmail: "" }).where(eq(applications.id, app.id));
    await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "이메일 없는 신청", refundPercent: 0, basis: "cancelled", notify: true });
    const [mail] = await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, app.id));
    expect(mail).toMatchObject({ channel: "email", status: "skipped", error: "신청자 이메일이 없습니다." });
  });

  it("이용완료 표시와 되돌리기", async () => {
    const app = await confirmedApp();
    expect(await setCompleted(db, { actor: staff.actor, applicationId: app.id, completed: true })).toEqual({ ok: true });
    expect((await db.select().from(applications).where(eq(applications.id, app.id)))[0]!.status).toBe("completed");
    expect(await setCompleted(db, { actor: staff.actor, applicationId: app.id, completed: false })).toEqual({ ok: true });
    expect((await db.select().from(applications).where(eq(applications.id, app.id)))[0]!.status).toBe("confirmed");
  });

  it("영구 삭제: 최고 관리자만, 신청번호 확인, 결제·환불·이력까지 지우고 감사 로그에 요약", async () => {
    const app = await confirmedApp(50000);
    await cancelConfirmedApplication(db, null, { actor: staff.actor, applicationId: app.id, reason: "테스트", refundPercent: 50, basis: "cancelled", notify: true });
    await expect(deleteApplication(db, { actor: staff.actor, applicationId: app.id, confirmNo: app.applicationNo, reason: "테스트" })).rejects.toBeInstanceOf(PermissionError);
    expect(await deleteApplication(db, { actor: superAdmin.actor, applicationId: app.id, confirmNo: "R-WRONG", reason: "테스트 데이터" })).toMatchObject({ ok: false });
    expect(await deleteApplication(db, { actor: superAdmin.actor, applicationId: app.id, confirmNo: app.applicationNo, reason: "테스트 데이터" })).toEqual({ ok: true });
    expect(await db.select().from(applications).where(eq(applications.id, app.id))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.applicationId, app.id))).toHaveLength(0);
    expect(await db.select().from(refunds).where(eq(refunds.applicationId, app.id))).toHaveLength(0);
    expect(await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, app.id))).toHaveLength(0);
    expect(await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, app.id))).toHaveLength(0);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "application.deleted"));
    expect(log).toMatchObject({ actorId: superAdmin.id, reason: "테스트 데이터" });
    expect(log!.before).toMatchObject({ applicationNo: app.applicationNo, paidAmount: 50000, status: "cancelled" });
    // 입금 대기 등 다른 상태도 지울 수 있다
    const pending = await createTestApplication(db, { spaceId, startsAt: new Date("2026-12-28T01:00:00Z"), endsAt: new Date("2026-12-28T02:00:00Z"), status: "pending_payment" });
    expect(await deleteApplication(db, { actor: superAdmin.actor, applicationId: pending.id, confirmNo: pending.applicationNo, reason: "테스트" })).toEqual({ ok: true });
  });
});
