"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/url";
import { endApplicantSession, requestLoginCode, verifyLoginCode } from "@/server/applicant/auth";
import { getApplicantView } from "@/server/applicant/current";
import { submitRevision, withdrawApplication } from "@/server/applications/applicant-actions";
import { clearApplicantSessionCookie, getApplicantSessionCookie, setApplicantSessionCookie } from "@/server/booking/applicant-cookie";
import { db } from "@/server/db/client";
import { getGateway } from "@/server/payments/gateway";

export interface LoginState {
  step: "email" | "code";
  email?: string;
  error?: string;
  info?: string;
}

export async function requestCodeAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const r = await requestLoginCode(db, email);
  if (!r.ok) return { step: "email", email, error: r.error };
  return { step: "code", email, info: "신청할 때 적은 이메일이면 확인 코드를 보냈습니다. 메일함을 확인해 주세요." };
}

export async function verifyCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? prev.email ?? "");
  const r = await verifyLoginCode(db, email, String(form.get("code") ?? ""));
  if (!r.ok) return { step: "code", email, error: r.error };
  await setApplicantSessionCookie(r.token, r.expiresAt);
  redirect("/my");
}

export async function logoutAction(): Promise<void> {
  await endApplicantSession(db, await getApplicantSessionCookie());
  await clearApplicantSessionCookie();
  redirect("/my");
}

export async function withdrawAction(no: string, form: FormData): Promise<void> {
  const view = await getApplicantView(no);
  if (!view) redirect("/my");
  if (form.get("confirm") !== "yes") redirect(withNotice(`/my/${no}`, { error: "철회 내용을 확인했다는 항목에 체크해 주세요." }));
  const r = await withdrawApplication(db, getGateway(), { applicationId: view.application.id, reason: String(form.get("reason") ?? "") });
  redirect(withNotice(`/my/${no}`, r.ok ? { done: "신청을 철회했습니다." } : { error: r.formError ?? "철회하지 못했습니다." }));
}

export interface RevisionState {
  version: number;
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
}

export async function submitRevisionAction(no: string, prev: RevisionState, form: FormData): Promise<RevisionState> {
  const view = await getApplicantView(no);
  if (!view) return { version: prev.version + 1, error: "신청 내역을 확인할 수 없습니다." };
  const s = (k: string) => String(form.get(k) ?? "");
  const r = await submitRevision(db, {
    applicationId: view.application.id,
    raw: {
      contactName: s("contactName"),
      contactPhone: s("contactPhone"),
      eventTitle: s("eventTitle"),
      eventPurpose: s("eventPurpose"),
      eventPublic: form.get("eventPublic") === "true",
      expectedHeadcount: s("expectedHeadcount"),
      nightManagerName: s("nightManagerName"),
      nightManagerPhone: s("nightManagerPhone"),
      uploadToken: s("uploadToken"),
      note: s("note"),
    },
  });
  if (!r.ok) return { version: prev.version + 1, error: r.formError, fieldErrors: r.fieldErrors };
  redirect(withNotice(`/my/${no}`, { done: "보완 내용을 제출했습니다. 다시 심사합니다." }));
}
