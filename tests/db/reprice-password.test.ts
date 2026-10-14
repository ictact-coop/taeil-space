import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { changeApplicantPassword, loginWithPhone } from "@/server/applicant/auth";
import { setApplicantPasswordByAdmin } from "@/server/applications/admin-manage";
import { confirmDeposit } from "@/server/applications/review";
import { PermissionError } from "@/server/auth/permissions";
import { newUploadToken } from "@/server/booking/attachments";
import { submitApplication } from "@/server/booking/submit";
import { applications, applicationStatusHistory, payments, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { repricePendingApplications } from "@/server/pricing/reprice-pending";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const now = new Date("2026-10-29T01:00:00Z");
const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 0 };

describe.skipIf(!hasTestDb)("요금표 변경 재계산·나의 대관 비밀번호 변경", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: Actor;
  let rental: Actor;
  let room: typeof spaces.$inferSelect;
  let storageDir: string;
  let day = 0;

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-rp-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    system = (await createTestAdmin(db, "system")).actor;
    rental = (await createTestAdmin(db, "rental")).actor;
    room = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60 });
    const t = new Date("2026-10-01T00:00:00Z");
    expect(await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: fee }, options: [] }, effectiveFrom: t, reason: "요금", now: t })).toMatchObject({ ok: true });
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function submit(email: string, phone = "010-2222-3333", at = now) {
    day += 1;
    const date = new Date(Date.UTC(2026, 10, 11 + day)).toISOString().slice(0, 10);
    const r = await submitApplication(
      db,
      {
        spaceId: room.id, date, start: "10:00", end: "14:00", orgName: `단체${day}`, regType: "", regNo: "",
        contactName: "홍길동", contactPhone: phone, contactEmail: email, eventTitle: "토론회",
        eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다. 발제와 자유토론으로 진행합니다.",
        expectedHeadcount: "10", discountRuleId: "", optionKeys: [],
        consents: ["privacy", "operationRules", "refundRules"], uploadToken: newUploadToken(), applicantPassword: "1234", applicantPasswordConfirm: "1234",
      },
      {},
      at,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const [app] = await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo));
    return app!;
  }
  const appOf = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0]!;
  const payOf = async (id: string) => (await db.select().from(payments).where(eq(payments.applicationId, id)))[0]!;

  it("새 요금표가 적용되면 입금 대기 신청만 새 요금으로 다시 계산한다(바로 적용·예약 적용)", async () => {
    const pending = await submit("p@example.org");
    const deposited = await submit("d@example.org");
    expect(pending.totalAmount).toBe(80000); // 기본 3시간 60,000 + 추가 1시간 20,000
    expect(await confirmDeposit(db, { actor: rental, applicationId: deposited.id, now })).toEqual({ ok: true });

    // 바로 적용: 저장하면서 입금 대기 신청 금액을 바꾼다
    const t2 = new Date(now.getTime() + 60_000);
    const saved = await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: { ...fee, baseFee: 70000 } }, options: [] }, effectiveFrom: t2, reason: "요금 인상", now: t2 });
    expect(saved).toMatchObject({ ok: true });
    expect((await appOf(pending.id)).totalAmount).toBe(90000);
    expect(await payOf(pending.id)).toMatchObject({ amount: 90000, status: "ready" });
    expect((await appOf(pending.id)).policySnapshot).toMatchObject({ feeScheduleId: saved.ok ? saved.value.id : -1 });
    const [hist] = await db
      .select()
      .from(applicationStatusHistory)
      .where(and(eq(applicationStatusHistory.applicationId, pending.id), eq(applicationStatusHistory.actorType, "system")));
    expect(hist?.reason).toContain("80,000원 → 90,000원");
    // 이미 입금 확인한 신청은 그대로
    expect((await appOf(deposited.id)).totalAmount).toBe(80000);
    expect((await payOf(deposited.id)).amount).toBe(80000);

    // 예약 적용: 적용 시각이 되기 전에는 그대로, 작업 큐가 적용 시각 뒤에 바꾼다
    const t3 = new Date(now.getTime() + 3 * 86_400_000);
    expect(await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: { ...fee, extraFee: 40000 } }, options: [] }, effectiveFrom: t3, reason: "예약 변경", now: t2 })).toMatchObject({ ok: true });
    expect((await appOf(pending.id)).totalAmount).toBe(90000);
    expect(await repricePendingApplications(db, new Date(t3.getTime() - 1000))).toBe(0);
    expect(await repricePendingApplications(db, new Date(t3.getTime() + 1000))).toBe(1);
    expect((await appOf(pending.id)).totalAmount).toBe(100000); // 기본 60,000 + 추가 40,000
    expect((await payOf(pending.id)).amount).toBe(100000);
    // 다시 돌려도 바뀌지 않는다
    expect(await repricePendingApplications(db, new Date(t3.getTime() + 2000))).toBe(0);
  });

  it("나의 대관 비밀번호: 로그인한 신청자가 바꾸고, 관리자가 다시 정해 줄 수 있다", async () => {
    const a = await submit("pw@example.org", "010-5555-6666");
    const b = await submit("pw@example.org", "010-5555-6666");
    expect(await changeApplicantPassword(db, { email: "pw@example.org", applicationIds: null, label: "pw@example.org" }, "12", "12")).toMatchObject({ ok: false });
    expect(await changeApplicantPassword(db, { email: "pw@example.org", applicationIds: null, label: "pw@example.org" }, "new-pass", "new-pas")).toMatchObject({ ok: false });
    // 이메일 확인 코드로 들어온 경우(잊은 비밀번호 재설정): 그 이메일의 신청 모두
    expect(await changeApplicantPassword(db, { email: "pw@example.org", applicationIds: null, label: "pw@example.org" }, "new-pass", "new-pass")).toEqual({ ok: true, count: 2 });
    expect(await loginWithPhone(db, "010-5555-6666", "1234", now)).toMatchObject({ ok: false });
    expect(await loginWithPhone(db, "010-5555-6666", "new-pass", now)).toMatchObject({ ok: true });
    // 전화번호로 들어온 경우: 그때 맞았던 신청만
    expect(await changeApplicantPassword(db, { email: null, applicationIds: [a.id], label: "010-****-6666" }, "only-a", "only-a")).toEqual({ ok: true, count: 1 });
    expect(await loginWithPhone(db, "010-5555-6666", "new-pass", now)).toMatchObject({ ok: true });
    expect(await loginWithPhone(db, "010-5555-6666", "only-a", now)).toMatchObject({ ok: true });

    // 관리자: 이 신청 하나에만, 사유 필수, 심사 권한 필요
    expect(await setApplicantPasswordByAdmin(db, { actor: rental, applicationId: b.id, password: "admin-set", reason: "" })).toMatchObject({ ok: false });
    expect(await setApplicantPasswordByAdmin(db, { actor: rental, applicationId: b.id, password: "admin-set", reason: "전화로 본인 확인" })).toEqual({ ok: true });
    expect(await loginWithPhone(db, "010-5555-6666", "admin-set", now)).toMatchObject({ ok: true });
    expect(await loginWithPhone(db, "010-5555-6666", "new-pass", now)).toMatchObject({ ok: false });
    const club = (await createTestAdmin(db, "club")).actor;
    await expect(setApplicantPasswordByAdmin(db, { actor: club, applicationId: b.id, password: "xxxx", reason: "시도" })).rejects.toBeInstanceOf(PermissionError);
  });
});
