import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getCurrentAdmin } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "관리자 로그인" };

export default async function LoginPage() {
  const current = await getCurrentAdmin();
  if (current?.session.mfaVerified) redirect("/admin");
  return (
    <AuthShell title="관리자 로그인">
      <LoginForm />
    </AuthShell>
  );
}
