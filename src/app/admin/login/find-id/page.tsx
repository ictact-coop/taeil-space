import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { FindIdForm } from "../recovery-forms";
import { RecoveryLinks } from "../recovery-links";

export const metadata: Metadata = { title: "관리자 아이디 찾기" };

export default function FindIdPage() {
  return (
    <AuthShell title="아이디 찾기">
      <FindIdForm />
      <RecoveryLinks current="find-id" />
    </AuthShell>
  );
}
