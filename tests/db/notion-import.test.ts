import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmDeposit } from "@/server/applications/review";
import { sendDepositReminders } from "@/server/booking/deposit-reminder";
import { expirePendingApplications } from "@/server/booking/expire";
import { applicationStatusHistory, applications, notificationLogs, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { importNotionBookings } from "@/server/import/notion";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { notionLookups, notionPage } from "../fixtures/notion";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("노션 대관 신청 가져오기", () => {
  let db: Db;
  let close: () => Promise<void>;
  const now = new Date("2026-10-12T03:00:00Z");
  const since = "2026-10-15";

  const pages = [
    notionPage({ id: "ok-1", title: "노동조합 교육", start: "2026-10-15T01:00:00Z", end: "2026-10-15T04:00:00Z", spaces: ["sp-seminar"], org: "org-union", applicant: "홍길동", headcount: "12" }),
    notionPage({ id: "ok-2", title: "독서모임", status: "접수 전", start: "2026-10-18T02:00:00Z", end: "2026-10-18T05:00:00Z", spaces: ["sp-meeting1"], org: "org-none", applicant: "김철수" }),
    // 같은 시간·공간에 승인된 다른 신청 → 겹침
    notionPage({ id: "dup", title: "중복 워크숍", start: "2026-10-15T02:00:00Z", end: "2026-10-15T03:00:00Z", spaces: ["sp-seminar"] }),
    notionPage({ id: "rejected", title: "반려된 신청", status: "반려", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z" }),
    notionPage({ id: "old", title: "지난 신청", start: "2026-10-10T05:00:00Z", end: "2026-10-10T06:00:00Z" }),
    notionPage({ id: "bad", title: "시각 오류", start: "2026-10-17T13:30:00Z", end: "2026-10-17T04:29:00Z" }),
  ];

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    const admin = await createTestAdmin(db, "system");
    const rows = await db.select().from(spaces);
    const findCode = (code: string) => rows.find((s) => s.code === code);
    let seminar = findCode("seminar");
    let meeting1 = findCode("meeting1");
    if (!seminar) [seminar] = await db.insert(spaces).values({ code: "seminar", name: "세미나실", capacity: 15, leadDays: 14 }).returning();
    if (!meeting1) [meeting1] = await db.insert(spaces).values({ code: "meeting1", name: "회의실1", capacity: 8, leadDays: 14 }).returning();
    const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
    const r = await saveFeeSchedule(db, { actor: admin.actor, items: { spaces: { [seminar!.id]: fee, [meeting1!.id]: { ...fee, baseFee: 30000 } }, options: [] }, effectiveFrom: new Date("2026-10-01T00:00:00Z"), reason: "테스트 요금", now: new Date("2026-10-01T00:00:00Z") });
    expect(r.ok).toBe(true);
  });
  afterAll(async () => close?.());

  it("미리보기: 결과만 보여 주고 아무것도 저장하지 않는다", async () => {
    const r = await importNotionBookings(db, pages, notionLookups, { since, apply: false, now });
    expect(r.applied).toBe(false);
    expect(r.created.map((c) => c.title)).toEqual(["노동조합 교육", "독서모임"]);
    expect(r.conflicts.map((c) => [c.title, c.with])).toEqual([["중복 워크숍", expect.stringContaining("노동조합 교육")]]);
    expect(r.skipped.map((s) => s.title)).toEqual(["시각 오류"]);
    expect(r.ignored).toBe(2); // 반려, 기준일 이전
    expect(await db.select().from(applications)).toHaveLength(0);
  });

  it("저장: 입금 대기(미결제)·계좌이체 결제 대기·일정 점유, 메일 없음", async () => {
    const r = await importNotionBookings(db, pages, notionLookups, { since, apply: true, now });
    expect(r.created).toHaveLength(2);
    expect(r.created[0]).toMatchObject({ amount: 60000, spaceName: "세미나실", orgName: "○○노동조합", notionStatus: "승인" });
    expect(r.created[1]).toMatchObject({ amount: 30000, notionStatus: "접수 전" });

    const [app] = await db.select().from(applications).where(eq(applications.importRef, "notion:ok-1"));
    expect(app).toMatchObject({ status: "pending_payment", expectedHeadcount: 12, contactName: "홍길동", totalAmount: 60000, eventTitle: "노동조합 교육" });
    expect(app!.startsAt.toISOString()).toBe("2026-10-15T01:00:00.000Z");
    expect(app!.organizationId).not.toBeNull();
    const [occ] = await db.select().from(slotOccupancies).where(eq(slotOccupancies.applicationId, app!.id));
    expect(occ).toMatchObject({ kind: "pending_payment" });
    expect(occ!.expiresAt?.toISOString()).toBe("2026-10-15T01:00:00.000Z");
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, app!.id));
    expect(pay).toMatchObject({ method: "bank_transfer", status: "ready", amount: 60000 });
    const hist = await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, app!.id));
    expect(hist[0]?.reason).toContain("노션에서 가져옴");
    expect(await db.select().from(notificationLogs)).toHaveLength(0);
  });

  it("다시 실행해도 중복으로 만들지 않는다", async () => {
    const r = await importNotionBookings(db, pages, notionLookups, { since, apply: true, now });
    expect(r.created).toHaveLength(0);
    expect(r.existing).toHaveLength(2);
    expect(await db.select().from(applications)).toHaveLength(2);
  });

  it("겹치면 노션에서 승인된 신청을 먼저 가져온다(시간이 빨라도 미승인은 밀림)", async () => {
    const overlap = [
      notionPage({ id: "early-pending", title: "먼저 들어온 접수 전", status: "접수 전", start: "2026-11-20T01:00:00Z", end: "2026-11-20T03:00:00Z", spaces: ["sp-seminar"] }),
      notionPage({ id: "late-approved", title: "승인된 신청", status: "승인", start: "2026-11-20T02:00:00Z", end: "2026-11-20T04:00:00Z", spaces: ["sp-seminar"] }),
    ];
    const r = await importNotionBookings(db, overlap, notionLookups, { since, apply: false, now });
    expect(r.created.map((c) => c.title)).toEqual(["승인된 신청"]);
    expect(r.conflicts).toEqual([expect.objectContaining({ title: "먼저 들어온 접수 전", notionStatus: "접수 전", with: expect.stringContaining("승인된 신청") })]);
  });

  it("가져온 신청은 자동 취소·입금 기한 알림을 하지 않고, 담당자가 입금 확인할 수 있다", async () => {
    const afterStart = new Date("2026-10-16T00:00:00Z");
    expect(await sendDepositReminders(db, new Date("2026-10-14T23:00:00Z"))).toBe(0);
    expect(await expirePendingApplications(db, afterStart)).toBe(0);
    const [app] = await db.select().from(applications).where(eq(applications.importRef, "notion:ok-2"));
    expect(app!.status).toBe("pending_payment");
    const staff = await createTestAdmin(db, "rental");
    expect(await confirmDeposit(db, { actor: staff.actor, applicationId: app!.id, approve: true, now: afterStart })).toEqual({ ok: true });
    const [after] = await db.select().from(applications).where(eq(applications.id, app!.id));
    expect(after!.status).toBe("confirmed");
  });
});
