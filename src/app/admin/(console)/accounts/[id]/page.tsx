import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, Notice, PageHeader } from "@/components/admin/ui";
import { formatKst } from "@/lib/time";
import { listAdminAccounts } from "@/server/auth/accounts";
import { listGrades } from "@/server/auth/grades";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { AccountCommandForm, EditAccountForm } from "../account-forms";
import { accountCommandAction, updateAccountAction } from "../actions";

export const metadata: Metadata = { title: "계정 상세" };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("accounts.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [accounts, grades] = await Promise.all([listAdminAccounts(db), listGrades(db)]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  const self = account.id === admin.id;
  // 최고 관리자 계정은 최고 관리자만 조치한다
  const protectedSuper = account.gradeIsSuper && !admin.isSuper;
  const assignable = grades.filter((g) => admin.isSuper || !g.isSuper).map((g) => ({ id: g.id, name: g.name, description: g.description }));
  const current = { id: account.gradeId, name: account.gradeName, description: grades.find((g) => g.id === account.gradeId)?.description ?? "" };
  const gradeLocked = self ? "자기 계정의 등급은 다른 관리자가 바꿉니다." : protectedSuper ? "최고 관리자 계정의 등급은 최고 관리자만 바꿉니다." : null;
  const locked = account.lockedUntil && account.lockedUntil > new Date();
  const command = (action: Parameters<typeof accountCommandAction>[1]) => accountCommandAction.bind(null, account.id, action);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${account.name} (${account.loginId})`}
        description={`${account.gradeName} · ${account.isActive ? "사용 중" : "중지됨"} · 2단계 인증 ${account.totpEnabledAt ? `등록(${formatKst(account.totpEnabledAt)})` : "미등록"}${locked ? ` · ${formatKst(account.lockedUntil!)}까지 잠김` : ""}`}
        crumbs={[{ href: "/admin/accounts", label: "계정 관리" }]}
      />
      <Card>
        <h2 className="mb-3 font-semibold text-navy">기본 정보</h2>
        <EditAccountForm action={updateAccountAction.bind(null, account.id)} name={account.name} email={account.email} grade={current} grades={assignable} gradeLocked={gradeLocked} />
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold text-navy">계정 조치</h2>
        {self ? (
          <Notice kind="info">자기 계정은 여기서 초기화·중지할 수 없습니다. 비밀번호는 &lsquo;내 계정&rsquo;에서 바꾸세요.</Notice>
        ) : protectedSuper ? (
          <Notice kind="info">시스템 최고 관리자 계정은 최고 관리자만 초기화·중지할 수 있습니다.</Notice>
        ) : (
          <div className="divide-y divide-line">
            <AccountCommandForm
              action={command("reset-password")}
              title="임시 비밀번호 발급"
              description="비밀번호를 잊었을 때 씁니다. 잠금도 풀리고, 지금 로그인된 기기는 로그아웃됩니다."
              confirmLabel="기존 비밀번호를 쓸 수 없게 됩니다"
              button="임시 비밀번호 발급"
            />
            <AccountCommandForm
              action={command("reset-2fa")}
              title="2단계 인증 초기화"
              description="휴대전화를 바꿨거나 잃어버렸을 때 씁니다. 다음 로그인 때 OTP 앱을 다시 등록합니다."
              confirmLabel="본인 확인을 마쳤습니다"
              button="2단계 인증 초기화"
            />
            {account.isActive ? (
              <AccountCommandForm
                action={command("deactivate")}
                title="계정 중지"
                description="퇴사나 담당 변경 때 씁니다. 로그인할 수 없게 되고, 처리 이력과 감사 로그는 그대로 남습니다."
                confirmLabel="이 계정의 로그인을 막습니다"
                button="계정 중지"
                danger
              />
            ) : (
              <AccountCommandForm
                action={command("activate")}
                title="사용 재개"
                description="중지한 계정을 다시 쓸 수 있게 합니다."
                confirmLabel="이 계정을 다시 사용합니다"
                button="사용 재개"
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
