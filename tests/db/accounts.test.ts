import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAccountAction, changeOwnPassword, createAdminAccount, listAdminAccounts, updateAdminAccount } from "@/server/auth/accounts";
import { authenticatePassword, createSession } from "@/server/auth/service";
import { PermissionError } from "@/server/auth/permissions";
import { adminSessions, adminUsers, auditLogs } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("관리자 계정 관리", () => {
  let db: Db;
  let close: () => Promise<void>;
  let sys: Awaited<ReturnType<typeof createTestAdmin>>;
  const actor = () => ({ id: sys.id, role: sys.role, ip: "127.0.0.1" });

  beforeAll(async () => ({ db, close } = await resetTestDb()));
  afterAll(async () => close?.());
  beforeEach(async () => {
    await db.delete(adminSessions);
    await db.update(adminUsers).set({ isActive: false }); // 이전 테스트의 계정은 중지 상태로 둔다
    sys = await createTestAdmin(db, "system");
  });

  it("계정 생성: 임시 비밀번호로 로그인되고, 아이디 중복·형식 오류를 알려 준다", async () => {
    const r = await createAdminAccount(db, { actor: actor(), raw: { loginId: " Kim.Rental ", name: "김담당", role: "rental" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.loginId).toBe("kim.rental");
    expect(r.value.temporaryPassword).toMatch(/.{12,}/);
    expect((await authenticatePassword(db, "kim.rental", r.value.temporaryPassword!, {})).ok).toBe(true);

    expect(await createAdminAccount(db, { actor: actor(), raw: { loginId: "kim.rental", name: "또", role: "rental" } })).toMatchObject({ ok: false, fieldErrors: { loginId: expect.stringContaining("이미") } });
    expect(await createAdminAccount(db, { actor: actor(), raw: { loginId: "a", name: "", role: "boss" } })).toMatchObject({ ok: false, fieldErrors: { loginId: expect.any(String), name: expect.any(String), role: expect.any(String) } });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "admin.created"));
    expect(logs.some((l) => l.actorId === sys.id)).toBe(true);
  });

  it("시스템 관리자가 아니면 거부", async () => {
    const rental = await createTestAdmin(db, "rental");
    await expect(createAdminAccount(db, { actor: { id: rental.id, role: "rental" }, raw: { loginId: "x-user", name: "x", role: "system" } })).rejects.toBeInstanceOf(PermissionError);
    await expect(applyAccountAction(db, { actor: { id: rental.id, role: "rental" }, userId: sys.id, action: "deactivate" })).rejects.toBeInstanceOf(PermissionError);
  });

  it("역할 변경은 세션을 끊고, 자기 역할·마지막 시스템 관리자 강등은 막는다", async () => {
    const other = await createTestAdmin(db, "rental");
    await createSession(db, other.id, true, {});
    expect(await updateAdminAccount(db, { actor: actor(), userId: other.id, raw: { name: "새 이름", role: "accounting" } })).toEqual({ ok: true });
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, other.id));
    expect(row).toMatchObject({ name: "새 이름", role: "accounting" });
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, other.id))).toHaveLength(0);

    expect(await updateAdminAccount(db, { actor: actor(), userId: sys.id, raw: { name: "나", role: "rental" } })).toMatchObject({ ok: false, fieldErrors: { role: expect.stringContaining("자기") } });
    // 서버 명령(actor 없음)으로도 마지막 시스템 관리자는 중지할 수 없다
    expect(await applyAccountAction(db, { actor: null, userId: sys.id, action: "deactivate" })).toMatchObject({ ok: false, formError: expect.stringContaining("한 명은") });
    // 이름만 바꾸는 것은 자기 계정도 된다
    expect(await updateAdminAccount(db, { actor: actor(), userId: sys.id, raw: { name: "시스템 담당", role: "system" } })).toEqual({ ok: true });
  });

  it("초기화·중지·재개, 자기 계정은 조치 불가", async () => {
    const other = await createTestAdmin(db, "rental");
    await db.update(adminUsers).set({ totpEnabledAt: new Date(), totpSecretEnc: "x", failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) }).where(eq(adminUsers.id, other.id));
    await createSession(db, other.id, true, {});

    expect((await applyAccountAction(db, { actor: actor(), userId: other.id, action: "reset-2fa" })).ok).toBe(true);
    let [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, other.id));
    expect(row).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, lockedUntil: null, failedLoginCount: 0 });
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, other.id))).toHaveLength(0);

    const pw = await applyAccountAction(db, { actor: actor(), userId: other.id, action: "reset-password" });
    expect(pw.ok && pw.value.temporaryPassword).toBeTruthy();
    if (pw.ok) expect((await authenticatePassword(db, other.loginId, pw.value.temporaryPassword!, {})).ok).toBe(true);

    expect((await applyAccountAction(db, { actor: actor(), userId: other.id, action: "deactivate" })).ok).toBe(true);
    expect(await authenticatePassword(db, other.loginId, pw.ok ? pw.value.temporaryPassword! : "", {})).toMatchObject({ ok: false });
    expect((await applyAccountAction(db, { actor: actor(), userId: other.id, action: "activate" })).ok).toBe(true);
    [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, other.id));
    expect(row!.isActive).toBe(true);

    expect(await applyAccountAction(db, { actor: actor(), userId: sys.id, action: "reset-2fa" })).toMatchObject({ ok: false, formError: expect.stringContaining("자기") });
    const actions = (await db.select().from(auditLogs).where(eq(auditLogs.targetId, other.id))).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.reset-2fa", "admin.reset-password", "admin.deactivate", "admin.activate"]));
  });

  it("다른 시스템 관리자가 있으면 시스템 관리자를 중지할 수 있다", async () => {
    const sys2 = await createTestAdmin(db, "system");
    expect((await applyAccountAction(db, { actor: actor(), userId: sys2.id, action: "deactivate" })).ok).toBe(true);
    const list = await listAdminAccounts(db);
    expect(list[0]!.isActive).toBe(true); // 사용 중인 계정이 먼저
  });

  it("내 비밀번호 변경: 현재 비밀번호 확인, 정책, 다른 세션만 끊기", async () => {
    const keep = await createSession(db, sys.id, true, {});
    await createSession(db, sys.id, true, {});
    const [current] = await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, sys.id)).orderBy(adminSessions.createdAt).limit(1);
    const base = { userId: sys.id, currentSessionId: current!.id };
    expect(await changeOwnPassword(db, { ...base, current: "wrong-password-1", next: "new-password-2026", confirm: "new-password-2026" })).toMatchObject({ ok: false, fieldErrors: { current: expect.any(String) } });
    expect(await changeOwnPassword(db, { ...base, current: "test-password-123", next: "short1", confirm: "short1" })).toMatchObject({ ok: false, fieldErrors: { next: expect.any(String) } });
    expect(await changeOwnPassword(db, { ...base, current: "test-password-123", next: "new-password-2026", confirm: "different-2026" })).toMatchObject({ ok: false, fieldErrors: { confirm: expect.any(String) } });
    expect(await changeOwnPassword(db, { ...base, current: "test-password-123", next: "new-password-2026", confirm: "new-password-2026" })).toEqual({ ok: true });
    expect((await authenticatePassword(db, sys.loginId, "new-password-2026", {})).ok).toBe(true);
    const left = await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, sys.id));
    expect(left.map((s) => s.id)).toEqual([current!.id]);
    expect(keep.token).toBeTruthy();
  });
});
