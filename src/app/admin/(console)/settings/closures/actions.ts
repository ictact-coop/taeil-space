"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, type FormState } from "@/components/admin/form-state";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { createClosureRule, deactivateClosureRule, type ClosureConflict } from "@/server/calendar/closure-service";
import { db } from "@/server/db/client";

export interface ClosureFormState extends FormState {
  conflicts?: ClosureConflict[];
}

export async function createClosureAction(prev: ClosureFormState, form: FormData): Promise<ClosureFormState> {
  const admin = await requireAdmin();
  return guard(prev, async () => {
    const s = (k: string) => String(form.get(k) ?? "");
    const r = await createClosureRule(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      raw: {
        type: s("type"),
        name: s("name"),
        publicMessage: s("publicMessage"),
        spaceId: s("spaceId"),
        weekday: s("weekday"),
        month: s("month"),
        day: s("day"),
        startDate: s("startDate"),
        endDate: s("endDate"),
        activeFrom: s("activeFrom"),
        activeUntil: s("activeUntil"),
      },
      reason: s("reason"),
      confirmConflicts: form.get("confirmConflicts") === "true",
    });
    if (!r.ok) {
      return {
        version: prev.version + 1,
        formError: r.formError ?? "입력값을 확인하세요.",
        fieldErrors: r.fieldErrors,
        conflicts: r.conflicts,
        values: formValues(form),
      };
    }
    revalidatePath("/admin/settings", "layout");
    const warn = r.conflicts.length > 0 ? ` 휴관일에 걸린 신청 ${r.conflicts.length}건은 따로 연락해 조정하세요.` : "";
    return { version: prev.version + 1, ok: true, message: `휴관 규칙을 추가했습니다.${warn}` };
  });
}

export async function deactivateClosureAction(id: string, form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await deactivateClosureRule(db, {
    actor: { id: admin.id, role: admin.role, ip: admin.ip },
    id,
    reason: String(form.get("reason") ?? ""),
  });
  revalidatePath("/admin/settings", "layout");
  const params = new URLSearchParams(r.ok ? { done: "규칙을 껐습니다." } : { error: r.formError ?? "처리하지 못했습니다." });
  redirect(`/admin/settings/closures?${params.toString()}`);
}
