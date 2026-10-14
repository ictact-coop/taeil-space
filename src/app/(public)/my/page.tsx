import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { getCurrentApplicant } from "@/server/applicant/current";
import { listApplicationsForPrincipal } from "@/server/booking/access";
import { db } from "@/server/db/client";
import { logoutAction } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "나의 대관" };
export const dynamic = "force-dynamic";

export default async function MyPage() {
  const me = await getCurrentApplicant();
  if (!me) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="font-serif text-3xl text-navy">나의 대관</h1>
        <p className="mt-2 mb-6 text-sm text-muted">신청할 때 적은 휴대전화 번호와 비밀번호로 신청 내역을 볼 수 있습니다.</p>
        <div className="rounded-lg border border-line bg-white p-6">
          <LoginForm />
        </div>
      </div>
    );
  }
  const rows = await listApplicationsForPrincipal(db, me);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-3xl text-navy">나의 대관</h1>
        <form action={logoutAction} className="text-sm text-muted">
          {me.label} ·{" "}
          <button type="submit" className="underline">
            나가기
          </button>
        </form>
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line bg-white p-6 text-sm text-muted">신청 내역이 없습니다.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map(({ application: a, spaceName }) => (
            <li key={a.id}>
              <Link href={`/my/${a.applicationNo}`} className="flex flex-col gap-1 rounded-lg border border-line bg-white p-4 hover:border-navy sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="text-xs text-brick">{a.applicationNo}</span>
                  <span className="block font-semibold text-navy">
                    {spaceName} · {a.eventTitle}
                  </span>
                  <span className="text-xs text-muted">
                    {formatKst(a.startsAt)}–{formatKst(a.endsAt).slice(-5)} · {formatWon(a.totalAmount ?? 0)}
                  </span>
                </span>
                <StatusBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
