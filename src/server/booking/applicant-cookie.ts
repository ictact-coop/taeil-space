import "server-only";
import { cookies } from "next/headers";

const tokenCookie = (applicationNo: string) => `taeil_app_${applicationNo.replace(/[^A-Za-z0-9]/g, "")}`;
const SESSION_COOKIE = "taeil_my";

/** 신청 직후 결제 화면을 다시 열 수 있도록 신청별 접근 토큰을 쿠키로 둔다(30일). */
export async function setApplicantToken(applicationNo: string, token: string): Promise<void> {
  (await cookies()).set(tokenCookie(applicationNo), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
}

export async function getApplicantToken(applicationNo: string): Promise<string | undefined> {
  return (await cookies()).get(tokenCookie(applicationNo))?.value;
}

/** 나의 대관 이메일 확인 세션 */
export async function setApplicantSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getApplicantSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearApplicantSessionCookie(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/" });
}
