"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, type FormState } from "@/components/admin/form-state";
import { withNotice } from "@/lib/url";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { createGrade, deleteGrade, type GradeInput, updateGrade } from "@/server/auth/grades";
import { PermissionError } from "@/server/auth/permissions";
import { db } from "@/server/db/client";

async function requireSuper() {
  const admin = await requireAdmin();
  if (!admin.isSuper) redirect("/admin?denied=1");
  return admin;
}

function input(form: FormData): GradeInput {
  return {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    permissions: form.getAll("permissions").map(String),
  };
}

export async function createGradeAction(prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireSuper();
  const r = await guard(prev, async () => {
    const result = await createGrade(db, { actor: admin, raw: input(form) });
    if (!result.ok) return { version: prev.version + 1, formError: result.formError ?? "입력값을 확인하세요.", fieldErrors: result.fieldErrors, values: formValues(form) };
    return { version: prev.version + 1, ok: true, message: result.value.id };
  });
  if (!r.ok) return r;
  revalidatePath("/admin", "layout");
  redirect(withNotice(`/admin/grades/${r.message}`, { done: "등급을 만들었습니다. 계정 관리에서 계정에 이 등급을 지정하세요." }));
}

export async function updateGradeAction(gradeId: string, prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireSuper();
  return guard(prev, async () => {
    const result = await updateGrade(db, { actor: admin, gradeId, raw: input(form) });
    if (!result.ok) return { version: prev.version + 1, formError: result.formError ?? "입력값을 확인하세요.", fieldErrors: result.fieldErrors, values: formValues(form) };
    revalidatePath("/admin", "layout");
    return { version: prev.version + 1, ok: true, message: "저장했습니다. 이 등급의 계정에는 다음 화면부터 바로 적용됩니다." };
  });
}

export async function deleteGradeAction(gradeId: string, form: FormData): Promise<void> {
  const admin = await requireSuper();
  let error: string | null = null;
  if (form.get("confirm") !== "yes") error = "확인 항목에 체크하세요.";
  else {
    try {
      const r = await deleteGrade(db, { actor: admin, gradeId });
      if (!r.ok) error = r.formError ?? "지우지 못했습니다.";
    } catch (e) {
      if (!(e instanceof PermissionError)) throw e;
      error = e.message;
    }
  }
  if (error) redirect(withNotice(`/admin/grades/${gradeId}`, { error }));
  revalidatePath("/admin", "layout");
  redirect(withNotice("/admin/grades", { done: "등급을 지웠습니다." }));
}
