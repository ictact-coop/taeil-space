"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withNotice } from "@/lib/url";
import { formValues, type FormState } from "@/components/admin/form-state";
import { discountInputFromForm } from "@/domain/pricing/discount-input";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { saveDiscountRule } from "@/server/pricing/discount-service";

export async function saveDiscountAction(id: string | null, prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const result = await guard(prev, async () => {
    const r = await saveDiscountRule(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      id,
      raw: discountInputFromForm(form),
      reason: String(form.get("reason") ?? ""),
    });
    if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, values: formValues(form) };
    revalidatePath("/admin/settings", "layout");
    return { version: prev.version + 1, ok: true, message: "감면 규칙을 저장했습니다." };
  });
  if (result.ok) redirect(withNotice("/admin/settings/discounts", { done: result.message ?? "저장했습니다." }));
  return result;
}
