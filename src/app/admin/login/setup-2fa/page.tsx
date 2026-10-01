import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AuthShell } from "@/components/auth-shell";
import { requirePendingMfa } from "@/server/auth/current";
import { readPendingTotpSecret, startTotpEnrollment } from "@/server/auth/service";
import { totpUri } from "@/server/auth/totp";
import { db } from "@/server/db/client";
import { confirmEnrollmentAction } from "../actions";
import { CodeForm } from "../code-form";

export const metadata: Metadata = { title: "2단계 인증 등록" };

export default async function SetupTwoFactorPage() {
  const current = await requirePendingMfa();
  if (current.user.totpEnabledAt) redirect("/admin/login/verify");

  // 새로고침해도 같은 QR이 보이도록, 확인 전 비밀키가 있으면 그대로 쓴다.
  const secret = readPendingTotpSecret(current.user) ?? (await startTotpEnrollment(db, current.user.id));
  const qr = await QRCode.toDataURL(totpUri(secret, current.user.loginId), { margin: 1, width: 200 });

  return (
    <AuthShell title="2단계 인증 등록">
      <ol className="mb-5 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>휴대전화에 인증 앱(Google Authenticator, Microsoft Authenticator 등)을 설치합니다.</li>
        <li>앱에서 아래 QR 코드를 찍습니다.</li>
        <li>앱에 표시된 6자리 코드를 입력합니다.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR 이미지 */}
      <img src={qr} alt="인증 앱 등록용 QR 코드" width={200} height={200} className="mx-auto mb-3" />
      <details className="mb-5 text-xs text-muted">
        <summary className="cursor-pointer">QR 코드를 찍을 수 없나요?</summary>
        <p className="mt-2">앱에서 “설정 키 입력”을 고르고 아래 키를 입력하세요.</p>
        <code className="mt-1 block break-all rounded bg-cream px-2 py-1 font-mono text-ink">{secret}</code>
      </details>
      <CodeForm action={confirmEnrollmentAction} submitLabel="등록 완료" />
    </AuthShell>
  );
}
