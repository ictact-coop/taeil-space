import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { getApplicantEmail, requestLoginCode, verifyLoginCode } from "@/server/applicant/auth";
import { expireRevisions, submitRevision, withdrawApplication } from "@/server/applications/applicant-actions";
import { approveApplication, confirmDeposit, rejectApplication, requestRevision, reviewChecks, startReview } from "@/server/applications/review";
import { PermissionError } from "@/server/auth/permissions";
import { newUploadToken } from "@/server/booking/attachments";
import { expirePendingApplications } from "@/server/booking/expire";
import { submitApplication } from "@/server/booking/submit";
import { applications, notificationLogs, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { memoryOutbox } from "@/server/notifications/mailer";
import { flushNotifications } from "@/server/notifications/queue";
import { FakeGateway } from "@/server/payments/gateway";
import { completeManualRefund, MAX_REFUND_ATTEMPTS, processRefund, retryRefund } from "@/server/payments/refunds";
import { confirmPayment, prepareCheckout, reconcilePayments } from "@/server/payments/service";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { saveSettingChanges } from "@/server/settings/service";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const now = new Date("2026-10-29T01:00:00Z"); // KST 10/29 10:00

describe.skipIf(!hasTestDb)("단계 3 결제·심사·환불", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: Actor;
  let rental: Actor;
  let accounting: Actor;
  let storageDir: string;
  let room: typeof spaces.$inferSelect;
  let gateway: FakeGateway;
  let day = 0;

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-s3-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    system = { id: (await createTestAdmin(db, "system")).id, role: "system" };
    rental = { id: (await createTestAdmin(db, "rental")).id, role: "rental" };
    accounting = { id: (await createTestAdmin(db, "accounting")).id, role: "accounting" };
    room = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60 });
    const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
    await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: fee }, options: [] }, effectiveFrom: new Date("2026-10-01T00:00:00Z"), reason: "요금", now: new Date("2026-10-01T00:00:00Z") });
    // 알림 대기열은 실제 시계로 설정을 읽으므로 과거 시각부터 적용한다
    await saveSettingChanges(db, { actor: system, rawValues: { "notification.staffEmails": "staff@taeil.org" }, effectiveFrom: new Date("2026-01-01T00:00:00Z"), reason: "담당자", now: new Date("2026-01-01T00:00:00Z") });
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    gateway = new FakeGateway();
    memoryOutbox.length = 0;
  });

  /** 매번 다른 날짜(11/12부터)로 결제대기 신청을 만든다 */
  async function submit(email = "a@example.org", at = now) {
    day += 1;
    const date = new Date(Date.UTC(2026, 10, 11 + day)).toISOString().slice(0, 10);
    const r = await submitApplication(
      db,
      {
        spaceId: room.id, date, start: "10:00", end: "13:00", orgName: `단체${day}`, regType: "", regNo: "",
        contactName: "홍길동", contactPhone: "010-1234-5678", contactEmail: email, eventTitle: "토론회",
        eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다. 발제와 자유토론으로 진행합니다.", eventPublic: true,
        expectedHeadcount: "10", nightManagerName: "", nightManagerPhone: "", discountRuleId: "", optionKeys: [],
        consents: ["privacy", "operationRules", "refundRules"], uploadToken: newUploadToken(),
      },
      {},
      at,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const [app] = await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo));
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, app!.id));
    return { app: app!, pay: pay!, no: r.applicationNo };
  }
  async function paid(email?: string) {
    const s = await submit(email);
    gateway.markPaid(s.pay.orderId, s.pay.amount);
    const out = await confirmPayment(db, gateway, s.pay.orderId, now);
    expect(out.outcome).toBe("paid");
    return s;
  }
  const appOf = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0]!;
  const occOf = async (id: string) => (await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, id)))[0];
  const refundsOf = (id: string) => db.select().from(refunds).where(eq(refunds.applicationId, id));

  it("결제가 확인되면 신청접수가 되고 일정을 계속 잡아 두며, 여러 번 확정해도 한 번만 처리된다 (AT-07)", async () => {
    const s = await submit();
    expect(await confirmPayment(db, gateway, s.pay.orderId, now)).toMatchObject({ outcome: "not_paid" }); // 결제 전
    gateway.markPaid(s.pay.orderId, s.pay.amount);
    const [a, b] = await Promise.all([confirmPayment(db, gateway, s.pay.orderId, now), confirmPayment(db, gateway, s.pay.orderId, now)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["already", "paid"]);
    expect((await appOf(s.app.id)).status).toBe("submitted");
    expect(await occOf(s.app.id)).toMatchObject({ kind: "held", expiresAt: null });
    // 결제 확정 직후 바로 발송한다(문자는 단계 5 전까지 건너뜀)
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, s.app.id));
    expect(logs.map((l) => `${l.event}:${l.channel}:${l.status}`).sort()).toEqual(["staff:submitted:email:sent", "submitted:email:sent", "submitted:lms:skipped"]);
    expect(memoryOutbox.map((m) => m.to).sort()).toEqual(["a@example.org", "staff@taeil.org"]);
  });

  it("결제가 실패하면 기록하고, 다시 결제할 때는 새 주문번호를 쓴다", async () => {
    const s = await submit();
    gateway.markFailed(s.pay.orderId, s.pay.amount);
    expect(await confirmPayment(db, gateway, s.pay.orderId, now)).toMatchObject({ outcome: "not_paid", status: "FAILED" });
    const checkout = await prepareCheckout(db, s.app.id, now);
    expect(checkout.ok && checkout.checkout.paymentId).not.toBe(s.pay.orderId);
    if (!checkout.ok) return;
    gateway.markPaid(checkout.checkout.paymentId, checkout.checkout.amount);
    expect(await confirmPayment(db, gateway, checkout.checkout.paymentId, now)).toMatchObject({ outcome: "paid" });
  });

  it("결제 금액이 다르면 진행하지 않고 받은 금액을 전액 환불한다", async () => {
    const s = await submit();
    gateway.markPaid(s.pay.orderId, 100);
    expect(await confirmPayment(db, gateway, s.pay.orderId, now)).toMatchObject({ outcome: "amount_mismatch" });
    expect((await appOf(s.app.id)).status).toBe("pending_payment");
    const [r] = await refundsOf(s.app.id);
    expect(r).toMatchObject({ basis: "payment_error", amount: 100, status: "succeeded" });
    expect(gateway.records.get(s.pay.orderId)?.status).toBe("CANCELLED");
  });

  it("기한이 지나 풀린 신청에 결제가 들어오면 자동 전액 환불한다 (대사 작업으로도 찾는다)", async () => {
    const s = await submit();
    const later = new Date(now.getTime() + 31 * 60_000);
    await expirePendingApplications(db, later);
    gateway.markPaid(s.pay.orderId, s.pay.amount);
    expect(await reconcilePayments(db, gateway, later)).toBe(1);
    expect((await appOf(s.app.id)).status).toBe("payment_expired");
    expect((await refundsOf(s.app.id))[0]).toMatchObject({ basis: "late_payment", status: "succeeded", amount: 60000 });
  });

  it("반려하면 일정을 풀고 전액 환불하며 신청자에게 알린다 (AT-13)", async () => {
    const s = await paid();
    expect(await startReview(db, { actor: rental, applicationId: s.app.id })).toEqual({ ok: true });
    expect(await rejectApplication(db, gateway, { actor: rental, applicationId: s.app.id, reason: "행사 목적이 대관 취지와 맞지 않습니다." })).toEqual({ ok: true });
    const app = await appOf(s.app.id);
    expect(app).toMatchObject({ status: "rejected", decisionReason: "행사 목적이 대관 취지와 맞지 않습니다." });
    expect(await occOf(s.app.id)).toBeUndefined();
    expect((await refundsOf(s.app.id))[0]).toMatchObject({ basis: "rejected", ratePercent: 100, amount: 60000, status: "succeeded" });
    expect(gateway.records.get(s.pay.orderId)?.status).toBe("CANCELLED");
    const [pay] = await db.select().from(payments).where(eq(payments.id, s.pay.id));
    expect(pay?.status).toBe("cancelled");
    expect(memoryOutbox.some((m) => m.subject.includes("심사 결과") && m.text.includes("전액 환불"))).toBe(true);
    // 반려한 신청은 다시 승인할 수 없다
    expect(await approveApplication(db, { actor: rental, applicationId: s.app.id })).toMatchObject({ ok: false });
  });

  it("승인하면 예약확정이 되고 일정이 확정 점유로 바뀐다", async () => {
    const s = await paid();
    expect(await reviewChecks(db, await appOf(s.app.id), now)).toEqual([]);
    expect(await approveApplication(db, { actor: rental, applicationId: s.app.id, note: "확인" })).toEqual({ ok: true });
    expect((await appOf(s.app.id)).status).toBe("confirmed");
    expect((await occOf(s.app.id))?.kind).toBe("confirmed");
    expect(memoryOutbox.some((m) => m.subject.includes("예약이 확정"))).toBe(true);
  });

  it("보완 요청 → 신청자 보완 제출 → 다시 검토중, 금액과 무관한 항목만 바뀐다", async () => {
    const s = await paid();
    expect(await requestRevision(db, { actor: rental, applicationId: s.app.id, message: "행사계획서를 첨부해 주세요.", now })).toEqual({ ok: true });
    const req = await appOf(s.app.id);
    expect(req).toMatchObject({ status: "revision_requested", revisionMessage: "행사계획서를 첨부해 주세요." });
    expect(req.revisionDeadline?.toISOString()).toBe("2026-11-01T01:00:00.000Z"); // 기본 3일
    const bad = await submitRevision(db, { applicationId: s.app.id, raw: { contactName: "홍길동", contactPhone: "010-1234-5678", eventTitle: "토론회", eventPurpose: "짧음", eventPublic: false, expectedHeadcount: "99", nightManagerName: "", nightManagerPhone: "", uploadToken: newUploadToken(), note: "" } });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { expectedHeadcount: expect.any(String) } });
    const ok = await submitRevision(db, {
      applicationId: s.app.id,
      raw: { contactName: "김담당", contactPhone: "010-9999-8888", eventTitle: "시민 토론회", eventPurpose: "보완: 노동 인권을 주제로 한 시민 토론회입니다. 발제 2개와 자유토론으로 진행합니다.", eventPublic: false, expectedHeadcount: "12", nightManagerName: "", nightManagerPhone: "", uploadToken: newUploadToken(), note: "첨부했습니다" },
    });
    expect(ok).toEqual({ ok: true });
    expect(await appOf(s.app.id)).toMatchObject({ status: "reviewing", contactName: "김담당", expectedHeadcount: 12, totalAmount: 60000 });
  });

  it("보완 기한이 지나면 신청을 종료하고 전액 환불한다", async () => {
    const s = await paid();
    await requestRevision(db, { actor: rental, applicationId: s.app.id, message: "자료 보완", now });
    expect(await expireRevisions(db, gateway, new Date(now.getTime() + 2 * 24 * 3600_000))).toBe(0);
    expect(await expireRevisions(db, gateway, new Date(now.getTime() + 3 * 24 * 3600_000 + 1000))).toBe(1);
    expect((await appOf(s.app.id)).status).toBe("closed_revision_expired");
    expect((await refundsOf(s.app.id))[0]).toMatchObject({ basis: "revision_expired", status: "succeeded" });
  });

  it("승인 전 철회는 결제 당시의 철회 환불률을 적용한다 (P-15, 계획서 2.7)", async () => {
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.withdrawRefundPercent": "80" }, effectiveFrom: new Date("2026-10-29T00:00:00Z"), reason: "80%", now: new Date("2026-10-29T00:00:00Z") });
    const s = await paid();
    // 결제 뒤에 규정이 바뀌어도
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.withdrawRefundPercent": "50" }, effectiveFrom: now, reason: "50%", now });
    const r = await withdrawApplication(db, gateway, { applicationId: s.app.id, reason: "일정 변경" });
    expect(r).toEqual({ ok: true, value: { refundAmount: 48000 } });
    expect((await refundsOf(s.app.id))[0]).toMatchObject({ ratePercent: 80, amount: 48000, status: "succeeded" });
    expect(await occOf(s.app.id)).toBeUndefined();
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.withdrawRefundPercent": "100" }, effectiveFrom: new Date(now.getTime() + 1000), reason: "복원", now: new Date(now.getTime() + 1000) });
  });

  it("결제 전 철회는 환불 없이 일정을 푼다", async () => {
    const s = await submit();
    expect(await withdrawApplication(db, gateway, { applicationId: s.app.id, reason: "" })).toEqual({ ok: true, value: { refundAmount: 0 } });
    expect(await refundsOf(s.app.id)).toHaveLength(0);
    const [pay] = await db.select().from(payments).where(eq(payments.id, s.pay.id));
    expect(pay?.status).toBe("cancelled");
  });

  it("계좌이체: 입금 확인 → 접수, 반려 환불은 담당자가 이체 후 완료 처리", async () => {
    const t0 = new Date("2026-10-29T02:00:00Z");
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.method": "bankTransfer", "payment.bankAccountInfo": "○○은행 000-00" }, effectiveFrom: t0, reason: "계좌이체", now: t0 });
    const s = await submit("bank@example.org", new Date(t0.getTime() + 1000));
    expect(s.pay.method).toBe("bank_transfer");
    expect(await confirmDeposit(db, { actor: rental, applicationId: s.app.id, note: "", now: t0 })).toMatchObject({ ok: false });
    expect(await confirmDeposit(db, { actor: rental, applicationId: s.app.id, note: "홍길동 10/29 11:30 입금", now: t0 })).toEqual({ ok: true });
    expect((await appOf(s.app.id)).status).toBe("submitted");
    await rejectApplication(db, gateway, { actor: rental, applicationId: s.app.id, reason: "정원 초과 행사" });
    const [r] = await refundsOf(s.app.id);
    expect(r).toMatchObject({ status: "requested" }); // 자동 처리 불가 → 수동
    expect(await completeManualRefund(db, { actor: accounting, refundId: r!.id, note: "국민 123-45 홍길동, 10/30 이체" })).toEqual({ ok: true });
    expect((await refundsOf(s.app.id))[0]).toMatchObject({ status: "succeeded", manualNote: "국민 123-45 홍길동, 10/30 이체" });
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.method": "pg" }, effectiveFrom: new Date(t0.getTime() + 2000), reason: "PG 복귀", now: new Date(t0.getTime() + 2000) });
  });

  it("PG 환불이 계속 실패하면 재처리 목록으로 보내고, 다시 시도할 수 있다", async () => {
    const s = await paid();
    gateway.failNextCancel = true;
    await rejectApplication(db, gateway, { actor: rental, applicationId: s.app.id, reason: "테스트 반려" }); // 1번째 시도 실패
    for (let i = 1; i < MAX_REFUND_ATTEMPTS; i += 1) {
      gateway.failNextCancel = true;
      await processRefund(db, gateway, (await refundsOf(s.app.id))[0]!.id);
    }
    const [r] = await refundsOf(s.app.id);
    expect(r).toMatchObject({ status: "failed", attemptCount: MAX_REFUND_ATTEMPTS });
    expect(await retryRefund(db, gateway, { actor: accounting, refundId: r!.id })).toEqual({ ok: true });
    expect((await refundsOf(s.app.id))[0]?.status).toBe("succeeded");
  });

  it("회계 담당자는 심사할 수 없다", async () => {
    const s = await paid();
    await expect(rejectApplication(db, gateway, { actor: accounting, applicationId: s.app.id, reason: "x" })).rejects.toBeInstanceOf(PermissionError);
  });

  it("나의 대관: 신청한 이메일로만 코드를 보내고, 코드가 맞으면 세션을 만든다", async () => {
    await submit("me@example.org");
    expect(await requestLoginCode(db, "nobody@example.org", now)).toEqual({ ok: true });
    expect(memoryOutbox).toHaveLength(0); // 신청 내역 없는 이메일에는 보내지 않음(같은 안내)
    expect(await requestLoginCode(db, "Me@Example.org", now)).toEqual({ ok: true });
    const mail = memoryOutbox.find((m) => m.to === "me@example.org");
    const code = /코드: (\d{6})/.exec(mail?.text ?? "")?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(await verifyLoginCode(db, "me@example.org", code === "000000" ? "111111" : "000000", now)).toMatchObject({ ok: false });
    const ok = await verifyLoginCode(db, "me@example.org", code!, now);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await getApplicantEmail(db, ok.token, now)).toBe("me@example.org");
    expect(await verifyLoginCode(db, "me@example.org", code!, now)).toMatchObject({ ok: false }); // 한 번만 사용
    for (let i = 0; i < 4; i += 1) expect(await requestLoginCode(db, "me@example.org", now)).toEqual({ ok: true }); // 2~5번째
    expect(await requestLoginCode(db, "me@example.org", now)).toMatchObject({ ok: false }); // 시간당 5회 초과
  });

  it("알림 발송 실패는 다시 시도하고, 5번 실패하면 실패로 남긴다", async () => {
    const [latest] = await db.select().from(notificationLogs).orderBy(desc(notificationLogs.id)).limit(1);
    await db.insert(notificationLogs).values({ event: "test", channel: "email", recipient: "x@example.org", subject: "s", body: "b" });
    process.env.EMAIL_PROVIDER = "smtp"; // SMTP_URL이 없어 실패
    for (let i = 0; i < 5; i += 1) await flushNotifications(db);
    process.env.EMAIL_PROVIDER = "memory";
    const [row] = await db.select().from(notificationLogs).where(and(eq(notificationLogs.event, "test"))).orderBy(desc(notificationLogs.id)).limit(1);
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(row!.id).toBeGreaterThan(latest?.id ?? 0);
  });
});

describe.skipIf(!hasTestDb)("관리자 조회", () => {
  it("신청 상세·목록·대시보드·캘린더·환불 목록 조회가 동작한다", async () => {
    const { getApplicationForAdmin, listApplicationsForAdmin, listRefundsNeedingAction } = await import("@/server/applications/admin-queries");
    const { getDashboard, getMonthSchedule } = await import("@/server/applications/dashboard");
    const { resetTestDb: reset } = await import("../helpers/db");
    const { db, close } = await reset();
    try {
      const admin = await createTestAdmin(db, "system");
      const space = await createTestSpace(db);
      const [app] = await db
        .insert(applications)
        .values({
          applicationNo: "R202611-00001", status: "reviewing", spaceId: space.id, orgName: "단체", contactName: "담당", contactPhone: "01000000000",
          contactEmail: "a@b.c", eventTitle: "행사", eventPurpose: "목적", expectedHeadcount: 5,
          startsAt: new Date("2026-11-20T01:00:00Z"), endsAt: new Date("2026-11-20T03:00:00Z"),
        })
        .returning();
      const { applicationStatusHistory } = await import("@/server/db/schema");
      await db.insert(applicationStatusHistory).values([
        { applicationId: app!.id, toStatus: "submitted", actorType: "applicant" },
        { applicationId: app!.id, fromStatus: "submitted", toStatus: "reviewing", actorType: "admin", actorId: admin.id },
      ]);
      const detail = await getApplicationForAdmin(db, "R202611-00001");
      expect(detail?.history.map((h) => h.actorName)).toEqual([null, admin.name]);
      expect((await listApplicationsForAdmin(db, { tab: "todo", q: "단체", page: 1 })).rows).toHaveLength(1);
      expect((await getDashboard(db)).reviewing).toBe(1);
      expect((await getMonthSchedule(db, "2026-11", null)).apps).toHaveLength(1);
      expect(await listRefundsNeedingAction(db)).toEqual([]);
    } finally {
      await close();
    }
  });
});
