"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { formValues, type FormState } from "@/components/admin/form-state";
import { applicationInputFromForm } from "@/domain/booking/application-input";
import { setApplicantToken } from "@/server/booking/applicant-cookie";
import { submitApplication } from "@/server/booking/submit";
import { db } from "@/server/db/client";

export async function submitApplicationAction(prev: FormState, form: FormData): Promise<FormState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  const result = await submitApplication(db, applicationInputFromForm(form), { ip });
  if (!result.ok) {
    return { version: prev.version + 1, formError: result.formError ?? "입력값을 확인하세요.", fieldErrors: result.fieldErrors, values: formValues(form) };
  }
  await setApplicantToken(result.applicationNo, result.accessToken);
  redirect(`/apply/pay/${result.applicationNo}`);
}
