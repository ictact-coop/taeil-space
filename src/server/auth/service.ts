import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import { adminSessions, adminUsers } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { decryptSecret, encryptSecret } from "./encryption";
import { burnPasswordCheck, verifyPassword } from "./password";
import { createTotpSecret, verifyTotp } from "./totp";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
/** 세션 최대 유지 시간 */
export const SESSION_ABSOLUTE_HOURS = 12;
/** 이 시간 동안 아무 요청이 없으면 세션 만료 */
export const SESSION_IDLE_MINUTES = 120;

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function recordFailure(db: DbOrTx, user: AdminUser, now: Date, meta: RequestMeta, action: string) {
  const failed = user.failedLoginCount + 1;
  const lock = failed >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil;
  await db
    .update(adminUsers)
    .set({ failedLoginCount: lock ? 0 : failed, lockedUntil })
    .where(eq(adminUsers.id, user.id));
  await writeAudit(db, {
    actorType: "admin",
    actorId: user.id,
    action: lock ? "auth.locked" : action,
    targetType: "admin_user",
    targetId: user.id,
    after: lock ? { lockedUntil: lockedUntil?.toISOString() } : { failedLoginCount: failed },
    ip: meta.ip,
  });
}

function isLocked(user: AdminUser, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
}

export type PasswordResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

/** 1단계: 아이디·비밀번호 확인. 5회 실패하면 15분 잠근다. */
export async function authenticatePassword(
  db: Db,
  loginId: string,
  password: string,
  meta: RequestMeta = {},
  now: Date = new Date(),
): Promise<PasswordResult> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.loginId, loginId.trim())).limit(1);
  if (!user || !user.isActive) {
    await burnPasswordCheck(password);
    return { ok: false, reason: "invalid" };
  }
  if (isLocked(user, now)) return { ok: false, reason: "locked", lockedUntil: user.lockedUntil! };
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordFailure(db, user, now, meta, "auth.password_failed");
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, user };
}

export async function createSession(
  db: DbOrTx,
  userId: string,
  mfaVerified: boolean,
  meta: RequestMeta = {},
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_HOURS * 3600_000);
  await db.insert(adminSessions).values({
    id: hashToken(token),
    adminUserId: userId,
    mfaVerified,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function validateSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ session: AdminSession; user: AdminUser } | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ session: adminSessions, user: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(eq(adminSessions.id, id))
    .limit(1);
  if (!row) return null;
  const idleLimit = row.session.lastSeenAt.getTime() + SESSION_IDLE_MINUTES * 60_000;
  if (row.session.expiresAt.getTime() <= now.getTime() || idleLimit <= now.getTime() || !row.user.isActive) {
    await db.delete(adminSessions).where(eq(adminSessions.id, id));
    return null;
  }
  // 요청마다 쓰지 않도록 1분 이상 지났을 때만 갱신
  if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
    await db.update(adminSessions).set({ lastSeenAt: now }).where(eq(adminSessions.id, id));
  }
  return row;
}

export async function deleteSession(db: DbOrTx, token: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.id, hashToken(token)));
}

export async function purgeExpiredSessions(db: DbOrTx, now: Date = new Date()): Promise<void> {
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
}

/** 2단계 인증 등록 시작: 새 비밀키를 만들어 확인 전 상태로 저장한다. */
export async function startTotpEnrollment(db: DbOrTx, userId: string): Promise<string> {
  const secret = createTotpSecret();
  await db
    .update(adminUsers)
    .set({ totpPendingSecretEnc: encryptSecret(secret) })
    .where(and(eq(adminUsers.id, userId)));
  return secret;
}

export function readPendingTotpSecret(user: AdminUser): string | null {
  return user.totpPendingSecretEnc ? decryptSecret(user.totpPendingSecretEnc) : null;
}

export type TotpResult = { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "locked"; lockedUntil: Date };

/** 2단계 인증 등록 확인 */
export async function confirmTotpEnrollment(
  db: Db,
  userId: string,
  code: string,
  meta: RequestMeta = {},
  now: Date = new Date(),
): Promise<TotpResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, userId)).for("update");
    if (!user?.totpPendingSecretEnc) return { ok: false, reason: "invalid" } as const;
    if (isLocked(user, now)) return { ok: false, reason: "locked", lockedUntil: user.lockedUntil! } as const;
    const result = await verifyTotp(decryptSecret(user.totpPendingSecretEnc), code, null, now);
    if (!result.ok) {
      await recordFailure(tx, user, now, meta, "auth.totp_failed");
      return { ok: false, reason: "invalid" } as const;
    }
    await tx
      .update(adminUsers)
      .set({
        totpSecretEnc: user.totpPendingSecretEnc,
        totpPendingSecretEnc: null,
        totpEnabledAt: now,
        totpLastStep: result.step,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(adminUsers.id, userId));
    await writeAudit(tx, {
      actorType: "admin",
      actorId: userId,
      action: "auth.totp_enrolled",
      targetType: "admin_user",
      targetId: userId,
      ip: meta.ip,
    });
    return { ok: true } as const;
  });
}

/** 로그인 2단계: TOTP 확인 */
export async function verifyUserTotp(
  db: Db,
  userId: string,
  code: string,
  meta: RequestMeta = {},
  now: Date = new Date(),
): Promise<TotpResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, userId)).for("update");
    if (!user?.totpSecretEnc || !user.isActive) return { ok: false, reason: "invalid" } as const;
    if (isLocked(user, now)) return { ok: false, reason: "locked", lockedUntil: user.lockedUntil! } as const;
    const result = await verifyTotp(decryptSecret(user.totpSecretEnc), code, user.totpLastStep, now);
    if (!result.ok) {
      await recordFailure(tx, user, now, meta, "auth.totp_failed");
      return { ok: false, reason: "invalid" } as const;
    }
    await tx
      .update(adminUsers)
      .set({ totpLastStep: result.step, failedLoginCount: 0, lockedUntil: null })
      .where(eq(adminUsers.id, userId));
    await writeAudit(tx, {
      actorType: "admin",
      actorId: userId,
      action: "auth.login",
      targetType: "admin_user",
      targetId: userId,
      ip: meta.ip,
    });
    return { ok: true } as const;
  });
}
