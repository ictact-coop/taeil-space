"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { formValues as allFormValues, type FormState } from "@/components/admin/form-state";
import { applicationInputFromForm } from "@/domain/booking/application-input";
import { setApplicantToken } from "@/server/booking/applicant-cookie";
import { submitApplication } from "@/server/booking/submit";
import { db } from "@/server/db/client";
import { clientIpFrom } from "@/server/security/client-ip";
import { throttle, TOO_MANY_REQUESTS } from "@/server/security/throttle";

/** 오류로 되돌려 보낼 때 비밀번호는 담지 않는다 */
function formValues(form: FormData) {
  const { applicantPassword: _p, applicantPasswordConfirm: _c, ...rest } = allFormValues(form);
  return rest;
}

export async function submitApplicationAction(prev: FormState, form: FormData): Promise<FormState> {
  if (!(await throttle("submit"))) return { version: prev.version + 1, formError: TOO_MANY_REQUESTS, values: formValues(form) };
  const ip = clientIpFrom(await headers());
  const result = await submitApplication(db, applicationInputFromForm(form), { ip: ip === "unknown" ? null : ip });
  if (!result.ok) {
    return { version: prev.version + 1, formError: result.formError ?? "입력값을 확인하세요.", fieldErrors: result.fieldErrors, values: formValues(form) };
  }
  await setApplicantToken(result.applicationNo, result.accessToken);
  redirect(`/apply/pay/${result.applicationNo}`);
}
