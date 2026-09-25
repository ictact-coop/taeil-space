import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatKst } from "@/lib/time";
import { getDashboard } from "@/server/applications/dashboard";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "대시보드" };

function Stat({ label, value, href, tone = "default" }: { label: string; value: number; href: string; tone?: "default" | "alert" }) {
  return (
    <Link href={href} className={`rounded-lg border bg-white p-4 hover:border-navy ${tone === "alert" && value > 0 ? "border-danger/40" : "border-line"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone === "alert" && value > 0 ? "text-danger" : "text-navy"}`}>{value}</p>
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireAdmin();
  const { denied } = await searchParams;
  const d = await getDashboard(db);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="대시보드" />
      {denied && (
        <div className="mb-4">
          <Notice kind="warning">이 메뉴를 볼 권한이 없습니다.</Notice>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="신규 신청(결제 완료)" value={d.newApplications} href="/admin/applications?tab=todo" />
        <Stat label="검토중" value={d.reviewing} href="/admin/applications?tab=todo" />
        <Stat label="보완요청 중" value={d.revision} href="/admin/applications?tab=revision" />
        <Stat label="결제대기" value={d.pendingPayment} href="/admin/applications?tab=pending" />
        <Stat label={`심사 지연(${d.delayDays}일 이상)`} value={d.delayed} href="/admin/applications?tab=todo" tone="alert" />
        <Stat label="환불 처리 필요" value={d.refundTodo} href="/admin/refunds" tone="alert" />
        <Stat label="환불 실패" value={d.refundFailed} href="/admin/refunds" tone="alert" />
        <Stat label="알림 발송 실패" value={d.mailFailed} href="/admin/audit" tone="alert" />
      </div>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold text-navy">오늘 일정</h2>
        {d.todays.length === 0 && d.blocksToday.length === 0 ? (
          <p className="text-sm text-muted">오늘은 대관 일정이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {d.todays.map((t) => (
              <li key={t.applicationNo} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-28 text-xs text-muted">
                  {formatKst(t.startsAt).slice(-5)}–{formatKst(t.endsAt).slice(-5)}
                </span>
                <span className="font-medium">{t.spaceName}</span>
                <Link href={`/admin/applications/${t.applicationNo}`} className="text-navy underline">
                  {t.orgName} · {t.eventTitle}
                </Link>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {d.blocksToday.map((b, i) => (
              <li key={i} className="py-2 text-muted">
                {formatKst(b.startsAt).slice(-5)}–{formatKst(b.endsAt).slice(-5)} 기념관 일정: {b.reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
