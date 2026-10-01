import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hasPermission, normalizePermissions, type Permission, type PermissionHolder } from "@/domain/auth/permissions";
import { db } from "@/server/db/client";
import { clientIpFrom } from "@/server/security/client-ip";
import { createSession, deleteSession, validateSession, type RequestMeta } from "./service";

export const SESSION_COOKIE = "taeil_admin_session";

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const ip = clientIpFrom(h);
  return { ip: ip === "unknown" ? null : ip, userAgent: h.get("user-agent") };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    expires: expiresAt,
  });
}

/** 새 세션을 만들고 쿠키에 저장한다. 기존 세션이 있으면 지운다(세션 고정 공격 방지). */
export async function startSession(userId: string, mfaVerified: boolean): Promise<void> {
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) await deleteSession(db, previous);
  const { token, expiresAt } = await createSession(db, userId, mfaVerified, await requestMeta());
  await setSessionCookie(token, expiresAt);
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db, token);
  jar.delete({ name: SESSION_COOKIE, path: "/admin" });
}

/** 현재 요청의 관리자 (요청당 한 번만 조회) */
export const getCurrentAdmin = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(db, token);
});

export interface CurrentAdmin extends PermissionHolder {
  id: string;
  name: string;
  loginId: string;
  gradeId: string;
  gradeName: string;
  ip: string | null;
  /** 현재 로그인 세션 id (비밀번호 변경 시 이 세션만 남긴다) */
  sessionId: string;
}

/**
 * 관리자 화면·서버 액션 첫 줄에서 호출한다. 2단계 인증까지 마친 세션만 통과한다.
 * permission을 주면 등급에 그 권한이 있어야 통과한다(최고 관리자는 항상 통과).
 * 권한은 요청마다 등급에서 읽으므로 등급 설정을 바꾸면 바로 적용된다.
 */
export async function requireAdmin(permission?: Permission): Promise<CurrentAdmin> {
  const current = await getCurrentAdmin();
  if (!current) redirect("/admin/login");
  if (!current.session.mfaVerified) {
    redirect(current.user.totpEnabledAt ? "/admin/login/verify" : "/admin/login/setup-2fa");
  }
  const holder = adminPermissions(current);
  if (permission && !hasPermission(holder, permission)) redirect("/admin?denied=1");
  const meta = await requestMeta();
  return {
    id: current.user.id,
    name: current.user.name,
    loginId: current.user.loginId,
    gradeId: current.grade.id,
    gradeName: current.grade.name,
    ...holder,
    ip: meta.ip ?? null,
    sessionId: current.session.id,
  };
}

/** route handler용: getCurrentAdmin 결과의 권한 (2단계 인증 전이면 권한 없음) */
export function adminPermissions(current: Awaited<ReturnType<typeof getCurrentAdmin>>): PermissionHolder {
  if (!current?.session.mfaVerified) return { isSuper: false, permissions: [] };
  return { isSuper: current.grade.isSuper, permissions: normalizePermissions(current.grade.permissions) };
}

/** 비밀번호만 확인된(2단계 인증 전) 세션 */
export async function requirePendingMfa() {
  const current = await getCurrentAdmin();
  if (!current) redirect("/admin/login");
  if (current.session.mfaVerified) redirect("/admin");
  return current;
}
