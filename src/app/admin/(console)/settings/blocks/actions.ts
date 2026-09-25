"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, type FormState } from "@/components/admin/form-state";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { createBlock, deleteBlock, type BlockConflict } from "@/server/calendar/block-service";
import { db } from "@/server/db/client";

export interface BlockFormState extends FormState {
  conflicts?: BlockConflict[];
}

export async function createBlockAction(prev: BlockFormState, form: FormData): Promise<BlockFormState> {
  const admin = await requireAdmin();
  return guard(prev, async () => {
    const s = (k: string) => String(form.get(k) ?? "");
    const r = await createBlock(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      raw: { kind: s("kind"), spaceId: s("spaceId"), startsAt: s("startsAt"), endsAt: s("endsAt"), reason: s("reason") },
    });
    if (!r.ok) {
      return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, conflicts: r.conflicts, values: formValues(form) };
    }
    revalidatePath("/admin/settings", "layout");
    return { version: prev.version + 1, ok: true, message: "일정을 차단했습니다. 이용자 달력에서 신청할 수 없게 됩니다." };
  });
}

export async function deleteBlockAction(id: string, form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await deleteBlock(db, { actor: { id: admin.id, role: admin.role, ip: admin.ip }, id, reason: String(form.get("reason") ?? "") });
  revalidatePath("/admin/settings", "layout");
  const params = new URLSearchParams(r.ok ? { done: "차단을 해제했습니다." } : { error: r.formError ?? "처리하지 못했습니다." });
  redirect(`/admin/settings/blocks?${params.toString()}`);
}
