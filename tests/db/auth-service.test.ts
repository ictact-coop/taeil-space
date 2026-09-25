import { eq } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authenticatePassword,
  confirmTotpEnrollment,
  createSession,
  MAX_FAILED_ATTEMPTS,
  readPendingTotpSecret,
  SESSION_IDLE_MINUTES,
  startTotpEnrollment,
  validateSession,
  verifyUserTotp,
} from "@/server/auth/service";
import { adminSessions, adminUsers, auditLogs } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("관리자 인증", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    ({ db, close } = await resetTestDb());
  });
  afterAll(async () => close?.());

  it("비밀번호가 맞으면 통과, 틀리면 거부", async () => {
    const user = await createTestAdmin(db);
    expect(await authenticatePassword(db, user.loginId, "test-password-123")).toMatchObject({ ok: true });
    expect(await authenticatePassword(db, user.loginId, "wrong")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticatePassword(db, "nobody", "whatever")).toEqual({ ok: false, reason: "invalid" });
  });

  it(`${MAX_FAILED_ATTEMPTS}회 실패하면 잠기고, 잠긴 동안은 맞는 비밀번호도 거부`, async () => {
    const user = await createTestAdmin(db);
    const now = new Date("2026-10-01T00:00:00Z");
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) await authenticatePassword(db, user.loginId, "wrong", {}, now);
    expect(await authenticatePassword(db, user.loginId, "test-password-123", {}, now)).toMatchObject({ ok: false, reason: "locked" });
    const afterLock = new Date(now.getTime() + 16 * 60_000);
    expect(await authenticatePassword(db, user.loginId, "test-password-123", {}, afterLock)).toMatchObject({ ok: true });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.targetId, user.id));
    expect(logs.some((l) => l.action === "auth.locked")).toBe(true);
  });

  it("2단계 인증 등록 → 로그인 확인, 같은 코드 재사용은 거부", async () => {
    const user = await createTestAdmin(db);
    const secret = await startTotpEnrollment(db, user.id);
    const [pending] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
    expect(pending!.totpPendingSecretEnc).not.toContain(secret); // 암호화 저장
    expect(readPendingTotpSecret(pending!)).toBe(secret);

    const now = new Date("2026-10-01T00:00:00Z");
    const epoch = now.getTime() / 1000;
    expect(await confirmTotpEnrollment(db, user.id, "000000", {}, now)).toMatchObject({ ok: false });
    const code = await generate({ secret, epoch });
    expect(await confirmTotpEnrollment(db, user.id, code, {}, now)).toEqual({ ok: true });
    expect(await verifyUserTotp(db, user.id, code, {}, now)).toMatchObject({ ok: false }); // 재사용

    const later = new Date(now.getTime() + 60_000);
    const next = await generate({ secret, epoch: later.getTime() / 1000 });
    expect(await verifyUserTotp(db, user.id, next, {}, later)).toEqual({ ok: true });
  });

  it("세션: 유효 기간과 유휴 시간이 지나면 만료되고 삭제된다", async () => {
    const user = await createTestAdmin(db);
    const now = new Date("2026-10-01T00:00:00Z");
    const { token } = await createSession(db, user.id, true, {}, now);
    const [stored] = await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, user.id));
    expect(stored!.id).not.toBe(token); // 원문 토큰은 저장하지 않음

    expect(await validateSession(db, token, new Date(now.getTime() + 30 * 60_000))).not.toBeNull();
    const idle = new Date(now.getTime() + (30 + SESSION_IDLE_MINUTES + 1) * 60_000);
    expect(await validateSession(db, token, idle)).toBeNull();
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, user.id))).toHaveLength(0);
  });

  it("비활성 계정의 세션은 거부한다", async () => {
    const user = await createTestAdmin(db);
    const { token } = await createSession(db, user.id, true);
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, user.id));
    expect(await validateSession(db, token)).toBeNull();
  });
});
