import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/admin/ui";
import { roleLabels } from "@/lib/labels";
import { formatKst } from "@/lib/time";
import { listAdminAccounts } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { CreateAccountForm } from "./account-forms";
import { createAccountAction } from "./actions";

export const metadata: Metadata = { title: "계정 관리" };

export default async function AccountsPage() {
  const admin = await requireAdmin(["system"]);
  const accounts = await listAdminAccounts(db);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="계정 관리" description="관리자 계정을 만들고 역할을 정합니다. 모든 변경은 감사 로그에 남습니다." />
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2">아이디</th>
              <th scope="col" className="px-4 py-2">이름</th>
              <th scope="col" className="px-4 py-2">역할</th>
              <th scope="col" className="px-4 py-2">상태</th>
              <th scope="col" className="px-4 py-2">최근 활동</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {accounts.map((a) => {
              const locked = a.lockedUntil && a.lockedUntil > now;
              return (
                <tr key={a.id} className={a.isActive ? "hover:bg-cream/40" : "bg-cream/30 text-muted"}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/accounts/${a.id}`} className="font-medium text-navy underline">
                      {a.loginId}
                    </Link>
                    {a.id === admin.id && <span className="ml-2 text-xs text-muted">(나)</span>}
                  </td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2">{roleLabels[a.role]}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {a.isActive ? <span className="badge bg-status-green/10 text-status-green">사용</span> : <span className="badge bg-cream-dark text-muted">중지</span>}
                      {!a.totpEnabledAt && <span className="badge bg-warning/10 text-warning">OTP 미등록</span>}
                      {locked && <span className="badge bg-danger/10 text-danger">잠김</span>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{a.lastSeenAt ? formatKst(new Date(a.lastSeenAt)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Card>
        <h2 className="mb-1 font-semibold text-navy">새 계정</h2>
        <p className="mb-4 text-sm text-muted">임시 비밀번호가 한 번 표시됩니다. 첫 로그인 때 2단계 인증(OTP 앱) 등록을 요구합니다.</p>
        <CreateAccountForm action={createAccountAction} />
      </Card>
    </div>
  );
}
