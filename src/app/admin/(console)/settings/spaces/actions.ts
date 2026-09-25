"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withNotice } from "@/lib/url";
import { formValues, type FormState } from "@/components/admin/form-state";
import { spaceInputFromForm } from "@/domain/spaces/space-input";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { saveSpace } from "@/server/spaces/service";

export async function saveSpaceAction(id: string | null, prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const result = await guard(prev, async () => {
    const r = await saveSpace(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      id,
      raw: spaceInputFromForm(form),
      reason: String(form.get("reason") ?? ""),
    });
    if (!r.ok) {
      return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, values: formValues(form) };
    }
    revalidatePath("/admin/settings", "layout");
    return { version: prev.version + 1, ok: true, message: id ? "공간 정보를 저장했습니다." : "공간을 추가했습니다." };
  });
  if (result.ok && id === null) redirect(withNotice("/admin/settings/spaces", { done: "공간을 추가했습니다." }));
  return result;
}
