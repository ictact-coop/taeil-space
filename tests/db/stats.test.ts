import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, payments, refunds } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { getPerformanceReport, performanceCsv } from "@/server/stats/performance";
import { createTestApplication, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const at = (s: string) => new Date(`${s}+09:00`);

describe.skipIf(!hasTestDb)("월별·주별 실적 통계", () => {
  let db: Db;
  let close: () => Promise<void>;
  let hall: { id: string };
  let room: { id: string };

  async function app(spaceId: string, start: string, end: string, status: (typeof applications.$inferSelect)["status"], extra: Partial<typeof applications.$inferInsert> = {}) {
    const a = await createTestApplication(db, { spaceId, startsAt: at(start), endsAt: at(end), status });
    if (Object.keys(extra).length > 0) await db.update(applications).set(extra).where(eq(applications.id, a.id));
    return a;
  }

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    hall = await createTestSpace(db, { name: "공연장", sortOrder: 1 });
    room = await createTestSpace(db, { name: "교육실", sortOrder: 2 });

    // 3월: 공연장 확정 3시간(유료), 교육실 확정 2시간(무료), 교육실 취소(제외)
    const a1 = await app(hall.id, "2030-03-05T10:00:00", "2030-03-05T13:00:00", "confirmed", { expectedHeadcount: 80, totalAmount: 150000, submittedAt: at("2030-02-20T09:00:00") });
    await app(room.id, "2030-03-12T14:00:00", "2030-03-12T16:00:00", "completed", { expectedHeadcount: 15, totalAmount: 0, submittedAt: at("2030-03-01T00:30:00") });
    await app(room.id, "2030-03-10T10:00:00", "2030-03-10T12:00:00", "cancelled", { submittedAt: at("2030-03-02T10:00:00") });
    // 4/1 00:30 KST (UTC로는 3/31) → 4월
    await app(hall.id, "2030-04-01T00:30:00", "2030-04-01T02:30:00", "cancel_requested", { submittedAt: at("2030-03-20T10:00:00") });
    // 3월 접수: 반려 1, 진행 중 1
    await app(hall.id, "2030-05-01T10:00:00", "2030-05-01T11:00:00", "rejected", { submittedAt: at("2030-03-21T10:00:00") });
    await app(hall.id, "2030-05-02T10:00:00", "2030-05-02T11:00:00", "reviewing", { submittedAt: at("2030-03-31T23:59:00") });
    // 임시 저장(제출 안 함)은 접수에서 제외
    await app(hall.id, "2030-05-03T10:00:00", "2030-05-03T11:00:00", "draft");

    // 수입: 3/1 00:10 KST 입금(UTC 2/28) → 3월, 4월에 일부 환불 완료, 실패한 환불은 제외
    const [pay] = await db
      .insert(payments)
      .values({ applicationId: a1.id, orderId: "stat-1", method: "bank_transfer", amount: 150000, status: "paid", paidAt: at("2030-03-01T00:10:00") })
      .returning();
    await db.insert(payments).values({ applicationId: a1.id, orderId: "stat-2", method: "bank_transfer", amount: 99000, status: "ready" });
    await db.insert(refunds).values([
      { paymentId: pay!.id, applicationId: a1.id, basis: "cancelled", ratePercent: 20, amount: 30000, status: "succeeded", completedAt: at("2030-04-02T10:00:00") },
      { paymentId: pay!.id, applicationId: a1.id, basis: "cancelled", ratePercent: 10, amount: 15000, status: "failed" },
    ]);
  });
  afterAll(async () => close?.());

  it("월별: 이용·접수·수입을 KST 달로 나누고 합계를 낸다", async () => {
    const r = await getPerformanceReport(db, { granularity: "month", year: 2030 });
    expect(r.rows).toHaveLength(12);
    const [, feb, mar, apr] = r.rows;
    expect(mar!.usage).toEqual({ bookings: 2, hours: 5, headcount: 95, freeBookings: 1 });
    expect(mar!.usageBySpace[hall.id]).toEqual({ bookings: 1, hours: 3, headcount: 80, freeBookings: 0 });
    expect(mar!.usageBySpace[room.id]).toEqual({ bookings: 1, hours: 2, headcount: 15, freeBookings: 1 });
    expect(apr!.usage.bookings).toBe(1);

    expect(feb!.intake).toEqual({ submitted: 1, inProgress: 0, confirmed: 1, rejected: 0, dropped: 0 });
    expect(mar!.intake).toEqual({ submitted: 5, inProgress: 1, confirmed: 2, rejected: 1, dropped: 1 });

    expect(mar!.revenue).toEqual({ received: 150000, refunded: 0, net: 150000 });
    expect(apr!.revenue).toEqual({ received: 0, refunded: 30000, net: -30000 });
    expect(r.total.revenue).toEqual({ received: 150000, refunded: 30000, net: 120000 });
    expect(r.total.usage.bookings).toBe(3);
    expect(r.total.intake.submitted).toBe(6);
    expect(r.spaces.map((s) => s.name).slice(0, 2)).toEqual(["공연장", "교육실"]);
  });

  it("주별: 3월 1주(3/4~3/10)와 2주, 경계 밖은 제외", async () => {
    const r = await getPerformanceReport(db, { granularity: "week", year: 2030, month: 3 });
    expect(r.rows.map((w) => w.key)).toEqual(["2030-03-04", "2030-03-11", "2030-03-18", "2030-03-25"]);
    expect(r.rows[0]!.usage.bookings).toBe(1);
    expect(r.rows[1]!.usage).toMatchObject({ bookings: 1, freeBookings: 1 });
    // 3/1 입금은 2월 마지막 주(2/25 주)에 속해 3월 주별에는 없다
    expect(r.total.revenue.received).toBe(0);
    // 3/31 23:59 접수는 3/25 주
    expect(r.rows[3]!.intake.submitted).toBe(1);
  });

  it("CSV: BOM, 공간별 열, 합계 줄", async () => {
    const csv = performanceCsv(await getPerformanceReport(db, { granularity: "month", year: 2030 }));
    expect(csv.startsWith("﻿기간,날짜,이용 건수")).toBe(true);
    expect(csv).toContain("공연장 건수,공연장 시간,교육실 건수,교육실 시간");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(14);
    expect(lines[3]!.startsWith("3월,3/1~3/31,2,5,95,1,1,3,1,2")).toBe(true);
    expect(lines.at(-1)!.startsWith("합계,,3,")).toBe(true);
    expect(lines.at(-1)!.endsWith(",150000,30000,120000")).toBe(true);
  });
});
