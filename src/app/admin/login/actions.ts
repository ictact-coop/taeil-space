"use server";

import { redirect } from "next/navigation";
import { requestMeta, requirePendingMfa, startSession } from "@/server/auth/current";
import { authenticatePassword, confirmTotpEnrollment, verifyUserTotp } from "@/server/auth/service";
import { db } from "@/server/db/client";
import { formatKst } from "@/lib/time";

export interface AuthFormState {
  error?: string;
  /** 실패 후 폼이 초기화될 때 아이디를 다시 채우기 위한 값 */
  loginId?: string;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const loginId = String(formData.get("loginId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!loginId || !password) return { error: "아이디와 비밀번호를 입력하세요.", loginId };

  const result = await authenticatePassword(db, loginId, password, await requestMeta());
  if (!result.ok) {
    return result.reason === "locked"
      ? { error: `로그인 시도가 많아 잠겼습니다. ${formatKst(result.lockedUntil)} 이후에 다시 시도하세요.`, loginId }
      : { error: "아이디 또는 비밀번호가 올바르지 않습니다.", loginId };
  }
  await startSession(result.user.id, false);
  redirect(result.user.totpEnabledAt ? "/admin/login/verify" : "/admin/login/setup-2fa");
}

function totpError(result: { ok: false; reason: "invalid" } | { ok: false; reason: "locked"; lockedUntil: Date }) {
  return result.reason === "locked"
    ? `시도가 많아 잠겼습니다. ${formatKst(result.lockedUntil)} 이후에 다시 시도하세요.`
    : "인증 코드가 올바르지 않습니다. 앱에 표시된 최신 코드를 입력하세요.";
}

export async function verifyTotpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const current = await requirePendingMfa();
  const result = await verifyUserTotp(db, current.user.id, String(formData.get("code") ?? ""), await requestMeta());
  if (!result.ok) return { error: totpError(result) };
  await startSession(current.user.id, true);
  redirect("/admin");
}

export async function confirmEnrollmentAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const current = await requirePendingMfa();
  const result = await confirmTotpEnrollment(db, current.user.id, String(formData.get("code") ?? ""), await requestMeta());
  if (!result.ok) return { error: totpError(result) };
  await startSession(current.user.id, true);
  redirect("/admin");
}
