import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/admin/ui";
import { roleLabels } from "@/lib/labels";
import { requireAdmin } from "@/server/auth/current";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { changePasswordAction } from "./actions";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "내 계정" };

export default async function MyAccountPage() {
  const admin = await requireAdmin();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="내 계정" description={`${admin.name} (${admin.loginId}) · ${roleLabels[admin.role]}`} />
      <Card>
        <h2 className="mb-1 font-semibold text-navy">비밀번호 변경</h2>
        <p className="mb-4 text-sm text-muted">{MIN_PASSWORD_LENGTH}자 이상, 영문과 숫자를 함께 넣습니다. 바꾸면 다른 기기의 로그인은 끊깁니다.</p>
        <ChangePasswordForm action={changePasswordAction} />
      </Card>
      <p className="text-sm text-muted">OTP 기기를 바꾸거나 역할을 바꾸려면 시스템 관리자에게 요청하세요.</p>
    </div>
  );
}
