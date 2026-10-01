import type { Metadata } from "next";
import { AuthShell, FormError } from "@/components/auth-shell";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { checkResetToken } from "@/server/auth/recovery";
import { db } from "@/server/db/client";
import { resetPasswordAction } from "../../recovery-actions";
import { RecoveryLinks } from "../../recovery-links";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "새 비밀번호 설정", referrer: "no-referrer" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await checkResetToken(db, token);
  return (
    <AuthShell title="새 비밀번호 설정">
      {check.ok ? (
        <>
          <p className="mb-4 text-sm text-muted">
            <strong className="text-ink">{check.loginId}</strong> 계정의 새 비밀번호를 정하세요. 바꾸면 이 계정의 다른 로그인은 모두 끊깁니다.
          </p>
          <NewPasswordForm action={resetPasswordAction.bind(null, token)} minLength={MIN_PASSWORD_LENGTH} />
        </>
      ) : (
        <FormError message={check.error} />
      )}
      <RecoveryLinks />
    </AuthShell>
  );
}
