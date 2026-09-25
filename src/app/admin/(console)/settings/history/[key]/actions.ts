"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { cancelScheduledSetting, revertSetting } from "@/server/settings/service";

function back(key: string, params: Record<string, string>): never {
  redirect(`/admin/settings/history/${encodeURIComponent(key)}?${new URLSearchParams(params).toString()}`);
}

export async function revertAction(key: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const result = await revertSetting(db, {
    actor: { id: admin.id, role: admin.role, ip: admin.ip },
    policyValueId: Number(formData.get("policyValueId")),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!result.ok) back(key, { error: result.formError ?? "되돌리지 못했습니다." });
  revalidatePath("/admin/settings", "layout");
  back(key, { done: "선택한 버전의 값으로 되돌렸습니다." });
}

export async function cancelScheduledAction(key: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const result = await cancelScheduledSetting(db, {
    actor: { id: admin.id, role: admin.role, ip: admin.ip },
    policyValueId: Number(formData.get("policyValueId")),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!result.ok) back(key, { error: result.formError ?? "취소하지 못했습니다." });
  revalidatePath("/admin/settings", "layout");
  back(key, { done: "예약된 변경을 취소했습니다." });
}
