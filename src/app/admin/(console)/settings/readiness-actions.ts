"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { confirmSettings } from "@/server/settings/service";

export async function confirmSettingAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const result = await confirmSettings(db, {
    actor: { id: admin.id, role: admin.role, ip: admin.ip },
    keys: formData.getAll("key").map(String),
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath("/admin/settings", "layout");
  const params = new URLSearchParams(result.ok ? { done: "현재 값으로 확정했습니다." } : { error: result.formError ?? "확정하지 못했습니다." });
  redirect(`/admin/settings?${params.toString()}`);
}
