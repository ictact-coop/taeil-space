import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { RequestResetForm } from "../recovery-forms";
import { RecoveryLinks } from "../recovery-links";

export const metadata: Metadata = { title: "관리자 비밀번호 재설정" };

export default function RequestResetPage() {
  return (
    <AuthShell title="비밀번호 재설정">
      <RequestResetForm />
      <RecoveryLinks current="reset" />
    </AuthShell>
  );
}
