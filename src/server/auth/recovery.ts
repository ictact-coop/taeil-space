import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, isNull, lt } from "drizzle-orm";
import { formatKst } from "@/lib/time";
import { writeAudit } from "@/server/audit/log";
import { adminPasswordResets, adminSessions, adminUsers } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { appBaseUrl, enqueueEmail, flushNotifications } from "@/server/notifications/queue";
import { hashPassword, validatePasswordPolicy } from "./password";

/**
 * 관리자 아이디 찾기·비밀번호 재설정 (로그인 전).
 * - 계정이 있는지 화면에 드러나지 않도록, 요청 결과는 항상 같은 안내를 보여 주고 메일로만 알린다.
 * - 비밀번호 재설정은 아이디와 등록 이메일이 모두 맞아야 링크를 보낸다. 링크는 30분, 한 번만 쓸 수 있다.
 * - 재설정해도 2단계 인증(OTP)은 그대로 필요하다. OTP 기기를 잃어버렸으면 계정 관리 담당자가 초기화한다.
 */
export const RESET_TTL_MINUTES = 30;
const MAX_RESET_MAILS_PER_HOUR = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RECOVERY_SENT_NOTICE =
  "입력한 정보와 일치하는 계정이 있으면 등록된 이메일로 안내를 보냈습니다. 몇 분 안에 메일이 오지 않으면 스팸함을 확인하거나 계정 관리 담당자에게 문의하세요.";

export const normalizeAdminEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => EMAIL_RE.test(email);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

type Meta = { ip?: string | null };

/** 응답 시간으로 계정 유무가 드러나지 않도록 메일은 기다리지 않고 보낸다(실패하면 작업 프로세스가 1분 안에 다시 보낸다). */
function sendSoon(db: Db) {
  void flushNotifications(db).catch(() => undefined);
}
export type RecoveryRequestResult = { ok: true } | { ok: false; error: string };

const footer = "\n\n요청하지 않았다면 이 메일을 무시하세요. 계정에는 아무 변화가 없습니다.\n전태일기념관 대관관리";

/** 아이디 찾기: 이 이메일로 등록된 사용 중인 계정의 아이디를 메일로 보낸다. */
export async function sendLoginIdReminder(db: Db, rawEmail: string, meta: Meta = {}, now: Date = new Date()): Promise<RecoveryRequestResult> {
  const email = normalizeAdminEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "이메일 형식이 아닙니다." };
  const users = await db
    .select({ id: adminUsers.id, loginId: adminUsers.loginId, name: adminUsers.name })
    .from(adminUsers)
    .where(and(eq(adminUsers.email, email), eq(adminUsers.isActive, true)))
    .orderBy(asc(adminUsers.loginId));
  if (users.length > 0) {
    await db.transaction(async (tx) => {
      await enqueueEmail(
        tx,
        "admin.find-id",
        email,
        "[전태일기념관 대관관리] 관리자 아이디 안내",
        `이 이메일로 등록된 관리자 아이디입니다.\n\n${users.map((u) => `- ${u.loginId} (${u.name})`).join("\n")}\n\n로그인: ${appBaseUrl()}/admin/login\n비밀번호가 기억나지 않으면 로그인 화면의 '비밀번호 재설정'을 이용하세요.${footer}`,
      );
      await writeAudit(
        tx,
        users.map((u) => ({ actorType: "system" as const, action: "admin.find-id", targetType: "admin_user", targetId: u.id, ip: meta.ip ?? null, reason: `요청 시각 ${formatKst(now)}` })),
      );
    });
    sendSoon(db);
  }
  return { ok: true };
}

/** 비밀번호 재설정 요청: 아이디와 등록 이메일이 맞으면 재설정 링크를 보낸다. */
export async function requestPasswordReset(
  db: Db,
  raw: { loginId: string; email: string },
  meta: Meta = {},
  now: Date = new Date(),
): Promise<RecoveryRequestResult> {
  const loginId = raw.loginId.trim().toLowerCase();
  const email = normalizeAdminEmail(raw.email);
  if (!loginId) return { ok: false, error: "아이디를 입력하세요." };
  if (!isValidEmail(email)) return { ok: false, error: "이메일 형식이 아닙니다." };
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.loginId, loginId));
  if (!user || !user.isActive || user.email !== email) return { ok: true }; // 일치 여부를 드러내지 않는다
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(adminPasswordResets)
    .where(and(eq(adminPasswordResets.adminUserId, user.id), gt(adminPasswordResets.createdAt, new Date(now.getTime() - 3600_000))));
  if (n >= MAX_RESET_MAILS_PER_HOUR) return { ok: true }; // 메일 폭탄 방지: 조용히 건너뛴다

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  await db.transaction(async (tx) => {
    await tx.insert(adminPasswordResets).values({ adminUserId: user.id, tokenHash: sha(token), expiresAt, requestIp: meta.ip ?? null, createdAt: now });
    await enqueueEmail(
      tx,
      "admin.password-reset-link",
      email,
      "[전태일기념관 대관관리] 비밀번호 재설정 링크",
      `${user.name}님(${user.loginId}), 비밀번호 재설정 요청을 받았습니다.\n\n아래 링크에서 새 비밀번호를 정하세요. 링크는 ${formatKst(expiresAt)}까지(${RESET_TTL_MINUTES}분), 한 번만 쓸 수 있습니다.\n${appBaseUrl()}/admin/login/reset/${token}\n\n비밀번호를 바꾼 뒤 로그인할 때도 OTP 앱의 인증 코드가 필요합니다.${footer}`,
    );
    await writeAudit(tx, { actorType: "system", action: "admin.password-reset-requested", targetType: "admin_user", targetId: user.id, ip: meta.ip ?? null });
  });
  sendSoon(db);
  return { ok: true };
}

type ResetLookup = { ok: true; resetId: string; userId: string; loginId: string; name: string } | { ok: false; error: string };

const INVALID_LINK = "재설정 링크가 올바르지 않거나 이미 사용되었습니다. 비밀번호 재설정을 다시 요청하세요.";

async function lookupReset(db: Pick<Db, "select">, token: string, now: Date, lock = false): Promise<ResetLookup> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { ok: false, error: INVALID_LINK };
  const q = db
    .select({ reset: adminPasswordResets, user: adminUsers })
    .from(adminPasswordResets)
    .innerJoin(adminUsers, eq(adminUsers.id, adminPasswordResets.adminUserId))
    .where(eq(adminPasswordResets.tokenHash, sha(token)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row || row.reset.usedAt || !row.user.isActive) return { ok: false, error: INVALID_LINK };
  if (row.reset.expiresAt <= now) return { ok: false, error: `재설정 링크의 유효시간(${RESET_TTL_MINUTES}분)이 지났습니다. 비밀번호 재설정을 다시 요청하세요.` };
  return { ok: true, resetId: row.reset.id, userId: row.user.id, loginId: row.user.loginId, name: row.user.name };
}

/** 재설정 화면을 열 때 링크가 아직 쓸 수 있는지 확인한다. */
export async function checkResetToken(db: Db, token: string, now: Date = new Date()) {
  return lookupReset(db, token, now);
}

export type ResetResult = { ok: true; loginId: string } | { ok: false; error?: string; fieldErrors?: Partial<Record<"next" | "confirm", string>> };

/** 새 비밀번호 설정: 잠금을 풀고 기존 로그인 세션을 모두 끊으며, 이 계정의 다른 재설정 링크도 못 쓰게 한다. */
export async function resetPasswordWithToken(
  db: Db,
  params: { token: string; next: string; confirm: string },
  meta: Meta = {},
  now: Date = new Date(),
): Promise<ResetResult> {
  const policyError = validatePasswordPolicy(params.next);
  if (policyError) return { ok: false, fieldErrors: { next: policyError } };
  if (params.next !== params.confirm) return { ok: false, fieldErrors: { confirm: "새 비밀번호가 서로 다릅니다." } };
  const passwordHash = await hashPassword(params.next);
  return db.transaction(async (tx): Promise<ResetResult> => {
    const found = await lookupReset(tx, params.token, now, true);
    if (!found.ok) return { ok: false, error: found.error };
    await tx.update(adminUsers).set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: now }).where(eq(adminUsers.id, found.userId));
    await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, found.userId));
    await tx
      .update(adminPasswordResets)
      .set({ usedAt: now })
      .where(and(eq(adminPasswordResets.adminUserId, found.userId), isNull(adminPasswordResets.usedAt)));
    await writeAudit(tx, { actorType: "system", action: "admin.password-reset-link", targetType: "admin_user", targetId: found.userId, ip: meta.ip ?? null, reason: "이메일 재설정 링크" });
    return { ok: true, loginId: found.loginId };
  });
}

/** 7일 지난 재설정 기록 정리 (작업 프로세스) */
export async function purgePasswordResets(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(adminPasswordResets)
    .where(lt(adminPasswordResets.createdAt, new Date(now.getTime() - 7 * 24 * 3600_000)))
    .returning({ id: adminPasswordResets.id });
  return rows.length;
}
