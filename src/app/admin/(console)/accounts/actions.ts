"use server";

import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/components/admin/form-state";
import { guard } from "@/server/admin-action";
import { type AccountAction, applyAccountAction, createAdminAccount, updateAdminAccount } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";

export interface AccountFormState extends FormState {
  /** 새로 발급한 임시 비밀번호. 이 응답에서 한 번만 보여 준다. */
  temporaryPassword?: string;
  loginId?: string;
}

const actionMessages: Record<AccountAction, string> = {
  "reset-2fa": "2단계 인증을 초기화했습니다. 다음 로그인 때 OTP 앱을 다시 등록합니다.",
  "reset-password": "임시 비밀번호를 발급했습니다. 첫 로그인 후 '내 계정'에서 비밀번호를 바꾸도록 안내하세요.",
  deactivate: "계정을 중지했습니다. 이 계정으로는 로그인할 수 없습니다.",
  activate: "계정을 다시 사용할 수 있게 했습니다.",
};

export async function createAccountAction(prev: AccountFormState, form: FormData): Promise<AccountFormState> {
  const admin = await requireAdmin("accounts.manage");
  return guard(prev, async () => {
    const s = (k: string) => String(form.get(k) ?? "");
    const r = await createAdminAccount(db, { actor: admin, raw: { loginId: s("loginId"), name: s("name"), gradeId: s("gradeId"), email: s("email") } });
    if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, values: formValues(form) };
    revalidatePath("/admin/accounts");
    return {
      version: prev.version + 1,
      ok: true,
      message: `계정 ${r.value.loginId}을(를) 만들었습니다. 첫 로그인 때 2단계 인증을 등록하고, 비밀번호를 바꾸도록 안내하세요.`,
      loginId: r.value.loginId,
      temporaryPassword: r.value.temporaryPassword ?? undefined,
    };
  });
}

export async function updateAccountAction(userId: string, prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin("accounts.manage");
  return guard(prev, async () => {
    const r = await updateAdminAccount(db, { actor: admin, userId, raw: { name: String(form.get("name") ?? ""), gradeId: String(form.get("gradeId") ?? ""), email: String(form.get("email") ?? "") } });
    if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, values: formValues(form) };
    revalidatePath("/admin/accounts", "layout");
    return { version: prev.version + 1, ok: true, message: "저장했습니다. 등급을 바꿨다면 그 계정은 다시 로그인해야 합니다." };
  });
}

export async function accountCommandAction(userId: string, action: AccountAction, prev: AccountFormState, form: FormData): Promise<AccountFormState> {
  const admin = await requireAdmin("accounts.manage");
  return guard(prev, async () => {
    if (form.get("confirm") !== "yes") return { version: prev.version + 1, formError: "확인 항목에 체크하세요." };
    const r = await applyAccountAction(db, { actor: admin, userId, action });
    if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "처리하지 못했습니다." };
    revalidatePath("/admin/accounts", "layout");
    return { version: prev.version + 1, ok: true, message: actionMessages[action], loginId: r.value.loginId, temporaryPassword: r.value.temporaryPassword ?? undefined };
  });
}
