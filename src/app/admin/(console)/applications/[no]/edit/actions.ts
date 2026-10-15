"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, type FormState } from "@/components/admin/form-state";
import { RECEIPT_FIELDS } from "@/domain/booking/receipt";
import { withNotice } from "@/lib/url";
import { updateApplicationByAdmin, type AdminEditRaw } from "@/server/applications/admin-edit";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { getGateway } from "@/server/payments/gateway";

const FIELDS = ["spaceId", "date", "start", "end", "orgName", "regType", "regNo", "contactName", "contactPhone", "contactEmail", "eventTitle", "eventPurpose", "expectedHeadcount", ...RECEIPT_FIELDS] as const;

export async function editApplicationAction(no: string, id: string, prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin("applications.review");
  const raw = Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? "")])) as AdminEditRaw;
  const r = await updateApplicationByAdmin(db, getGateway(), {
    actor: admin,
    applicationId: id,
    raw,
    reason: String(form.get("reason") ?? ""),
    recalculate: form.get("recalculate") === "on",
    notify: form.get("notify") === "on",
  });
  if (!r.ok) return { version: prev.version + 1, formError: r.formError, fieldErrors: r.fieldErrors, values: formValues(form) };
  revalidatePath(`/admin/applications/${no}`);
  const refund = r.value.refundAmount > 0 ? ` 차액 ${r.value.refundAmount.toLocaleString("ko-KR")}원 환불을 요청했습니다.` : "";
  redirect(withNotice(`/admin/applications/${no}`, { done: `신청 정보를 수정했습니다(${r.value.changes.length}건).${refund}` }));
}
