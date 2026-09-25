import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { PermissionError } from "@/server/auth/permissions";
import { createBlock, deleteBlock, tstzRange } from "@/server/calendar/block-service";
import { extendBookingWindow, getBookingWindowView, setBookingWindow } from "@/server/calendar/booking-window-service";
import { createClosureRule, deactivateClosureRule } from "@/server/calendar/closure-service";
import { auditLogs, closureRules, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveDiscountRule } from "@/server/pricing/discount-service";
import { cancelScheduledFeeSchedule, getFeeScheduleAt, listFeeSchedules, saveFeeSchedule } from "@/server/pricing/fee-service";
import { computeReadiness } from "@/server/settings/readiness";
import { confirmSettings, getSetting, saveSettingChanges } from "@/server/settings/service";
import { saveSpace } from "@/server/spaces/service";
import { createTestAdmin, createTestApplication, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("단계 1 설정 서비스", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: Actor;
  let rental: Actor;

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    system = { id: (await createTestAdmin(db, "system")).id, role: "system" };
    rental = { id: (await createTestAdmin(db, "rental")).id, role: "rental" };
  });
  afterAll(async () => close?.());

  const spaceRaw = (over: Record<string, unknown> = {}) => ({
    code: "room-a", name: "회의실A", capacity: "8", minHeadcount: "", description: "", equipment: "화이트보드", notice: "",
    leadDays: "14", slotMinutes: "60", minDurationMinutes: "60", bufferBeforeMinutes: "0", bufferAfterMinutes: "0",
    extraConsents: [], isPublic: true, sortOrder: "1", ...over,
  });

  describe("공간", () => {
    it("추가·수정하면 감사 로그에 전후 값이 남고, 코드 중복은 막는다", async () => {
      const created = await saveSpace(db, { actor: system, id: null, raw: spaceRaw(), reason: "신규 공간" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const updated = await saveSpace(db, { actor: system, id: created.value.id, raw: spaceRaw({ capacity: "10" }), reason: "정원 변경" });
      expect(updated).toMatchObject({ ok: true, value: { capacity: 10 } });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "space.update"));
      expect(log?.before).toMatchObject({ capacity: 8 });
      expect(log?.after).toMatchObject({ capacity: 10 });

      const dup = await saveSpace(db, { actor: system, id: null, raw: spaceRaw(), reason: "중복" });
      expect(dup).toMatchObject({ ok: false, fieldErrors: { code: expect.any(String) } });
    });

    it("대관 담당자는 공간을 수정할 수 없다", async () => {
      await expect(saveSpace(db, { actor: rental, id: null, raw: spaceRaw({ code: "room-b" }), reason: "x" })).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe("휴관 규칙", () => {
    it("진행 중 신청과 겹치면 확인을 요구하고, 확인하면 저장한다(기존 신청은 그대로)", async () => {
      const space = await createTestSpace(db);
      // 2026-11-17(화) 10:00 KST 신청
      const app = await createTestApplication(db, { spaceId: space.id, startsAt: new Date("2026-11-17T01:00:00Z"), endsAt: new Date("2026-11-17T04:00:00Z") });
      const raw = { type: "weekly", name: "화요일 휴관", publicMessage: "화요일 휴관", spaceId: "", weekday: "2", month: "", day: "", startDate: "", endDate: "", activeFrom: "", activeUntil: "" };
      const now = new Date("2026-10-06T00:00:00Z");

      const first = await createClosureRule(db, { actor: rental, raw, reason: "시범 휴관", now });
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.conflicts?.map((c) => c.applicationNo)).toEqual([app.applicationNo]);

      const confirmed = await createClosureRule(db, { actor: rental, raw, reason: "시범 휴관", confirmConflicts: true, now });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;

      expect(await deactivateClosureRule(db, { actor: rental, id: confirmed.value.id, reason: "철회" })).toEqual({ ok: true });
      const [row] = await db.select().from(closureRules).where(eq(closureRules.id, confirmed.value.id));
      expect(row?.isActive).toBe(false);
      expect(await deactivateClosureRule(db, { actor: rental, id: confirmed.value.id, reason: "다시" })).toMatchObject({ ok: false });
    });

    it("이미 끝난 신청이나 다른 날짜의 신청은 충돌로 보지 않는다", async () => {
      const space = await createTestSpace(db);
      await createTestApplication(db, { spaceId: space.id, startsAt: new Date("2026-11-18T01:00:00Z"), endsAt: new Date("2026-11-18T02:00:00Z"), status: "rejected" });
      const r = await createClosureRule(db, {
        actor: system,
        raw: { type: "date_range", name: "점검", publicMessage: "점검", spaceId: space.id, startDate: "2026-11-18", endDate: "2026-11-18" },
        reason: "점검",
        now: new Date("2026-10-06T00:00:00Z"),
      });
      expect(r).toMatchObject({ ok: true, conflicts: [] });
    });
  });

  describe("일정 차단", () => {
    it("전체 공간 차단은 모든 공간에 점유를 만들고, 해제하면 점유도 지운다", async () => {
      const count = (await db.select({ id: spaces.id }).from(spaces)).length;
      const r = await createBlock(db, {
        actor: rental,
        raw: { kind: "event", spaceId: "", startsAt: "2026-12-01T10:00", endsAt: "2026-12-01T18:00", reason: "기념관 행사" },
      });
      expect(r).toEqual({ ok: true });
      const occ = await db.select().from(slotOccupancies).where(eq(slotOccupancies.kind, "block"));
      expect(occ).toHaveLength(count);

      const blockId = occ[0]!.scheduleBlockId!;
      expect(await deleteBlock(db, { actor: rental, id: blockId, reason: "행사 취소" })).toEqual({ ok: true });
      expect(await db.select().from(slotOccupancies).where(eq(slotOccupancies.scheduleBlockId, blockId))).toHaveLength(0);
    });

    it("확정 신청과 겹치면 등록하지 않고 겹치는 신청을 알려준다 (AT-10)", async () => {
      const space = await createTestSpace(db);
      const app = await createTestApplication(db, { spaceId: space.id, startsAt: new Date("2026-12-02T01:00:00Z"), endsAt: new Date("2026-12-02T04:00:00Z") });
      await db.insert(slotOccupancies).values({ spaceId: space.id, during: tstzRange(app.startsAt, app.endsAt), kind: "confirmed", applicationId: app.id });

      const r = await createBlock(db, {
        actor: system,
        raw: { kind: "maintenance", spaceId: space.id, startsAt: "2026-12-02T12:00", endsAt: "2026-12-02T15:00", reason: "점검" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.conflicts?.[0]?.label).toContain(app.applicationNo);
      // 실패한 등록은 흔적을 남기지 않는다
      const blocks = await db.execute(sql`select count(*)::int as n from schedule_blocks where reason = '점검'`);
      expect((blocks.rows[0] as { n: number }).n).toBe(0);
    });
  });

  describe("교육실 접수기간", () => {
    it("연장은 설정된 일수만큼 늘리고, 공개 기간이 없으면 오늘부터 연다", async () => {
      const edu = await createTestSpace(db, { leadDays: null, name: "교육실" });
      const now = new Date("2026-10-06T03:00:00Z"); // KST 10/06
      expect(await extendBookingWindow(db, { actor: rental, spaceId: edu.id, reason: "첫 공개", now })).toEqual({ ok: true });
      let view = await getBookingWindowView(db, edu.id, now);
      expect(view.effective).toEqual({ from: "2026-10-06", until: "2026-10-13" });

      await extendBookingWindow(db, { actor: rental, spaceId: edu.id, reason: "연장", now });
      view = await getBookingWindowView(db, edu.id, now);
      expect(view.effective).toEqual({ from: "2026-10-06", until: "2026-10-20" });

      expect(await setBookingWindow(db, { actor: rental, spaceId: edu.id, opensFrom: "2026-10-10", opensUntil: "2026-10-01", reason: "x" })).toMatchObject({ ok: false });
    });

    it("신청기한으로 운영하는 공간에는 접수기간을 둘 수 없다", async () => {
      const room = await createTestSpace(db, { leadDays: 14 });
      expect(await setBookingWindow(db, { actor: rental, spaceId: room.id, opensFrom: "2026-10-10", opensUntil: "2026-10-20", reason: "x" })).toMatchObject({ ok: false });
    });

    it("자동 방식이면 수동 기간과 상관없이 오늘부터 N일", async () => {
      const edu = await createTestSpace(db, { leadDays: null });
      const now = new Date("2026-10-06T03:00:00Z");
      await saveSettingChanges(db, { actor: rental, rawValues: { "schedule.bookingWindowMode": "auto" }, effectiveFrom: now, reason: "자동 전환", now });
      expect((await getBookingWindowView(db, edu.id, now)).effective).toEqual({ from: "2026-10-06", until: "2026-10-20" });
      await saveSettingChanges(db, { actor: rental, rawValues: { "schedule.bookingWindowMode": "manual" }, effectiveFrom: new Date(now.getTime() + 1000), reason: "수동 복귀", now: new Date(now.getTime() + 1000) });
    });
  });

  describe("요금표", () => {
    const fee = { baseMinutes: 180, baseFee: 60000, extraUnitMinutes: 60, extraFee: 20000, nightFeePerHour: 10000 };
    const itemsFor = async (baseFee = 60000) => {
      const all = await db.select({ id: spaces.id, isPublic: spaces.isPublic }).from(spaces);
      return { spaces: Object.fromEntries(all.filter((s) => s.isPublic).map((s) => [s.id, { ...fee, baseFee }])), options: [] };
    };

    it("공개 공간이 빠지면 저장하지 않는다", async () => {
      const items = await itemsFor();
      const firstKey = Object.keys(items.spaces)[0]!;
      delete (items.spaces as Record<string, unknown>)[firstKey];
      const r = await saveFeeSchedule(db, { actor: system, items, effectiveFrom: new Date(), reason: "요금 입력" });
      expect(r).toMatchObject({ ok: false, formError: expect.stringContaining("공개 공간의 요금을 모두") });
    });

    it("저장·예약·예약 취소, 같은 내용은 저장하지 않음", async () => {
      const now = new Date("2026-10-06T00:00:00Z");
      expect(await saveFeeSchedule(db, { actor: system, items: await itemsFor(), effectiveFrom: now, reason: "초기 요금", now })).toMatchObject({ ok: true });
      expect(await saveFeeSchedule(db, { actor: system, items: await itemsFor(), effectiveFrom: now, reason: "같음", now })).toMatchObject({ ok: false });

      const nov = new Date("2026-11-01T00:00:00Z");
      const scheduled = await saveFeeSchedule(db, { actor: system, items: await itemsFor(70000), effectiveFrom: nov, reason: "11월 인상", now });
      expect(scheduled.ok).toBe(true);
      const at = async (d: Date) => Object.values((await getFeeScheduleAt(db, d))!.items.spaces)[0]!.baseFee;
      expect(await at(now)).toBe(60000);
      expect(await at(nov)).toBe(70000);

      if (!scheduled.ok) return;
      expect(await cancelScheduledFeeSchedule(db, { actor: system, id: scheduled.value.id, reason: "보류", now })).toEqual({ ok: true });
      expect(await at(nov)).toBe(60000);
      const statuses = (await listFeeSchedules(db, now)).map((v) => v.status);
      expect(statuses).toEqual(expect.arrayContaining(["active", "cancelled", "superseded"]));
    });

    it("대관 담당자는 요금표를 바꿀 수 없다", async () => {
      await expect(saveFeeSchedule(db, { actor: rental, items: await itemsFor(), effectiveFrom: new Date(), reason: "x" })).rejects.toBeInstanceOf(PermissionError);
    });
  });

  describe("감면", () => {
    it("추가·수정하고 감사 로그를 남긴다", async () => {
      const raw = { name: "공익 협력단체", description: "", kind: "percent", value: "50", proofRequired: true, proofGuide: "고유번호증", isActive: true, sortOrder: "0" };
      const created = await saveDiscountRule(db, { actor: system, id: null, raw, reason: "감면 신설" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const updated = await saveDiscountRule(db, { actor: system, id: created.value.id, raw: { ...raw, value: "30" }, reason: "비율 조정" });
      expect(updated).toMatchObject({ ok: true, value: { value: 30 } });
      expect(await saveDiscountRule(db, { actor: system, id: null, raw: { ...raw, value: "0" }, reason: "x" })).toMatchObject({ ok: false });
    });
  });

  describe("오픈 준비 점검", () => {
    it("필수 설정은 기본값이면 확인 필요, 확정하면 완료가 된다", async () => {
      const now = new Date("2026-10-07T00:00:00Z");
      let items = await computeReadiness(db, now);
      expect(items.find((i) => i.id === "payment.pgHoldMinutes")?.state).toBe("confirm");
      expect(items.find((i) => i.id === "payment.refundTiers")?.state).toBe("todo");
      expect(items.find((i) => i.id === "fees")?.state).toBe("ok");

      const r = await confirmSettings(db, { actor: system, keys: ["payment.pgHoldMinutes"], reason: "제안값 확정", now });
      expect(r).toMatchObject({ ok: true });
      expect(await getSetting(db, "payment.pgHoldMinutes", now)).toBe(30);
      items = await computeReadiness(db, now);
      expect(items.find((i) => i.id === "payment.pgHoldMinutes")?.state).toBe("ok");
      expect(await confirmSettings(db, { actor: system, keys: ["payment.pgHoldMinutes"], reason: "다시", now })).toMatchObject({ ok: false });
    });

    it("환불률표를 입력하면 완료, 규칙에 어긋나면 저장하지 않는다", async () => {
      const now = new Date("2026-10-07T01:00:00Z");
      const bad = await saveSettingChanges(db, {
        actor: system,
        rawValues: { "payment.refundTiers": JSON.stringify([{ daysBefore: 7, percent: 50 }, { daysBefore: 3, percent: 90 }]) },
        effectiveFrom: now,
        reason: "환불률",
        now,
      });
      expect(bad.ok).toBe(false);
      const good = await saveSettingChanges(db, {
        actor: system,
        rawValues: { "payment.refundTiers": JSON.stringify([{ daysBefore: 3, percent: 50 }, { daysBefore: 7, percent: 100 }]) },
        effectiveFrom: now,
        reason: "환불률",
        now,
      });
      expect(good).toMatchObject({ ok: true });
      expect(await getSetting(db, "payment.refundTiers", now)).toEqual([{ daysBefore: 7, percent: 100 }, { daysBefore: 3, percent: 50 }]);
      expect((await computeReadiness(db, now)).find((i) => i.id === "payment.refundTiers")?.state).toBe("ok");

      // DB(jsonb)가 키 순서를 바꿔 저장해도 같은 값은 "바뀐 값 없음"으로 판단해야 한다
      const same = await saveSettingChanges(db, {
        actor: system,
        rawValues: { "payment.refundTiers": JSON.stringify([{ percent: 100, daysBefore: 7 }, { percent: 50, daysBefore: 3 }]) },
        effectiveFrom: now,
        reason: "같은 값",
        now,
      });
      expect(same).toMatchObject({ ok: false, formError: "바뀐 값이 없습니다." });
    });
  });
});
