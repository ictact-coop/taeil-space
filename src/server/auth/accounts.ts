import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode } from "@/server/actor";
import { adminGrades, adminPasswordResets, adminSessions, adminUsers } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { findGrade } from "./grades";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password";
import { assertPermission, PermissionError } from "./permissions";
import { isValidEmail } from "./recovery";

/**
 * 관리자 계정 관리 ('계정 관리' 권한). 관리 화면과 `pnpm admin:manage`가 함께 쓴다.
 * actor가 null이면 서버 명령(시스템)으로 기록한다.
 * - 최고 관리자 등급을 주거나 빼는 일, 최고 관리자 계정에 대한 조치는 최고 관리자만 한다.
 * - 잠김 방지: 자기 계정의 등급 변경·중지·초기화는 막고, 사용 중인 최고 관리자가 한 명도 남지 않게 되는 변경도 막는다.
 */
const accountSchema = z.object({
  loginId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "아이디는 영문 소문자·숫자·._- 로 3~32자입니다."),
  name: z.string().trim().min(1, "이름을 입력하세요.").max(50, "이름은 50자 이하로 입력하세요."),
  gradeId: z.string().uuid("등급을 고르세요."),
  /** 선택 입력. 비우면 아이디 찾기·비밀번호 재설정 메일을 받을 수 없다. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "이메일이 너무 깁니다.")
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isValidEmail(v), "이메일 형식이 올바르지 않습니다."),
});

export type AccountAction = "reset-2fa" | "reset-password" | "deactivate" | "activate";

type AccountResult<T = undefined> = MutationResult<T>;

const LAST_SUPER = "사용 중인 시스템 최고 관리자가 한 명은 있어야 합니다.";

export function newTemporaryPassword(): string {
  return `${randomBytes(12).toString("base64url")}9a`;
}

export async function listAdminAccounts(db: DbOrTx) {
  return db
    .select({
      id: adminUsers.id,
      loginId: adminUsers.loginId,
      name: adminUsers.name,
      email: adminUsers.email,
      gradeId: adminUsers.gradeId,
      gradeName: adminGrades.name,
      gradeIsSuper: adminGrades.isSuper,
      isActive: adminUsers.isActive,
      totpEnabledAt: adminUsers.totpEnabledAt,
      lockedUntil: adminUsers.lockedUntil,
      createdAt: adminUsers.createdAt,
      /** 가장 최근 활동(남아 있는 세션 기준) */
      lastSeenAt: sql<string | null>`max(${adminSessions.lastSeenAt})`,
    })
    .from(adminUsers)
    .innerJoin(adminGrades, eq(adminGrades.id, adminUsers.gradeId))
    .leftJoin(adminSessions, eq(adminSessions.adminUserId, adminUsers.id))
    .groupBy(adminUsers.id, adminGrades.id)
    .orderBy(desc(adminUsers.isActive), asc(adminGrades.sortOrder), asc(adminUsers.loginId));
}

export type AccountSummary = Awaited<ReturnType<typeof listAdminAccounts>>[number];

const audit = (actor: Actor | null) => ({ actorType: actor ? ("admin" as const) : ("system" as const), actorId: actor?.id ?? null, ip: actor?.ip ?? null });

/** 계정 변경을 직렬화한다(마지막 최고 관리자 검사가 동시 요청에 뚫리지 않게). */
async function lockAccounts(tx: DbOrTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin_accounts'))`);
}

async function otherActiveSuperAdmins(tx: DbOrTx, exceptId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(adminUsers)
    .innerJoin(adminGrades, eq(adminGrades.id, adminUsers.gradeId))
    .where(and(eq(adminGrades.isSuper, true), eq(adminUsers.isActive, true), ne(adminUsers.id, exceptId)));
  return row?.n ?? 0;
}

/** 최고 관리자 등급이 걸린 일은 최고 관리자(또는 서버 명령)만 */
function assertCanTouchSuper(actor: Actor | null) {
  if (actor && !actor.isSuper) throw new PermissionError();
}

async function findAccount(tx: DbOrTx, userId: string) {
  const [row] = await tx
    .select({ user: adminUsers, grade: adminGrades })
    .from(adminUsers)
    .innerJoin(adminGrades, eq(adminGrades.id, adminUsers.gradeId))
    .where(eq(adminUsers.id, userId));
  return row ?? null;
}

export async function createAdminAccount(
  db: Db,
  params: { actor: Actor | null; raw: { loginId: string; name: string; gradeId: string; email?: string }; password?: string },
): Promise<AccountResult<{ id: string; loginId: string; temporaryPassword: string | null }>> {
  if (params.actor) assertPermission(params.actor, "accounts.manage");
  const parsed = accountSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;
  const grade = await findGrade(db, input.gradeId);
  if (!grade) return { ok: false, fieldErrors: { gradeId: "등급을 고르세요." } };
  if (grade.isSuper) assertCanTouchSuper(params.actor);
  const password = params.password ?? newTemporaryPassword();
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { ok: false, formError: policyError };
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminUsers)
        .values({ loginId: input.loginId, name: input.name, email: input.email, gradeId: grade.id, passwordHash: await hashPassword(password) })
        .returning({ id: adminUsers.id });
      await writeAudit(tx, {
        ...audit(params.actor),
        action: "admin.created",
        targetType: "admin_user",
        targetId: row!.id,
        after: { loginId: input.loginId, name: input.name, email: input.email, grade: grade.name },
      });
      return row!;
    });
    return { ok: true, value: { id: created.id, loginId: input.loginId, temporaryPassword: params.password ? null : password } };
  } catch (e) {
    if (pgErrorCode(e) === "23505") return { ok: false, fieldErrors: { loginId: "이미 쓰고 있는 아이디입니다." } };
    throw e;
  }
}

export async function updateAdminAccount(db: Db, params: { actor: Actor; userId: string; raw: { name: string; gradeId: string; email?: string } }): Promise<AccountResult> {
  assertPermission(params.actor, "accounts.manage");
  const parsed = accountSchema.pick({ name: true, gradeId: true, email: true }).safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;
  return db.transaction(async (tx): Promise<AccountResult> => {
    await lockAccounts(tx);
    const row = await findAccount(tx, params.userId);
    if (!row) return { ok: false, formError: "계정을 찾을 수 없습니다." };
    const { user, grade: oldGrade } = row;
    if (oldGrade.isSuper && user.id !== params.actor.id) assertCanTouchSuper(params.actor);
    const newGrade = input.gradeId === oldGrade.id ? oldGrade : await findGrade(tx, input.gradeId);
    if (!newGrade) return { ok: false, fieldErrors: { gradeId: "등급을 고르세요." } };
    if (newGrade.id !== oldGrade.id) {
      if (user.id === params.actor.id) return { ok: false, fieldErrors: { gradeId: "자기 계정의 등급은 바꿀 수 없습니다. 다른 관리자에게 요청하세요." } };
      if (newGrade.isSuper) assertCanTouchSuper(params.actor);
      if (oldGrade.isSuper && user.isActive && (await otherActiveSuperAdmins(tx, user.id)) === 0) return { ok: false, fieldErrors: { gradeId: LAST_SUPER } };
    }
    if (user.name === input.name && user.email === input.email && newGrade.id === oldGrade.id) return { ok: true };
    await tx.update(adminUsers).set({ name: input.name, email: input.email, gradeId: newGrade.id, updatedAt: new Date() }).where(eq(adminUsers.id, user.id));
    // 등급이 바뀌면 기존 세션을 끊어 다시 로그인하게 한다.
    if (newGrade.id !== oldGrade.id) await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, user.id));
    // 이메일이 바뀌면 이전 주소로 보낸 재설정 링크는 쓸 수 없게 한다.
    if (user.email !== input.email) await invalidateResetLinks(tx, user.id);
    await writeAudit(tx, {
      ...audit(params.actor),
      action: "admin.updated",
      targetType: "admin_user",
      targetId: user.id,
      before: { name: user.name, email: user.email, grade: oldGrade.name },
      after: { name: input.name, email: input.email, grade: newGrade.name },
    });
    return { ok: true };
  });
}

async function invalidateResetLinks(tx: DbOrTx, userId: string) {
  await tx
    .update(adminPasswordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(adminPasswordResets.adminUserId, userId), isNull(adminPasswordResets.usedAt)));
}

/** 2단계 인증 초기화, 임시 비밀번호 발급, 중지, 사용 재개. 해당 계정의 로그인 세션은 모두 끊는다. */
export async function applyAccountAction(
  db: Db,
  params: { actor: Actor | null; userId: string; action: AccountAction; password?: string },
): Promise<AccountResult<{ loginId: string; temporaryPassword: string | null }>> {
  const { actor, action } = params;
  if (actor) assertPermission(actor, "accounts.manage");
  if (actor && actor.id === params.userId) {
    return { ok: false, formError: "자기 계정은 여기서 바꿀 수 없습니다. 비밀번호는 '내 계정'에서 바꾸고, 그 밖의 일은 다른 관리자에게 요청하세요." };
  }
  let password: string | null = null;
  const changes: Partial<typeof adminUsers.$inferInsert> = { updatedAt: new Date() };
  if (action === "reset-2fa") Object.assign(changes, { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, failedLoginCount: 0, lockedUntil: null });
  if (action === "reset-password") {
    password = params.password ?? newTemporaryPassword();
    const policyError = validatePasswordPolicy(password);
    if (policyError) return { ok: false, formError: policyError };
    Object.assign(changes, { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null });
  }
  if (action === "deactivate") changes.isActive = false;
  if (action === "activate") Object.assign(changes, { isActive: true, failedLoginCount: 0, lockedUntil: null });

  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const row = await findAccount(tx, params.userId);
    if (!row) return { ok: false, formError: "계정을 찾을 수 없습니다." };
    const { user, grade } = row;
    if (grade.isSuper) assertCanTouchSuper(actor);
    if (action === "deactivate" && grade.isSuper && user.isActive && (await otherActiveSuperAdmins(tx, user.id)) === 0) {
      return { ok: false, formError: LAST_SUPER };
    }
    await tx.update(adminUsers).set(changes).where(eq(adminUsers.id, user.id));
    await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, user.id));
    await writeAudit(tx, { ...audit(actor), action: `admin.${action}`, targetType: "admin_user", targetId: user.id, reason: actor ? null : "manage-admin 스크립트" });
    return { ok: true, value: { loginId: user.loginId, temporaryPassword: params.password ? null : password } };
  });
}

/** 내 비밀번호 변경. 현재 세션만 남기고 다른 기기의 로그인은 끊는다. */
export async function changeOwnPassword(
  db: Db,
  params: { userId: string; currentSessionId: string; current: string; next: string; confirm: string; ip?: string | null },
): Promise<AccountResult> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, params.userId));
  if (!user) return { ok: false, formError: "계정을 찾을 수 없습니다." };
  if (!(await verifyPassword(user.passwordHash, params.current))) return { ok: false, fieldErrors: { current: "현재 비밀번호가 맞지 않습니다." } };
  const policyError = validatePasswordPolicy(params.next);
  if (policyError) return { ok: false, fieldErrors: { next: policyError } };
  if (params.next !== params.confirm) return { ok: false, fieldErrors: { confirm: "새 비밀번호가 서로 다릅니다." } };
  if (params.next === params.current) return { ok: false, fieldErrors: { next: "지금과 다른 비밀번호를 쓰세요." } };
  const passwordHash = await hashPassword(params.next);
  await db.transaction(async (tx) => {
    await tx.update(adminUsers).set({ passwordHash, updatedAt: new Date() }).where(eq(adminUsers.id, user.id));
    await tx.delete(adminSessions).where(and(eq(adminSessions.adminUserId, user.id), ne(adminSessions.id, params.currentSessionId)));
    await writeAudit(tx, { actorType: "admin", actorId: user.id, ip: params.ip ?? null, action: "admin.password-changed", targetType: "admin_user", targetId: user.id });
  });
  return { ok: true };
}

/** 내 이메일 변경(아이디 찾기·비밀번호 재설정 메일을 받을 주소). 현재 비밀번호를 확인한다. 비우면 등록을 지운다. */
export async function changeOwnEmail(
  db: Db,
  params: { userId: string; current: string; email: string; ip?: string | null },
): Promise<AccountResult> {
  const parsed = accountSchema.shape.email.safeParse(params.email);
  if (!parsed.success) return { ok: false, fieldErrors: { email: parsed.error.issues[0]?.message ?? "이메일 형식이 올바르지 않습니다." } };
  const email = parsed.data;
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, params.userId));
  if (!user) return { ok: false, formError: "계정을 찾을 수 없습니다." };
  if (!(await verifyPassword(user.passwordHash, params.current))) return { ok: false, fieldErrors: { current: "현재 비밀번호가 맞지 않습니다." } };
  if (user.email === email) return { ok: true };
  await db.transaction(async (tx) => {
    await tx.update(adminUsers).set({ email, updatedAt: new Date() }).where(eq(adminUsers.id, user.id));
    await invalidateResetLinks(tx, user.id);
    await writeAudit(tx, {
      actorType: "admin",
      actorId: user.id,
      ip: params.ip ?? null,
      action: "admin.email-changed",
      targetType: "admin_user",
      targetId: user.id,
      before: { email: user.email },
      after: { email },
    });
  });
  return { ok: true };
}
