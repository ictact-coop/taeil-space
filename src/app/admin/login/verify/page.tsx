import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { requirePendingMfa } from "@/server/auth/current";
import { verifyTotpAction } from "../actions";
import { CodeForm } from "../code-form";

export const metadata: Metadata = { title: "2단계 인증" };

export default async function VerifyPage() {
  const current = await requirePendingMfa();
  if (!current.user.totpEnabledAt) redirect("/admin/login/setup-2fa");
  return (
    <AuthShell title="2단계 인증">
      <p className="mb-4 text-sm text-muted">인증 앱(Google Authenticator 등)에 표시된 코드를 입력하세요.</p>
      <CodeForm action={verifyTotpAction} submitLabel="확인" />
    </AuthShell>
  );
}
