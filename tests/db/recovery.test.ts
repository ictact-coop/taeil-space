import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { changeOwnEmail, createAdminAccount, updateAdminAccount } from "@/server/auth/accounts";
import { findGradeByCode } from "@/server/auth/grades";
import { checkResetToken, purgePasswordResets, requestPasswordReset, resetPasswordWithToken, sendLoginIdReminder } from "@/server/auth/recovery";
import { authenticatePassword, createSession } from "@/server/auth/service";
import { adminPasswordResets, adminSessions, adminUsers, auditLogs, notificationLogs } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

const PASSWORD = "test-password-123";
const NEW_PASSWORD = "brand-new-pass-2026";

describe.skipIf(!hasTestDb)("관리자 아이디 찾기·비밀번호 재설정", () => {
  let db: Db;
  let close: () => Promise<void>;
  let user: Awaited<ReturnType<typeof createTestAdmin>>;
  let email: string;
  let seq = 0;

  const mails = (to: string, event: string) =>
    db
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.recipient, to), eq(notificationLogs.event, event)))
      .orderBy(desc(notificationLogs.id));

  async function requestToken(now = new Date()): Promise<string> {
    expect(await requestPasswordReset(db, { loginId: user.loginId, email }, { ip: "203.0.113.9" }, now)).toEqual({ ok: true });
    const [mail] = await mails(email, "admin.password-reset-link");
    const token = /\/admin\/login\/reset\/([A-Za-z0-9_-]+)/.exec(mail!.body)?.[1];
    expect(token).toBeTruthy();
    return token!;
  }

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    ({ db, close } = await resetTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    seq += 1;
    email = `staff${seq}@taeil.example`;
    user = await createTestAdmin(db, "rental", PASSWORD);
    await db.update(adminUsers).set({ email }).where(eq(adminUsers.id, user.id));
  });

  it("아이디 찾기: 같은 이메일의 사용 중인 계정 아이디를 모두 보내고, 없는 주소도 같은 응답", async () => {
    const other = await createTestAdmin(db, "club");
    const stopped = await createTestAdmin(db, "club");
    await db.update(adminUsers).set({ email }).where(eq(adminUsers.id, other.id));
    await db.update(adminUsers).set({ email, isActive: false }).where(eq(adminUsers.id, stopped.id));

    expect(await sendLoginIdReminder(db, `  ${email.toUpperCase()} `)).toEqual({ ok: true });
    const [mail] = await mails(email, "admin.find-id");
    expect(mail!.body).toContain(user.loginId);
    expect(mail!.body).toContain(other.loginId);
    expect(mail!.body).not.toContain(stopped.loginId);
    expect(mail!.body).toContain("/admin/login");
    expect(mail!.body).not.toContain(PASSWORD);

    expect(await sendLoginIdReminder(db, "nobody@taeil.example")).toEqual({ ok: true });
    expect(await mails("nobody@taeil.example", "admin.find-id")).toHaveLength(0);
    expect(await sendLoginIdReminder(db, "not-an-email")).toMatchObject({ ok: false });
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "admin.find-id"), eq(auditLogs.targetId, user.id)));
    expect(logs).toHaveLength(1);
  });

  it("재설정 요청: 아이디와 이메일이 모두 맞아야 링크를 보내고, 틀려도 같은 응답", async () => {
    expect(await requestPasswordReset(db, { loginId: user.loginId, email: "wrong@taeil.example" })).toEqual({ ok: true });
    expect(await requestPasswordReset(db, { loginId: "no-such-user", email })).toEqual({ ok: true });
    expect(await mails(email, "admin.password-reset-link")).toHaveLength(0);
    expect(await mails("wrong@taeil.example", "admin.password-reset-link")).toHaveLength(0);

    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, user.id));
    expect(await requestPasswordReset(db, { loginId: user.loginId, email })).toEqual({ ok: true });
    expect(await mails(email, "admin.password-reset-link")).toHaveLength(0);

    await db.update(adminUsers).set({ isActive: true }).where(eq(adminUsers.id, user.id));
    const token = await requestToken();
    const [row] = await db.select().from(adminPasswordResets).where(eq(adminPasswordResets.adminUserId, user.id));
    expect(row!.tokenHash).not.toContain(token); // 토큰 원문은 저장하지 않는다
    expect(row!.requestIp).toBe("203.0.113.9");
    expect(await checkResetToken(db, token)).toMatchObject({ ok: true, loginId: user.loginId });
  });

  it("새 비밀번호 설정: 잠금 해제, 세션 종료, 링크는 한 번만", async () => {
    await db.update(adminUsers).set({ failedLoginCount: 7, lockedUntil: new Date(Date.now() + 3600_000) }).where(eq(adminUsers.id, user.id));
    await createSession(db, user.id, true);
    const token = await requestToken();

    expect(await resetPasswordWithToken(db, { token, next: "short", confirm: "short" })).toMatchObject({ ok: false, fieldErrors: { next: expect.any(String) } });
    expect(await resetPasswordWithToken(db, { token, next: NEW_PASSWORD, confirm: "different-pass-2026" })).toMatchObject({ ok: false, fieldErrors: { confirm: expect.any(String) } });

    expect(await resetPasswordWithToken(db, { token, next: NEW_PASSWORD, confirm: NEW_PASSWORD }, { ip: "203.0.113.9" })).toEqual({ ok: true, loginId: user.loginId });
    const [after] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
    expect(after!.failedLoginCount).toBe(0);
    expect(after!.lockedUntil).toBeNull();
    expect(after!.totpEnabledAt).toEqual(user.totpEnabledAt); // OTP는 그대로
    expect(await db.select().from(adminSessions).where(eq(adminSessions.adminUserId, user.id))).toHaveLength(0);
    expect((await authenticatePassword(db, user.loginId, NEW_PASSWORD, {})).ok).toBe(true);
    expect((await authenticatePassword(db, user.loginId, PASSWORD, {})).ok).toBe(false);

    expect(await resetPasswordWithToken(db, { token, next: "another-pass-2026", confirm: "another-pass-2026" })).toMatchObject({ ok: false, error: expect.stringContaining("이미 사용") });
    expect(await checkResetToken(db, token)).toMatchObject({ ok: false });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "admin.password-reset-link"), eq(auditLogs.targetId, user.id)))).toHaveLength(1);
  });

  it("한 링크를 쓰면 같은 계정의 다른 링크도 무효, 30분이 지나면 만료", async () => {
    const t0 = new Date(Date.now() - 10 * 60_000);
    const older = await requestToken(t0);
    const newer = await requestToken();
    expect(await resetPasswordWithToken(db, { token: newer, next: NEW_PASSWORD, confirm: NEW_PASSWORD })).toMatchObject({ ok: true });
    expect(await checkResetToken(db, older)).toMatchObject({ ok: false });

    const stale = await requestToken(new Date(Date.now() - 31 * 60_000));
    expect(await checkResetToken(db, stale)).toMatchObject({ ok: false, error: expect.stringContaining("30분") });
    expect(await resetPasswordWithToken(db, { token: stale, next: NEW_PASSWORD, confirm: NEW_PASSWORD })).toMatchObject({ ok: false });
  });

  it("잘못된 형식·없는 토큰, 중지된 계정의 토큰은 거부", async () => {
    expect(await checkResetToken(db, "../../etc")).toMatchObject({ ok: false });
    expect(await checkResetToken(db, "a".repeat(43))).toMatchObject({ ok: false });
    const token = await requestToken();
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, user.id));
    expect(await resetPasswordWithToken(db, { token, next: NEW_PASSWORD, confirm: NEW_PASSWORD })).toMatchObject({ ok: false });
  });

  it("재설정 메일은 계정당 한 시간에 3통까지(그 뒤는 조용히 건너뜀)", async () => {
    for (let i = 0; i < 5; i += 1) expect(await requestPasswordReset(db, { loginId: user.loginId, email })).toEqual({ ok: true });
    expect(await mails(email, "admin.password-reset-link")).toHaveLength(3);
  });

  it("이메일을 바꾸면 이전에 보낸 링크는 무효 (계정 관리·내 계정)", async () => {
    const sys = await createTestAdmin(db, "system");
    const t1 = await requestToken();
    const r = await updateAdminAccount(db, { actor: sys.actor, userId: user.id, raw: { name: user.name, gradeId: user.gradeId, email: `moved${seq}@taeil.example` } });
    expect(r).toEqual({ ok: true });
    expect(await checkResetToken(db, t1)).toMatchObject({ ok: false });

    email = `moved${seq}@taeil.example`;
    const t2 = await requestToken();
    expect(await changeOwnEmail(db, { userId: user.id, current: "wrong-password-1", email: "x@taeil.example" })).toMatchObject({ ok: false, fieldErrors: { current: expect.any(String) } });
    expect(await changeOwnEmail(db, { userId: user.id, current: PASSWORD, email: "bad" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
    expect(await checkResetToken(db, t2)).toMatchObject({ ok: true });
    expect(await changeOwnEmail(db, { userId: user.id, current: PASSWORD, email: " Me@Taeil.Example " })).toEqual({ ok: true });
    expect(await checkResetToken(db, t2)).toMatchObject({ ok: false });
    const [after] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
    expect(after!.email).toBe("me@taeil.example");
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "admin.email-changed"), eq(auditLogs.targetId, user.id)));
    expect(log!.after).toEqual({ email: "me@taeil.example" });

    expect(await changeOwnEmail(db, { userId: user.id, current: PASSWORD, email: "" })).toEqual({ ok: true });
    const [cleared] = await db.select().from(adminUsers).where(eq(adminUsers.id, user.id));
    expect(cleared!.email).toBeNull();
  });

  it("계정 생성 때 이메일(선택)을 소문자로 저장하고 형식을 검사한다", async () => {
    const sys = await createTestAdmin(db, "system");
    const staffGrade = (await findGradeByCode(db, "staff"))!.id;
    const made = await createAdminAccount(db, { actor: sys.actor, raw: { loginId: `mail-${seq}`, name: "메일", gradeId: staffGrade, email: " New@Taeil.Example " } });
    expect(made.ok).toBe(true);
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.loginId, `mail-${seq}`));
    expect(row!.email).toBe("new@taeil.example");
    expect(await createAdminAccount(db, { actor: sys.actor, raw: { loginId: `mail2-${seq}`, name: "메일", gradeId: staffGrade, email: "nope" } })).toMatchObject({
      ok: false,
      fieldErrors: { email: expect.any(String) },
    });
    const blank = await createAdminAccount(db, { actor: sys.actor, raw: { loginId: `mail3-${seq}`, name: "메일", gradeId: staffGrade, email: "" } });
    expect(blank.ok).toBe(true);
  });

  it("7일 지난 재설정 기록은 정리", async () => {
    await requestToken(new Date(Date.now() - 8 * 24 * 3600_000));
    expect(await purgePasswordResets(db)).toBeGreaterThanOrEqual(1);
  });
});
