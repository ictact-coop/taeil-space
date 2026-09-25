import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AdminRoleName } from "@/domain/settings/define";
import { db } from "@/server/db/client";
import { createSession, deleteSession, validateSession, type RequestMeta } from "./service";

export const SESSION_COOKIE = "taeil_admin_session";

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip"), userAgent: h.get("user-agent") };
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

export interface CurrentAdmin {
  id: string;
  name: string;
  loginId: string;
  role: AdminRoleName;
  ip: string | null;
}

/**
 * 관리자 화면·서버 액션 첫 줄에서 호출한다. 2단계 인증까지 마친 세션만 통과한다.
 * roles를 주면 해당 역할(또는 시스템 관리자)만 통과한다.
 */
export async function requireAdmin(roles?: readonly AdminRoleName[]): Promise<CurrentAdmin> {
  const current = await getCurrentAdmin();
  if (!current) redirect("/admin/login");
  if (!current.session.mfaVerified) {
    redirect(current.user.totpEnabledAt ? "/admin/login/verify" : "/admin/login/setup-2fa");
  }
  const role = current.user.role;
  if (roles && role !== "system" && !roles.includes(role)) redirect("/admin?denied=1");
  const meta = await requestMeta();
  return { id: current.user.id, name: current.user.name, loginId: current.user.loginId, role, ip: meta.ip ?? null };
}

/** 비밀번호만 확인된(2단계 인증 전) 세션 */
export async function requirePendingMfa() {
  const current = await getCurrentAdmin();
  if (!current) redirect("/admin/login");
  if (current.session.mfaVerified) redirect("/admin");
  return current;
}
