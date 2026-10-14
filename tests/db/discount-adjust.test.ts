import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeApplicationDiscount } from "@/server/applications/discount-adjust";
import { PermissionError } from "@/server/auth/permissions";
import { applicationStatusHistory, applications, discountRules, payments, refunds } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { createTestAdmin, createTestApplication, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("감면 사후 적용", () => {
  let db: Db;
  let close: () => Promise<void>;
  let staff: Awaited<ReturnType<typeof createTestAdmin>>;
  let spaceId: string;
  let half: string;
  let fixed: string;
  let day = 0;
  const price = { items: [{ kind: "base", label: "기본 대관료(3시간)", amount: 60000 }, { kind: "option", label: "빔", amount: 10000 }], subtotal: 70000, discountAmount: 0, total: 70000, durationMinutes: 180, nightMinutes: 0 };

  async function app(status: "pending_payment" | "confirmed") {
    day += 1;
    const startsAt = new Date(`2026-12-${String(day).padStart(2, "0")}T01:00:00Z`);
    const a = await createTestApplication(db, { spaceId, startsAt, endsAt: new Date(startsAt.getTime() + 3 * 3600_000), status });
    await db.update(applications).set({ totalAmount: 70000, priceSnapshot: price }).where(eq(applications.id, a.id));
    await db.insert(payments).values({
      applicationId: a.id, orderId: `${a.applicationNo}-p`, method: "bank_transfer", amount: 70000,
      status: status === "pending_payment" ? "ready" : "paid", paidAt: status === "pending_payment" ? null : new Date(),
    });
    return a;
  }

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    staff = await createTestAdmin(db, "rental");
    spaceId = (await createTestSpace(db)).id;
    half = (await db.insert(discountRules).values({ name: "비영리 50%", kind: "percent", value: 50 }).returning({ id: discountRules.id }))[0]!.id;
    fixed = (await db.insert(discountRules).values({ name: "정액 1만원", kind: "amount", value: 10000 }).returning({ id: discountRules.id }))[0]!.id;
  });
  afterAll(async () => close?.());

  it("입금 전: 받을 금액(결제 대기 금액)이 바뀌고 이력이 남는다", async () => {
    const a = await app("pending_payment");
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: half, reason: "고유번호증 확인" })).toEqual({ ok: true, value: { total: 35000, refundAmount: 0 } });
    const [after] = await db.select().from(applications).where(eq(applications.id, a.id));
    expect(after).toMatchObject({ totalAmount: 35000, discountRuleId: half });
    expect((after!.priceSnapshot as typeof price).items.at(-1)).toEqual({ kind: "discount", label: "감면: 비영리 50%", amount: -35000 });
    const [pay] = await db.select().from(payments).where(eq(payments.applicationId, a.id));
    expect(pay!.amount).toBe(35000);
    const hist = await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, a.id));
    expect(hist.at(-1)?.reason).toContain("감면 적용: 비영리 50%");
    // 해제하면 원래 금액
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: null, reason: "증빙 불충분" })).toMatchObject({ ok: true, value: { total: 70000 } });
    // 같은 감면은 거부, 사유 필수
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: null, reason: "다시" })).toMatchObject({ ok: false });
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: half, reason: "" })).toMatchObject({ ok: false });
  });

  it("입금 후: 줄어든 만큼 환불 요청(계좌이체는 수동), 늘어나는 변경은 거부", async () => {
    const a = await app("confirmed");
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: fixed, reason: "사후 증빙" })).toEqual({ ok: true, value: { total: 60000, refundAmount: 10000 } });
    const [r] = await db.select().from(refunds).where(eq(refunds.applicationId, a.id));
    expect(r).toMatchObject({ basis: "discount", amount: 10000, status: "requested" });
    // 정액 → 50%로 더 깎으면 남은 차액만 추가 환불(이미 요청한 1만원 + 2.5만원 = 3.5만원)
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: a.id, discountRuleId: half, reason: "추가 확인" })).toEqual({ ok: true, value: { total: 35000, refundAmount: 25000 } });
    const all = await db.select().from(refunds).where(eq(refunds.applicationId, a.id));
    expect(all.reduce((s, x) => s + x.amount, 0)).toBe(35000); // 겹쳐 환불하지 않는다
    // 받은 금액보다 커지는 변경(감면 해제)은 막는다
    const b = await app("confirmed");
    await db.update(applications).set({ discountRuleId: half, totalAmount: 35000, priceSnapshot: { ...price, items: [...price.items, { kind: "discount", label: "감면: 비영리 50%", amount: -35000 }] } }).where(eq(applications.id, b.id));
    await db.update(payments).set({ amount: 35000 }).where(eq(payments.applicationId, b.id));
    expect(await changeApplicationDiscount(db, null, { actor: staff.actor, applicationId: b.id, discountRuleId: null, reason: "해제" })).toMatchObject({ ok: false, formError: expect.stringContaining("이미 받은 금액") });
  });

  it("동아리 운영자처럼 심사 권한이 없으면 못 한다", async () => {
    const a = await app("pending_payment");
    const club = await createTestAdmin(db, "club");
    await expect(changeApplicationDiscount(db, null, { actor: club.actor, applicationId: a.id, discountRuleId: half, reason: "x" })).rejects.toBeInstanceOf(PermissionError);
  });
});
