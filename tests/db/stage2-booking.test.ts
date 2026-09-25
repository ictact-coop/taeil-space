import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { getApplicationForApplicant } from "@/server/booking/access";
import { newUploadToken, uploadAttachment } from "@/server/booking/attachments";
import { getDayAvailability, getMonthCalendar } from "@/server/booking/availability";
import { expirePendingApplications } from "@/server/booking/expire";
import { submitApplication } from "@/server/booking/submit";
import { closureRules, applications, attachments, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveDiscountRule } from "@/server/pricing/discount-service";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 32)]);
const now = new Date("2026-10-29T01:00:00Z"); // KST 2026-10-29(목) 10:00

describe.skipIf(!hasTestDb)("단계 2 신청 흐름", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: Actor;
  let storageDir: string;
  let hall: typeof spaces.$inferSelect;
  let seminar: typeof spaces.$inferSelect;

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-test-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    system = { id: (await createTestAdmin(db, "system")).id, role: "system" };
    hall = await createTestSpace(db, { name: "공연장", capacity: 60, minHeadcount: 20, slotMinutes: 60, minDurationMinutes: 120, extraConsents: ["hallRules"] });
    seminar = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60, bufferAfterMinutes: 30 });
    await db.insert(closureRules).values({ type: "weekly", weekday: 1, name: "월요일", publicMessage: "매주 월요일은 휴관일입니다." });
    const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
    const r = await saveFeeSchedule(db, {
      actor: system,
      items: { spaces: { [hall.id]: { ...fee, baseFee: 120000 }, [seminar.id]: fee }, options: [] },
      effectiveFrom: new Date("2026-10-01T00:00:00Z"),
      reason: "테스트 요금",
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });

  const form = (over: Record<string, unknown> = {}) => ({
    spaceId: seminar.id,
    date: "2026-11-13",
    start: "10:00",
    end: "12:00",
    orgName: "○○네트워크",
    regType: "",
    regNo: "",
    contactName: "홍길동",
    contactPhone: "010-1234-5678",
    contactEmail: "hong@example.org",
    eventTitle: "토론회",
    eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다. 발제와 자유토론으로 진행합니다.",
    eventPublic: true,
    expectedHeadcount: "12",
    nightManagerName: "",
    nightManagerPhone: "",
    discountRuleId: "",
    optionKeys: [],
    consents: ["privacy", "operationRules", "refundRules"],
    uploadToken: newUploadToken(),
    ...over,
  });

  it("달력: 휴관일·신청기한 이전은 대관불가, 그 외는 예약가능", async () => {
    const days = await getMonthCalendar(db, seminar, "2026-11", now);
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(byDate["2026-11-11"]).toMatchObject({ state: "unavailable" }); // 14일 전 이전
    expect(byDate["2026-11-12"]?.state).toBe("available");
    expect(byDate["2026-11-16"]).toMatchObject({ state: "unavailable", reason: "매주 월요일은 휴관일입니다." });
  });

  let firstNo = "";
  let firstToken = "";

  it("신청하면 결제대기가 되고 결제 유효시간 동안 일정을 잡아 둔다 (AT-06)", async () => {
    const f = form();
    await uploadAttachment(db, { uploadToken: f.uploadToken, kind: "event_plan", fileName: "행사계획서.pdf", data: PDF, now });
    const r = await submitApplication(db, f, {}, now);
    expect(r).toMatchObject({ ok: true, status: "pending_payment", total: 60000 });
    if (!r.ok) return;
    expect(r.applicationNo).toBe("R202610-00001");
    expect(r.expiresAt?.toISOString()).toBe("2026-10-29T01:30:00.000Z");
    firstNo = r.applicationNo;
    firstToken = r.accessToken;

    const [app] = await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo));
    expect(app).toMatchObject({ status: "pending_payment", totalAmount: 60000, contactPhone: "01012345678" });
    expect(Object.keys(app!.consents).sort()).toEqual(["operationRules", "privacy", "refundRules"]);
    const [occ] = await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app!.id));
    expect(occ?.kind).toBe("pending_payment");
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, app!.id));
    expect(pay).toMatchObject({ method: "pg", status: "ready", amount: 60000 });
    const linked = await db.select().from(attachments).where(eq(attachments.applicationId, app!.id));
    expect(linked).toHaveLength(1);

    const view = await getApplicationForApplicant(db, r.applicationNo, r.accessToken);
    expect(view?.application.applicationNo).toBe(r.applicationNo);
    expect(await getApplicationForApplicant(db, r.applicationNo, "wrong-token")).toBeNull();
  });

  it("빈 신청서를 내면 기본 입력 오류와 동의 누락을 한 번에 알려 준다", async () => {
    const r = await submitApplication(db, form({ orgName: "", contactEmail: "x", consents: ["privacy"] }), {}, now);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors?.orgName).toBeDefined();
      expect(r.fieldErrors?.contactEmail).toBeDefined();
      expect(r.fieldErrors?.consents).toContain("대관 운영규정");
    }
  });

  it("같은 시간은 다시 신청할 수 없고, 철수 시간(30분)까지 비워 둔다 (BR-06)", async () => {
    const same = await submitApplication(db, form(), {}, now);
    expect(same).toMatchObject({ ok: false, violations: [{ code: "BR-06" }] });
    const right = await submitApplication(db, form({ start: "12:00", end: "13:00", orgName: "다른단체" }), {}, now);
    expect(right).toMatchObject({ ok: false, violations: [{ code: "BR-06" }] }); // 12:00~12:30은 철수 시간
    const day = await getDayAvailability(db, seminar, "2026-11-13", now);
    expect(day.slots.find((s) => s.start === "10:00")?.state).toBe("pending");
    expect(day.busy[0]).toEqual({ from: 600, to: 750 }); // 10:00 ~ 12:30
  });

  it("동시에 같은 시간을 신청해도 한 건만 접수된다", async () => {
    const results = await Promise.all([1, 2, 3].map((i) => submitApplication(db, form({ date: "2026-11-20", orgName: `단체${i}` }), {}, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("공연장: 인원·규정 동의·야간 담당자를 확인한다 (AT-02, AT-05)", async () => {
    const base = { spaceId: hall.id, date: "2026-11-14", start: "17:00", end: "20:00", expectedHeadcount: "30" };
    const r1 = await submitApplication(db, form(base), {}, now);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.fieldErrors?.consents).toContain("야간 출입문 관리 규정");
      expect(r1.fieldErrors?.consents).toContain("공연장 이용 규정");
      expect(r1.fieldErrors?.nightManagerName).toBeDefined();
    }
    const r2 = await submitApplication(
      db,
      form({ ...base, expectedHeadcount: "10", nightManagerName: "김담당", nightManagerPhone: "010-2222-3333", consents: ["privacy", "operationRules", "refundRules", "nightRules", "hallRules"] }),
      {},
      now,
    );
    expect(r2).toMatchObject({ ok: false, violations: [{ code: "BR-08" }] });
    const r3 = await submitApplication(
      db,
      form({ ...base, nightManagerName: "김담당", nightManagerPhone: "010-2222-3333", consents: ["privacy", "operationRules", "refundRules", "nightRules", "hallRules"] }),
      {},
      now,
    );
    expect(r3).toMatchObject({ ok: true, total: 120000 + 20000 * 0 + 20000 }); // 3시간 기본 + 야간 2시간(18~20시) 20,000
  });

  it("같은 단체번호로 같은 날 두 번째 신청은 막는다 (BR-03, AT-14)", async () => {
    const org = { regType: "business_no", regNo: "124-81-00998", orgName: "주식회사 예시" };
    expect(await submitApplication(db, form({ ...org, date: "2026-11-18", start: "10:00", end: "11:00" }), {}, now)).toMatchObject({ ok: true });
    const again = await submitApplication(db, form({ ...org, spaceId: hall.id, date: "2026-11-18", start: "14:00", end: "16:00", expectedHeadcount: "25", consents: ["privacy", "operationRules", "refundRules", "hallRules"] }), {}, now);
    expect(again).toMatchObject({ ok: false, violations: [{ code: "BR-03" }] });
    const badNo = await submitApplication(db, form({ ...org, regNo: "124-81-00997", date: "2026-11-19" }), {}, now);
    expect(badNo).toMatchObject({ ok: false, fieldErrors: { regNo: expect.stringContaining("올바르지 않습니다") } });
  });

  it("증빙이 필요한 감면은 증빙 첨부가 있어야 하고, 전액 감면이면 결제 없이 바로 접수된다", async () => {
    const d = await saveDiscountRule(db, {
      actor: system,
      id: null,
      raw: { name: "전액 감면", description: "", kind: "percent", value: "100", proofRequired: true, proofGuide: "협약서", isActive: true, sortOrder: "0" },
      reason: "테스트",
    });
    if (!d.ok) throw new Error("discount");
    const f = form({ date: "2026-11-24", discountRuleId: d.value.id, orgName: "협약단체" });
    expect(await submitApplication(db, f, {}, now)).toMatchObject({ ok: false, fieldErrors: { attachments: expect.stringContaining("협약서") } });
    await uploadAttachment(db, { uploadToken: f.uploadToken, kind: "discount_proof", fileName: "협약서.pdf", data: PDF, now });
    const r = await submitApplication(db, f, {}, now);
    expect(r).toMatchObject({ ok: true, status: "submitted", total: 0, expiresAt: null });
    if (!r.ok) return;
    const [app] = await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo));
    const [occ] = await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app!.id));
    expect(occ).toMatchObject({ kind: "held", expiresAt: null });
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, app!.id));
    expect(pay).toMatchObject({ method: "free", status: "paid" });
  });

  it("결제 유효시간이 지나면 자동 취소되고 일정이 다시 열린다 (AT-08)", async () => {
    const later = new Date(now.getTime() + 31 * 60_000);
    // 작업이 돌기 전이라도 달력은 만료된 점유를 빈 것으로 본다
    const day = await getDayAvailability(db, seminar, "2026-11-13", later);
    expect(day.slots.find((s) => s.start === "10:00")?.state).toBe("free");

    const count = await expirePendingApplications(db, later);
    expect(count).toBeGreaterThanOrEqual(1);
    const [app] = await db.select().from(applications).where(eq(applications.applicationNo, firstNo));
    expect(app?.status).toBe("payment_expired");
    expect(await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app!.id))).toHaveLength(0);
    const [pay] = await db.select().from(payments).where(and(eq(payments.applicationId, app!.id)));
    expect(pay?.status).toBe("cancelled");
    expect((await getApplicationForApplicant(db, firstNo, firstToken))?.application.status).toBe("payment_expired");

    const again = await submitApplication(db, form({ orgName: "새 단체" }), {}, later);
    expect(again).toMatchObject({ ok: true });
  });

  it("작업이 돌기 전에 새 신청이 오면, 겹치는 만료 신청을 같은 트랜잭션에서 정리한다", async () => {
    const t0 = new Date("2026-10-29T03:00:00Z");
    const first = await submitApplication(db, form({ date: "2026-11-26", orgName: "먼저" }), {}, t0);
    expect(first.ok).toBe(true);
    const t1 = new Date(t0.getTime() + 40 * 60_000);
    const second = await submitApplication(db, form({ date: "2026-11-26", orgName: "나중" }), {}, t1);
    expect(second).toMatchObject({ ok: true });
    if (!first.ok) return;
    const [old] = await db.select().from(applications).where(eq(applications.applicationNo, first.applicationNo));
    expect(old?.status).toBe("payment_expired");
  });

  it("첨부: 확장자와 내용이 다르거나 개수를 넘으면 거부", async () => {
    const token = newUploadToken();
    expect(await uploadAttachment(db, { uploadToken: token, kind: "event_plan", fileName: "가짜.pdf", data: Buffer.from("MZ executable"), now })).toMatchObject({ ok: false });
    expect(await uploadAttachment(db, { uploadToken: token, kind: "event_plan", fileName: "a.exe", data: PDF, now })).toMatchObject({ ok: false });
    for (let i = 0; i < 3; i += 1) expect((await uploadAttachment(db, { uploadToken: token, kind: "event_plan", fileName: `f${i}.pdf`, data: PDF, now })).ok).toBe(true);
    expect(await uploadAttachment(db, { uploadToken: token, kind: "event_plan", fileName: "f4.pdf", data: PDF, now })).toMatchObject({ ok: false, error: expect.stringContaining("3개") });
  });
});
