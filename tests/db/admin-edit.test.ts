import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { updateApplicationByAdmin, type AdminEditRaw } from "@/server/applications/admin-edit";
import { withdrawApplication } from "@/server/applications/applicant-actions";
import { confirmDeposit } from "@/server/applications/review";
import { PermissionError } from "@/server/auth/permissions";
import { newUploadToken } from "@/server/booking/attachments";
import { submitApplication } from "@/server/booking/submit";
import { applications, applicationStatusHistory, notificationLogs, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const now = new Date("2026-10-29T01:00:00Z");
const fee = { baseMinutes: 120, baseFee: 40000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 0 };

describe.skipIf(!hasTestDb)("관리자 신청 정보 수정", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: Actor;
  let rental: Actor;
  let room: typeof spaces.$inferSelect;
  let hall: typeof spaces.$inferSelect;
  let storageDir: string;

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-edit-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    system = (await createTestAdmin(db, "system")).actor;
    rental = (await createTestAdmin(db, "rental")).actor;
    room = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60 });
    hall = await createTestSpace(db, { name: "공연장", capacity: 60, slotMinutes: 60, minDurationMinutes: 60 });
    const t = new Date("2026-10-01T00:00:00Z");
    await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: fee, [hall.id]: { ...fee, baseFee: 100000 } }, options: [] }, effectiveFrom: t, reason: "요금", now: t });
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function submit(date: string, start = "10:00", end = "12:00") {
    const r = await submitApplication(
      db,
      {
        spaceId: room.id, date, start, end, orgName: "○○모임", regType: "", regNo: "",
        contactName: "홍길동", contactPhone: "010-1234-5678", contactEmail: "edit@example.org", eventTitle: "토론회",
        eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다. 발제와 자유토론으로 진행합니다.",
        expectedHeadcount: "10", discountRuleId: "", optionKeys: [],
        consents: ["privacy", "operationRules", "refundRules"], uploadToken: newUploadToken(), applicantPassword: "1234", applicantPasswordConfirm: "1234",
      },
      {},
      now,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    return (await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo)))[0]!;
  }
  const rawOf = (a: typeof applications.$inferSelect, date: string, over: Partial<AdminEditRaw> = {}): AdminEditRaw => ({
    spaceId: a.spaceId!, date, start: "10:00", end: "12:00", orgName: a.orgName, regType: "", regNo: "",
    contactName: a.contactName, contactPhone: a.contactPhone, contactEmail: a.contactEmail, eventTitle: a.eventTitle,
    eventPurpose: a.eventPurpose, expectedHeadcount: String(a.expectedHeadcount), receiptType: "none", ...over,
  });
  const appOf = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0]!;

  it("입금 대기 신청: 공간·일시·단체·증빙을 바꾸고 요금을 다시 계산하며, 일정 점유도 옮긴다", async () => {
    const a = await submit("2026-11-12");
    expect(a.totalAmount).toBe(40000);
    const r = await updateApplicationByAdmin(db, null, {
      actor: rental,
      applicationId: a.id,
      raw: rawOf(a, "2026-11-13", {
        spaceId: hall.id, start: "14:00", end: "17:00", orgName: "○○네트워크", regType: "business_no", regNo: "123-82-87650",
        receiptType: "tax_invoice", taxBizNo: "123-82-87650", taxCompany: "○○네트워크", taxCeo: "김대표", taxEmail: "bill@example.org",
      }),
      reason: "전화로 변경 요청",
      recalculate: true,
      notify: true,
      now,
    });
    expect(r).toMatchObject({ ok: true, value: { total: 120000 } });
    const app = await appOf(a.id);
    expect(app).toMatchObject({ spaceId: hall.id, orgName: "○○네트워크", totalAmount: 120000 });
    expect(app.startsAt.toISOString()).toBe("2026-11-13T05:00:00.000Z");
    expect(app.organizationId).not.toBeNull();
    expect(app.receiptRequest).toMatchObject({ type: "tax_invoice", company: "○○네트워크" });
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, a.id));
    expect(pay).toMatchObject({ amount: 120000, status: "ready" });
    const [occ] = await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, a.id));
    expect(occ?.spaceId).toBe(hall.id);
    const hist = await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, a.id));
    expect(hist.some((h) => h.reason?.includes("일시: 2026-11-12 10:00~12:00 → 2026-11-13 14:00~17:00"))).toBe(true);
    const mail = (await db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, a.id))).find((l) => l.event === "updated" && l.channel === "email");
    expect(mail?.body).toContain("단체명: ○○모임 → ○○네트워크");
    expect(mail?.body).toContain("금액: 40,000원 → 120,000원");

    // 바뀐 것이 없으면 저장하지 않는다
    const same = await appOf(a.id);
    expect(
      await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(same, "2026-11-13", { spaceId: hall.id, start: "14:00", end: "17:00", regType: "business_no", regNo: "1238287650", receiptType: "tax_invoice", taxBizNo: "1238287650", taxCompany: "○○네트워크", taxCeo: "김대표", taxEmail: "bill@example.org" }), reason: "다시", recalculate: false, notify: false, now }),
    ).toMatchObject({ ok: false, formError: "바뀐 내용이 없습니다." });
  });

  it("다른 일정과 겹치면 막고, 사유·입력 오류·권한을 확인한다", async () => {
    const a = await submit("2026-11-17");
    const b = await submit("2026-11-17", "14:00", "16:00");
    const overlap = await updateApplicationByAdmin(db, null, { actor: rental, applicationId: b.id, raw: rawOf(b, "2026-11-17", { start: "11:00", end: "13:00" }), reason: "변경", recalculate: false, notify: false, now });
    expect(overlap).toMatchObject({ ok: false, formError: expect.stringContaining("겹칩니다") });
    expect((await appOf(b.id)).startsAt.toISOString()).toBe("2026-11-17T05:00:00.000Z");
    expect(await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-17", { orgName: "새 이름" }), reason: "", recalculate: false, notify: false, now })).toMatchObject({ ok: false });
    expect(await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-17", { end: "09:00" }), reason: "변경", recalculate: false, notify: false, now })).toMatchObject({ ok: false, fieldErrors: { end: expect.any(String) } });
    expect(await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-17", { receiptType: "cash", cashPurpose: "income", cashNumber: "12" }), reason: "변경", recalculate: false, notify: false, now })).toMatchObject({ ok: false, fieldErrors: { cashNumber: expect.any(String) } });
    const club = (await createTestAdmin(db, "club")).actor;
    await expect(updateApplicationByAdmin(db, null, { actor: club, applicationId: a.id, raw: rawOf(a, "2026-11-17"), reason: "변경", recalculate: false, notify: false, now })).rejects.toBeInstanceOf(PermissionError);
  });

  it("입금 후: 줄면 차액 환불 요청, 늘면 막고, 다시 계산을 끄면 금액은 그대로", async () => {
    const a = await submit("2026-11-19", "10:00", "13:00"); // 40,000 + 20,000
    expect(await confirmDeposit(db, { actor: rental, applicationId: a.id, approve: true, now })).toEqual({ ok: true });
    const up = await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-19", { end: "15:00" }), reason: "연장", recalculate: true, notify: false, now });
    expect(up).toMatchObject({ ok: false, formError: expect.stringContaining("받은 금액") });
    const keep = await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-19", { end: "15:00" }), reason: "연장(차액 따로)", recalculate: false, notify: false, now });
    expect(keep).toMatchObject({ ok: true, value: { total: 60000 } });
    const down = await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-19", { end: "12:00" }), reason: "단축", recalculate: true, notify: false, now });
    expect(down).toMatchObject({ ok: true, value: { total: 40000, refundAmount: 20000 } });
    const [rf] = await db.select().from(refunds).where(eq(refunds.applicationId, a.id));
    expect(rf).toMatchObject({ amount: 20000, basis: "discount" });
    expect((await appOf(a.id)).status).toBe("confirmed");
  });

  it("끝난 신청은 공간·일시를 바꿀 수 없지만 다른 정보는 고칠 수 있다", async () => {
    const a = await submit("2026-11-24");
    expect(await withdrawApplication(db, null, { applicationId: a.id, reason: "취소" })).toMatchObject({ ok: true });
    expect(await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-25"), reason: "변경", recalculate: false, notify: false, now })).toMatchObject({ ok: false, formError: expect.stringContaining("끝난 신청") });
    expect(await updateApplicationByAdmin(db, null, { actor: rental, applicationId: a.id, raw: rawOf(a, "2026-11-24", { contactPhone: "010-9999-0000" }), reason: "번호 정정", recalculate: false, notify: false, now })).toMatchObject({ ok: true });
    expect((await appOf(a.id)).contactPhone).toBe("01099990000");
  });
});
