import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { listApplicationsForAdmin, listApplicationsForExport, listRefunds, normalizeRefundTab } from "@/server/applications/admin-queries";
import { applicationsCsv } from "@/server/applications/export";
import { refundsCsv } from "@/server/payments/refund-export";
import { completeManualRefund } from "@/server/payments/refunds";
import { confirmDeposit } from "@/server/applications/review";
import { expirePendingApplications, releaseExpiredOverlapping } from "@/server/booking/expire";
import { loadBusyIntervals } from "@/server/booking/context";
import { changeApplicationDiscount } from "@/server/applications/discount-adjust";
import { rejectApplication } from "@/server/applications/review";
import { newUploadToken } from "@/server/booking/attachments";
import { submitApplication } from "@/server/booking/submit";
import { applications, discountRules, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const now = new Date("2026-10-29T01:00:00Z");

describe.skipIf(!hasTestDb)("신청 내려받기", () => {
  let db: Db;
  let close: () => Promise<void>;
  let rental: Actor;
  let room: typeof spaces.$inferSelect;
  let hall: typeof spaces.$inferSelect;
  let storageDir: string;

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-exp-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    const system = (await createTestAdmin(db, "system")).actor;
    rental = (await createTestAdmin(db, "rental")).actor;
    room = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60 });
    hall = await createTestSpace(db, { name: "공연장", capacity: 60, slotMinutes: 60, minDurationMinutes: 60 });
    const fee = { baseMinutes: 120, baseFee: 55000, extraUnitMinutes: 60, extraFee: 11000, nightFeePerHour: 0 };
    const t = new Date("2026-10-01T00:00:00Z");
    await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: fee, [hall.id]: { ...fee, baseFee: 110000 } }, options: [] }, effectiveFrom: t, reason: "요금", now: t });
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function submit(spaceId: string, date: string, orgName: string, receipt: Record<string, string> = {}) {
    const r = await submitApplication(
      db,
      {
        spaceId, date, start: "10:00", end: "12:00", orgName, regType: "", regNo: "",
        contactName: "홍길동", contactPhone: "010-1234-5678", contactEmail: "exp@example.org", eventTitle: "=위험한 행사명",
        eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다, 발제와 자유토론으로 진행합니다.",
        expectedHeadcount: "10", discountRuleId: "", optionKeys: [],
        consents: ["privacy", "operationRules", "refundRules"], uploadToken: newUploadToken(), applicantPassword: "1234", applicantPasswordConfirm: "1234",
        ...receipt,
      },
      {},
      now,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    return (await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo)))[0]!;
  }

  it("목록 필터(탭·검색어·이용일·공간)를 내려받기에도 그대로 적용하고, 증빙 미요청·입금자명까지 한 파일로 내려받는다", async () => {
    const a = await submit(room.id, "2026-11-12", "가모임", { receiptType: "cash", cashPurpose: "income", cashNumber: "010-2222-3333" });
    const b = await submit(hall.id, "2026-11-20", "나모임", { receiptType: "tax_invoice", taxBizNo: "123-82-87650", taxCompany: "나협동조합", taxCeo: "김대표", taxEmail: "bill@example.org" });
    await submit(room.id, "2026-12-03", "다모임");
    expect(await confirmDeposit(db, { actor: rental, applicationId: b.id, depositorName: "나모임 입금담당", approve: true, now })).toEqual({ ok: true });

    const all = await listApplicationsForExport(db, { tab: "all", q: "" });
    expect(all).toHaveLength(3);
    const nov = await listApplicationsForExport(db, { tab: "all", q: "", from: "2026-11-01", to: "2026-11-30" });
    expect(nov.map((r) => r.app.orgName).sort()).toEqual(["가모임", "나모임"]);
    expect((await listApplicationsForExport(db, { tab: "all", q: "", spaceId: hall.id })).map((r) => r.app.orgName)).toEqual(["나모임"]);
    expect((await listApplicationsForExport(db, { tab: "pending", q: "모임" })).map((r) => r.app.orgName).sort()).toEqual(["가모임", "다모임"]);
    // 화면 목록도 같은 필터
    expect((await listApplicationsForAdmin(db, { tab: "all", q: "", from: "2026-11-01", to: "2026-11-30", page: 1 })).total).toBe(2);
    // 잘못된 날짜는 무시
    expect(await listApplicationsForExport(db, { tab: "all", q: "", from: "2026-13-45" })).toHaveLength(3);

    const csv = applicationsCsv(all);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("신청번호,상태,공간,이용일");
    expect(csv).toContain("'=위험한 행사명");
    expect(csv).toContain('"노동 인권을 주제로 한 시민 토론회를 엽니다, 발제와 자유토론으로 진행합니다."');
    expect(csv).toContain("010-1234-5678");

    const rc = csv.slice(1).trim().split("\r\n");
    expect(rc).toHaveLength(4); // 머리글 + 미요청을 포함한 모든 신청
    expect(rc[0]).toContain("입금자명");
    expect(rc.find((l) => l.includes("다모임"))).toContain(",미요청,");
    const cash = rc.find((l) => l.includes(a.applicationNo))!;
    expect(cash).toContain(a.applicationNo);
    expect(cash).toContain("소득공제,010-2222-3333");
    expect(cash).toContain("입금 전");
    const tax = rc.find((l) => l.includes(b.applicationNo))!;
    expect(tax).toContain("123-82-87650,나협동조합,김대표,bill@example.org");
    expect(tax).toContain("110000,100000,10000");
    expect(tax).toContain("나모임 입금담당");
    const widths = rc.map((line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).length);
    expect(new Set(widths).size).toBe(1);

    // A full refund changes payment status to cancelled but must retain its received amount.
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, b.id));
    if (!pay) throw new Error("결제 내역이 필요합니다.");
    const [refund] = await db.insert(refunds).values({ paymentId: pay.id, applicationId: b.id, basis: "cancelled", ratePercent: 100, amount: pay.amount }).returning();
    if (!refund) throw new Error("환불 내역이 필요합니다.");
    await completeManualRefund(db, { actor: rental, refundId: refund.id, note: "은행 이체 완료" });
    const refunded = (await listApplicationsForExport(db, { tab: "all", q: "나모임" }))[0];
    if (!refunded) throw new Error("환불한 신청이 필요합니다.");
    expect(refunded.paidAmount).toBe(110000);
    expect(refunded.refundedAmount).toBe(110000);
    expect(refunded.depositorName).toBe("나모임 입금담당");
    expect(applicationsCsv([refunded])).toContain("0,0,0,");
    expect(applicationsCsv([refunded])).not.toContain("입금 전");
  });

  it("환불 완료와 대기·실패를 구분하고 완료일시·금액·메모를 CSV에 담는다", async () => {
    const app = await submit(room.id, "2026-11-19", "환불 테스트 모임");
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, app.id));
    if (!pay) throw new Error("결제 내역이 필요합니다.");
    const base = { paymentId: pay.id, applicationId: app.id, basis: "cancelled" as const, ratePercent: 100, amount: 10000 };
    const [pending, failed, completedOld, completedNew] = await db.insert(refunds).values([
      { ...base, status: "requested" },
      { ...base, status: "failed", failureReason: "PG 오류" },
      { ...base, status: "succeeded", completedAt: new Date("2026-10-20T01:00:00Z") },
      { ...base, status: "succeeded", completedAt: new Date("2026-10-21T01:00:00Z"), manualNote: '=은행,"이체" 완료' },
    ]).returning();
    if (!pending || !failed || !completedOld || !completedNew) throw new Error("환불 내역 4건이 필요합니다.");
    const todo = await listRefunds(db, "pending");
    expect(todo.map((r) => r.refund.id)).toEqual([pending.id, failed.id].sort());
    const done = await listRefunds(db, "completed");
    expect(done.map((r) => r.refund.id)).toContain(completedOld.id);
    expect(done.map((r) => r.refund.id).indexOf(completedNew.id)).toBeLessThan(done.map((r) => r.refund.id).indexOf(completedOld.id));
    expect(done.every((r) => r.refund.status === "succeeded")).toBe(true);
    const csv = refundsCsv(done);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("환불 금액(원)");
    expect(csv).toContain("2026. 10. 21. 10:00");
    expect(csv).toContain('"\'=은행,""이체"" 완료"');
    expect(csv).toContain("10000,100,계좌이체(수동),환불 완료");
    expect(refundsCsv(todo)).toContain("실패(재처리 필요)");
    expect(refundsCsv([]).trim().split("\r\n")).toHaveLength(1);
    expect(normalizeRefundTab("invalid")).toBe("pending");
  });

  it("기한 후 계좌이체는 미입금으로 분류하고 점유 유지·입금 확인·반려가 가능하다", async () => {
    const a = await submit(room.id, "2026-12-10", "미입금 테스트");
    const past = new Date(Date.now() - 3600_000);
    await db.update(slotOccupancies).set({ expiresAt: past }).where(eq(slotOccupancies.applicationId, a.id));
    const unpaid = await listApplicationsForAdmin(db, { tab: "unpaid", q: "미입금 테스트", page: 1 });
    expect(unpaid.rows.map((r) => r.app.id)).toEqual([a.id]);
    expect(unpaid.rows[0]?.isOverdue).toBe(true);
    expect((await listApplicationsForAdmin(db, { tab: "pending", q: "미입금 테스트", page: 1 })).total).toBe(0);
    expect((await listApplicationsForExport(db, { tab: "unpaid", q: "미입금 테스트" })).map((r) => r.app.id)).toEqual([a.id]);
    expect(unpaid.tabCounts.unpaid).toBeGreaterThanOrEqual(1);
    expect(await expirePendingApplications(db, now)).toBe(0);
    await db.transaction((tx) => releaseExpiredOverlapping(tx, room.id, a.startsAt, a.endsAt, now));
    expect(await loadBusyIntervals(db, room.id, a.startsAt, a.endsAt, now)).not.toEqual([]);
    expect((await db.select().from(payments).where(eq(payments.applicationId, a.id)))[0]?.status).toBe("ready");
    expect((await db.select().from(applications).where(eq(applications.id, a.id)))[0]?.status).toBe("pending_payment");
    expect(await confirmDeposit(db, { actor: rental, applicationId: a.id, approve: true, now })).toEqual({ ok: true });
    expect((await listApplicationsForAdmin(db, { tab: "unpaid", q: "미입금 테스트", page: 1 })).total).toBe(0);
    expect((await db.select().from(applications).where(eq(applications.id, a.id)))[0]?.status).toBe("confirmed");

    const b = await submit(room.id, "2026-12-11", "미입금 반려 테스트");
    await db.update(slotOccupancies).set({ expiresAt: past }).where(eq(slotOccupancies.applicationId, b.id));
    expect(await rejectApplication(db, null, { actor: rental, applicationId: b.id, reason: "미입금으로 진행 취소" })).toEqual({ ok: true });
    expect(await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, b.id))).toHaveLength(0);
  });

  it("입금 후 전액 감면은 환불 대기·완료 모두 CSV 받은 금액을 0원으로 표시한다", async () => {
    const a = await submit(room.id, "2026-12-17", "전액감면 테스트", { receiptType: "cash", cashPurpose: "income", cashNumber: "010-2222-3333" });
    expect(await confirmDeposit(db, { actor: rental, applicationId: a.id, approve: true, now })).toEqual({ ok: true });
    const [rule] = await db.insert(discountRules).values({ name: "전액 감면", kind: "percent", value: 100, proofRequired: false }).returning();
    if (!rule) throw new Error("감면 항목이 필요합니다.");
    expect(await changeApplicationDiscount(db, null, { actor: rental, applicationId: a.id, discountRuleId: rule.id, reason: "전액 감면 승인" })).toMatchObject({ ok: true, value: { total: 0, refundAmount: 55000 } });
    const check = async () => {
      const rows = await listApplicationsForExport(db, { tab: "all", q: "전액감면 테스트" });
      const lines = applicationsCsv(rows).slice(1).trim().split("\r\n");
      const cells = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      const headers = cells(lines[0]!);
      const data = cells(lines[1]!);
      expect(data[headers.indexOf("받은 금액(원)")]).toBe("0");
      expect(data[headers.indexOf("입금·결제 누계(원)")]).toBe("55000");
      expect(data[headers.indexOf("공급가액(원)")]).toBe("0");
    };
    await check();
    const [refund] = await db.select().from(refunds).where(eq(refunds.applicationId, a.id));
    if (!refund) throw new Error("환불 내역이 필요합니다.");
    expect(await completeManualRefund(db, { actor: rental, refundId: refund.id, note: "전액 환불 이체 완료" })).toEqual({ ok: true });
    await check();
  });

});
