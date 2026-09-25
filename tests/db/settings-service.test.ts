import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, policyValues } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import {
  cancelScheduledSetting,
  getSetting,
  getSettings,
  getSettingsSnapshot,
  getSettingHistory,
  revertSetting,
  saveSettingChanges,
  type SettingsActor,
} from "@/server/settings/service";
import { sql } from "drizzle-orm";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("설정 서비스", () => {
  let db: Db;
  let close: () => Promise<void>;
  let system: SettingsActor;
  let rental: SettingsActor;

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    system = { id: (await createTestAdmin(db, "system")).id, role: "system" };
    rental = { id: (await createTestAdmin(db, "rental")).id, role: "rental" };
  });
  afterAll(async () => close?.());

  beforeEach(async () => {
    // 추가 전용 트리거를 잠시 끄고 테스트 사이에 비운다(테스트 DB 전용).
    await db.execute(sql`alter table policy_values disable trigger user`);
    await db.execute(sql`delete from policy_values`);
    await db.execute(sql`alter table policy_values enable trigger user`);
  });

  const now = new Date("2026-10-06T01:00:00Z");

  it("저장하면 바뀐 값이 조회되고, 감사 로그에 전후 값과 사유가 남는다", async () => {
    const result = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.pgHoldMinutes": "45", "payment.bankTransferHoldHours": "24" },
      effectiveFrom: now,
      reason: "PG사 권고에 맞춤",
      now,
    });
    expect(result).toEqual({ ok: true, savedKeys: ["payment.pgHoldMinutes"] }); // 바뀌지 않은 항목은 저장하지 않음
    expect(await getSetting(db, "payment.pgHoldMinutes", now)).toBe(45);

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, "payment.pgHoldMinutes"));
    expect(log).toMatchObject({
      action: "setting.change",
      actorId: system.id,
      reason: "PG사 권고에 맞춤",
      before: { value: 30, source: "default" },
    });
    expect(log?.after).toMatchObject({ value: 45 });
  });

  it("사유가 없으면 저장하지 않는다", async () => {
    const result = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.pgHoldMinutes": "45" },
      effectiveFrom: now,
      reason: " ",
      now,
    });
    expect(result).toMatchObject({ ok: false, formError: "변경 사유를 입력하세요." });
  });

  it("허용 범위를 벗어난 값은 항목별 오류를 돌려주고 아무것도 저장하지 않는다", async () => {
    const result = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.pgHoldMinutes": "1", "payment.withdrawRefundPercent": "90" },
      effectiveFrom: now,
      reason: "테스트",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["payment.pgHoldMinutes"]).toContain("5분 이상");
    expect(await db.select().from(policyValues)).toHaveLength(0);
  });

  it("여러 설정을 함께 보는 검증을 통과해야 저장된다", async () => {
    const result = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.method": "bankTransfer" },
      effectiveFrom: now,
      reason: "PG 계약 전 계좌이체로 운영",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["payment.bankAccountInfo"]).toBeDefined();

    const ok = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.method": "bankTransfer", "payment.bankAccountInfo": "○○은행 000-000000-00 전태일재단" },
      effectiveFrom: now,
      reason: "PG 계약 전 계좌이체로 운영",
      now,
    });
    expect(ok).toMatchObject({ ok: true });
  });

  it("권한이 없는 역할은 수정할 수 없다", async () => {
    const result = await saveSettingChanges(db, {
      actor: rental,
      rawValues: { "payment.pgHoldMinutes": "45" },
      effectiveFrom: now,
      reason: "테스트",
      now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors["payment.pgHoldMinutes"]).toContain("권한");
  });

  it("과거 시각으로는 적용할 수 없다", async () => {
    const result = await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.pgHoldMinutes": "45" },
      effectiveFrom: new Date(now.getTime() - 60 * 60_000),
      reason: "테스트",
      now,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("예약한 변경은 적용 시각부터 적용되고, 취소하면 이전 값이 유지된다", async () => {
    const later = new Date("2026-11-01T00:00:00Z");
    await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.withdrawRefundPercent": "90" },
      effectiveFrom: later,
      reason: "11월부터 수수료 공제",
      now,
    });
    expect(await getSetting(db, "payment.withdrawRefundPercent", now)).toBe(100);
    expect(await getSetting(db, "payment.withdrawRefundPercent", later)).toBe(90);

    const [scheduled] = await getSettingHistory(db, "payment.withdrawRefundPercent");
    const cancel = await cancelScheduledSetting(db, {
      actor: system,
      policyValueId: scheduled!.id,
      reason: "결정 보류",
      now,
    });
    expect(cancel).toMatchObject({ ok: true });
    expect(await getSetting(db, "payment.withdrawRefundPercent", later)).toBe(100);

    // 한 번 취소한 예약은 다시 취소할 수 없다
    const again = await cancelScheduledSetting(db, { actor: system, policyValueId: scheduled!.id, reason: "다시", now });
    expect(again).toMatchObject({ ok: false });
  });

  it("이력의 이전 버전으로 되돌리면 새 행이 추가된다", async () => {
    await saveSettingChanges(db, { actor: system, rawValues: { "application.revisionDeadlineDays": "5" }, effectiveFrom: now, reason: "1차", now });
    const t2 = new Date(now.getTime() + 60_000);
    await saveSettingChanges(db, { actor: system, rawValues: { "application.revisionDeadlineDays": "7" }, effectiveFrom: t2, reason: "2차", now: t2 });
    const history = await getSettingHistory(db, "application.revisionDeadlineDays");
    const first = history.find((h) => h.reason === "1차")!;

    const t3 = new Date(now.getTime() + 120_000);
    expect(await revertSetting(db, { actor: system, policyValueId: first.id, reason: "원복", now: t3 })).toMatchObject({ ok: true });
    expect(await getSetting(db, "application.revisionDeadlineDays", t3)).toBe(5);
    expect(await getSettingHistory(db, "application.revisionDeadlineDays")).toHaveLength(3);
  });

  it("스냅샷에는 값과 적용된 버전 ID가 담긴다", async () => {
    await saveSettingChanges(db, { actor: system, rawValues: { "payment.withdrawRefundPercent": "80" }, effectiveFrom: now, reason: "테스트", now });
    const snapshot = await getSettingsSnapshot(db, now);
    expect(snapshot.values["payment.withdrawRefundPercent"]).toBe(80);
    expect(snapshot.versions["payment.withdrawRefundPercent"]).toEqual(expect.any(Number));
    expect(snapshot.versions["payment.pgHoldMinutes"]).toBeNull();
    const all = await getSettings(db, now);
    expect(all["payment.pgHoldMinutes"]).toBe(30);
  });

  it("동시에 저장해도 교차 검증을 우회할 수 없다", async () => {
    // 한쪽은 입금 계좌를 비우고, 다른 쪽은 계좌이체로 바꾼다. 둘 다 통과하면 규칙이 깨진다.
    await saveSettingChanges(db, {
      actor: system,
      rawValues: { "payment.bankAccountInfo": "○○은행 000" },
      effectiveFrom: now,
      reason: "계좌 입력",
      now,
    });
    const [a, b] = await Promise.all([
      saveSettingChanges(db, { actor: system, rawValues: { "payment.bankAccountInfo": "" }, effectiveFrom: now, reason: "계좌 삭제", now }),
      saveSettingChanges(db, { actor: system, rawValues: { "payment.method": "bankTransfer" }, effectiveFrom: now, reason: "방식 변경", now }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});
