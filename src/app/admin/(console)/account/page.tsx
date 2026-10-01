import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { adminUsers } from "@/server/db/schema";
import { changeEmailAction, changePasswordAction } from "./actions";
import { ChangeEmailForm } from "./change-email-form";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "내 계정" };

export default async function MyAccountPage() {
  const admin = await requireAdmin();
  const [me] = await db.select({ email: adminUsers.email }).from(adminUsers).where(eq(adminUsers.id, admin.id));
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="내 계정" description={`${admin.name} (${admin.loginId}) · ${admin.gradeName}`} />
      <Card>
        <h2 className="mb-1 font-semibold text-navy">비밀번호 변경</h2>
        <p className="mb-4 text-sm text-muted">{MIN_PASSWORD_LENGTH}자 이상, 영문과 숫자를 함께 넣습니다. 바꾸면 다른 기기의 로그인은 끊깁니다.</p>
        <ChangePasswordForm action={changePasswordAction} />
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold text-navy">이메일</h2>
        <p className="mb-4 text-sm text-muted">
          아이디를 잊거나 비밀번호를 잊었을 때 로그인 화면에서 이 주소로 안내를 받습니다. {me?.email ? "" : "아직 등록하지 않았습니다."}
        </p>
        <ChangeEmailForm action={changeEmailAction} email={me?.email ?? null} />
      </Card>
      <p className="text-sm text-muted">OTP 기기를 바꾸거나 등급을 바꾸려면 계정 관리 담당자에게 요청하세요.</p>
    </div>
  );
}
