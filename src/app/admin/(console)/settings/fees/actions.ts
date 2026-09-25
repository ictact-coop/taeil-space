"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withNotice } from "@/lib/url";
import type { FormState } from "@/components/admin/form-state";
import { parseKstLocalInput } from "@/lib/time";
import { guard } from "@/server/admin-action";
import { requireAdmin } from "@/server/auth/current";
import { PermissionError } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { cancelScheduledFeeSchedule, saveFeeSchedule } from "@/server/pricing/fee-service";

export interface FeeFormState extends FormState {
  items?: string;
}

export async function saveFeeScheduleAction(prev: FeeFormState, form: FormData): Promise<FeeFormState> {
  const admin = await requireAdmin();
  const itemsJson = String(form.get("items") ?? "");
  const keep = { items: itemsJson, values: { reason: String(form.get("reason") ?? ""), effectiveMode: String(form.get("effectiveMode") ?? "now"), effectiveFrom: String(form.get("effectiveFrom") ?? "") } };
  const result = await guard(prev, async () => {
    let items: unknown;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      return { version: prev.version + 1, formError: "요금표 내용을 읽지 못했습니다.", ...keep };
    }
    let effectiveFrom = new Date();
    if (form.get("effectiveMode") === "scheduled") {
      const parsed = parseKstLocalInput(String(form.get("effectiveFrom") ?? ""));
      if (!parsed) return { version: prev.version + 1, formError: "적용 시작 시각을 입력하세요.", ...keep };
      effectiveFrom = parsed;
    }
    const r = await saveFeeSchedule(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      items,
      effectiveFrom,
      reason: String(form.get("reason") ?? ""),
    });
    if (!r.ok) return { version: prev.version + 1, formError: r.formError ?? "입력값을 확인하세요.", fieldErrors: r.fieldErrors, ...keep };
    revalidatePath("/admin/settings", "layout");
    return { version: prev.version + 1, ok: true };
  });
  if (result.ok) redirect(withNotice("/admin/settings/fees", { done: "요금표를 저장했습니다." }));
  return result;
}

export async function cancelFeeScheduleAction(id: number, form: FormData): Promise<void> {
  const admin = await requireAdmin();
  let r;
  try {
    r = await cancelScheduledFeeSchedule(db, { actor: { id: admin.id, role: admin.role, ip: admin.ip }, id, reason: String(form.get("reason") ?? "") });
  } catch (e) {
    if (!(e instanceof PermissionError)) throw e;
    r = { ok: false as const, formError: e.message };
  }
  revalidatePath("/admin/settings", "layout");
  const params = new URLSearchParams(r.ok ? { done: "예약된 요금표를 취소했습니다." } : { error: r.formError ?? "취소하지 못했습니다." });
  redirect(`/admin/settings/fees?${params.toString()}`);
}
