import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { AdminRoleName } from "@/domain/settings/define";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode } from "@/server/actor";
import { adminSessions, adminUsers } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password";
import { assertCanManage } from "./permissions";

/**
 * 관리자 계정 관리 (시스템 관리자 전용). 관리 화면과 `pnpm admin:manage`가 함께 쓴다.
 * actor가 null이면 서버 명령(시스템)으로 기록한다.
 * 잠김 방지: 자기 계정의 역할 변경·중지·초기화는 막고, 사용 중인 시스템 관리자가 한 명도 남지 않게 되는 변경도 막는다.
 */
export const adminRoles = ["rental", "accounting", "system"] as const satisfies readonly AdminRoleName[];

const accountSchema = z.object({
  loginId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "아이디는 영문 소문자·숫자·._- 로 3~32자입니다."),
  name: z.string().trim().min(1, "이름을 입력하세요.").max(50, "이름은 50자 이하로 입력하세요."),
  role: z.enum(adminRoles, { message: "역할을 고르세요." }),
});

export type AccountAction = "reset-2fa" | "reset-password" | "deactivate" | "activate";

type AccountResult<T = undefined> = MutationResult<T>;

export function newTemporaryPassword(): string {
  return `${randomBytes(12).toString("base64url")}9a`;
}

export async function listAdminAccounts(db: DbOrTx) {
  return db
    .select({
      id: adminUsers.id,
      loginId: adminUsers.loginId,
      name: adminUsers.name,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      totpEnabledAt: adminUsers.totpEnabledAt,
      lockedUntil: adminUsers.lockedUntil,
      createdAt: adminUsers.createdAt,
      /** 가장 최근 활동(남아 있는 세션 기준) */
      lastSeenAt: sql<string | null>`max(${adminSessions.lastSeenAt})`,
    })
    .from(adminUsers)
    .leftJoin(adminSessions, eq(adminSessions.adminUserId, adminUsers.id))
    .groupBy(adminUsers.id)
    .orderBy(desc(adminUsers.isActive), asc(adminUsers.loginId));
}

const audit = (actor: Actor | null) => ({ actorType: actor ? ("admin" as const) : ("system" as const), actorId: actor?.id ?? null, ip: actor?.ip ?? null });

/** 계정 변경을 직렬화한다(마지막 시스템 관리자 검사가 동시 요청에 뚫리지 않게). */
async function lockAccounts(tx: DbOrTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin_accounts'))`);
}

async function otherActiveSystemAdmins(tx: DbOrTx, exceptId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, "system"), eq(adminUsers.isActive, true), ne(adminUsers.id, exceptId)));
  return row?.n ?? 0;
}

export async function createAdminAccount(
  db: Db,
  params: { actor: Actor | null; raw: { loginId: string; name: string; role: string }; password?: string },
): Promise<AccountResult<{ id: string; loginId: string; temporaryPassword: string | null }>> {
  if (params.actor) assertCanManage(params.actor.role, "accounts");
  const parsed = accountSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const password = params.password ?? newTemporaryPassword();
  const policyError = validatePasswordPolicy(password);
  if (policyError) return { ok: false, formError: policyError };
  const input = parsed.data;
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminUsers)
        .values({ loginId: input.loginId, name: input.name, role: input.role, passwordHash: await hashPassword(password) })
        .returning({ id: adminUsers.id });
      await writeAudit(tx, { ...audit(params.actor), action: "admin.created", targetType: "admin_user", targetId: row!.id, after: input });
      return row!;
    });
    return { ok: true, value: { id: created.id, loginId: input.loginId, temporaryPassword: params.password ? null : password } };
  } catch (e) {
    if (pgErrorCode(e) === "23505") return { ok: false, fieldErrors: { loginId: "이미 쓰고 있는 아이디입니다." } };
    throw e;
  }
}

export async function updateAdminAccount(db: Db, params: { actor: Actor; userId: string; raw: { name: string; role: string } }): Promise<AccountResult> {
  assertCanManage(params.actor.role, "accounts");
  const parsed = accountSchema.pick({ name: true, role: true }).safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = parsed.data;
  return db.transaction(async (tx): Promise<AccountResult> => {
    await lockAccounts(tx);
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, params.userId));
    if (!user) return { ok: false, formError: "계정을 찾을 수 없습니다." };
    if (user.role !== input.role) {
      if (user.id === params.actor.id) return { ok: false, fieldErrors: { role: "자기 계정의 역할은 바꿀 수 없습니다. 다른 시스템 관리자에게 요청하세요." } };
      if (user.role === "system" && user.isActive && (await otherActiveSystemAdmins(tx, user.id)) === 0) {
        return { ok: false, fieldErrors: { role: "사용 중인 시스템 관리자가 한 명은 있어야 합니다." } };
      }
    }
    if (user.name === input.name && user.role === input.role) return { ok: true };
    await tx.update(adminUsers).set({ name: input.name, role: input.role, updatedAt: new Date() }).where(eq(adminUsers.id, user.id));
    // 역할이 바뀌면 기존 세션을 끊어 새 권한으로 다시 로그인하게 한다.
    if (user.role !== input.role) await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, user.id));
    await writeAudit(tx, {
      ...audit(params.actor),
      action: "admin.updated",
      targetType: "admin_user",
      targetId: user.id,
      before: { name: user.name, role: user.role },
      after: input,
    });
    return { ok: true };
  });
}

/** 2단계 인증 초기화, 임시 비밀번호 발급, 중지, 사용 재개. 해당 계정의 로그인 세션은 모두 끊는다. */
export async function applyAccountAction(
  db: Db,
  params: { actor: Actor | null; userId: string; action: AccountAction; password?: string },
): Promise<AccountResult<{ loginId: string; temporaryPassword: string | null }>> {
  const { actor, action } = params;
  if (actor) assertCanManage(actor.role, "accounts");
  if (actor && actor.id === params.userId) {
    return { ok: false, formError: "자기 계정은 여기서 바꿀 수 없습니다. 비밀번호는 '내 비밀번호 변경'에서 바꾸고, 그 밖의 일은 다른 시스템 관리자에게 요청하세요." };
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
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, params.userId));
    if (!user) return { ok: false, formError: "계정을 찾을 수 없습니다." };
    if (action === "deactivate" && user.role === "system" && user.isActive && (await otherActiveSystemAdmins(tx, user.id)) === 0) {
      return { ok: false, formError: "사용 중인 시스템 관리자가 한 명은 있어야 합니다." };
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
