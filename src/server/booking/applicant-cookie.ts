import "server-only";
import { cookies } from "next/headers";

const cookieName = (applicationNo: string) => `taeil_app_${applicationNo.replace(/[^A-Za-z0-9]/g, "")}`;

/** 신청 직후 결제 화면을 다시 열 수 있도록 신청별 접근 토큰을 쿠키로 둔다(30일). */
export async function setApplicantToken(applicationNo: string, token: string): Promise<void> {
  (await cookies()).set(cookieName(applicationNo), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/apply",
    maxAge: 30 * 24 * 3600,
  });
}

export async function getApplicantToken(applicationNo: string): Promise<string | undefined> {
  return (await cookies()).get(cookieName(applicationNo))?.value;
}
