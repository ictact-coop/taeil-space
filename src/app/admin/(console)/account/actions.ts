"use server";

import type { FormState } from "@/components/admin/form-state";
import { revalidatePath } from "next/cache";
import { changeOwnEmail, changeOwnPassword } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";

export async function changePasswordAction(prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const s = (k: string) => String(form.get(k) ?? "");
  const r = await changeOwnPassword(db, { userId: admin.id, currentSessionId: admin.sessionId, current: s("current"), next: s("next"), confirm: s("confirm"), ip: admin.ip });
  if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors };
  return { version: prev.version + 1, ok: true, message: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊었습니다." };
}

export async function changeEmailAction(prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const email = String(form.get("email") ?? "");
  const r = await changeOwnEmail(db, { userId: admin.id, current: String(form.get("current") ?? ""), email, ip: admin.ip });
  if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, values: { email } };
  revalidatePath("/admin/account");
  return { version: prev.version + 1, ok: true, message: email.trim() ? "이메일을 저장했습니다." : "이메일 등록을 지웠습니다." };
}
