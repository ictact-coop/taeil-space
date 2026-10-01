"use server";

import { requestMeta } from "@/server/auth/current";
import { RECOVERY_SENT_NOTICE, requestPasswordReset, resetPasswordWithToken, sendLoginIdReminder } from "@/server/auth/recovery";
import { db } from "@/server/db/client";
import { throttle, TOO_MANY_REQUESTS } from "@/server/security/throttle";

export interface RecoveryState {
  error?: string;
  /** 요청을 받았다는 안내(계정 존재 여부와 관계없이 같은 문구) */
  sent?: string;
  values?: { loginId?: string; email?: string };
  fieldErrors?: Partial<Record<"next" | "confirm", string>>;
  /** 비밀번호를 바꾼 계정 아이디 */
  doneLoginId?: string;
}

export async function findIdAction(_prev: RecoveryState, form: FormData): Promise<RecoveryState> {
  const email = String(form.get("email") ?? "");
  if (!(await throttle("adminRecovery"))) return { error: TOO_MANY_REQUESTS, values: { email } };
  const r = await sendLoginIdReminder(db, email, await requestMeta());
  return r.ok ? { sent: RECOVERY_SENT_NOTICE } : { error: r.error, values: { email } };
}

export async function requestResetAction(_prev: RecoveryState, form: FormData): Promise<RecoveryState> {
  const loginId = String(form.get("loginId") ?? "");
  const email = String(form.get("email") ?? "");
  if (!(await throttle("adminRecovery"))) return { error: TOO_MANY_REQUESTS, values: { loginId, email } };
  const r = await requestPasswordReset(db, { loginId, email }, await requestMeta());
  return r.ok ? { sent: RECOVERY_SENT_NOTICE } : { error: r.error, values: { loginId, email } };
}

export async function resetPasswordAction(token: string, _prev: RecoveryState, form: FormData): Promise<RecoveryState> {
  if (!(await throttle("adminRecovery"))) return { error: TOO_MANY_REQUESTS };
  const r = await resetPasswordWithToken(db, { token, next: String(form.get("next") ?? ""), confirm: String(form.get("confirm") ?? "") }, await requestMeta());
  if (!r.ok) return { error: r.error, fieldErrors: r.fieldErrors };
  return { doneLoginId: r.loginId };
}
