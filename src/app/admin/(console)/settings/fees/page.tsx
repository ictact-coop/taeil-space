import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, PageHeader, ReadOnlyNotice, ResultNotice } from "@/components/admin/ui";
import type { HistoryStatus } from "@/domain/settings/resolve";
import { formatKst } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { listFeeSchedules } from "@/server/pricing/fee-service";
import { listSpaces } from "@/server/spaces/service";
import { cancelFeeScheduleAction } from "./actions";
import { FeeTable } from "./fee-table";

export const metadata: Metadata = { title: "요금표" };

const badges: Record<HistoryStatus, { label: string; className: string } | null> = {
  active: { label: "적용 중", className: "bg-status-green/10 text-status-green" },
  scheduled: { label: "예약", className: "bg-cream text-warning" },
  cancelled: { label: "예약 취소됨", className: "bg-cream-dark text-muted" },
  superseded: { label: "적용 안 됨(대체됨)", className: "bg-cream-dark text-muted" },
  past: null,
};

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const editable = canManage(admin.role, "fees");
  const [versions, spaces] = await Promise.all([listFeeSchedules(db), listSpaces(db)]);
  const spaceList = spaces.map((s) => ({ id: s.id, name: s.name }));
  const active = versions.find((v) => v.status === "active");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="요금표"
        description="공간 기본요금 + 추가시간 요금 + 야간요금 + 옵션 − 감면 = 결제금액 ([요구] 16장). 요금표를 바꿔도 이미 결제한 신청의 금액은 바뀌지 않습니다."
        crumbs={[{ href: "/admin/settings", label: "정책 설정" }]}
      />
      <ResultNotice done={done} error={error} />
      {!editable && <ReadOnlyNotice />}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-navy">지금 적용 중인 요금표</h2>
          {editable && (
            <Link href={active ? `/admin/settings/fees/new?from=${active.id}` : "/admin/settings/fees/new"} className="btn-primary">
              {active ? "새 요금표 만들기" : "요금표 입력"}
            </Link>
          )}
        </div>
        {active?.items ? (
          <>
            <p className="mb-3 text-xs text-muted">{formatKst(active.effectiveFrom)}부터 적용</p>
            <FeeTable items={active.items} spaces={spaceList} />
          </>
        ) : (
          <Notice kind="warning">적용 중인 요금표가 없습니다. 요금표 없이는 신청을 받을 수 없습니다.</Notice>
        )}
      </Card>

      {versions.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold text-navy">버전 이력</h2>
          <ol className="flex flex-col gap-4">
            {versions.map((v) => {
              const badge = badges[v.status];
              return (
                <li key={v.id} className="rounded border border-line p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <strong>{formatKst(v.effectiveFrom)}부터</strong>
                    {badge && <span className={`badge ${badge.className}`}>{badge.label}</span>}
                    <span className="text-xs text-muted">
                      저장 {formatKst(v.createdAt)} · {v.createdByName ?? "시스템"} · 사유: {v.reason}
                    </span>
                  </div>
                  {v.items && v.status !== "cancelled" && v.status !== "superseded" && <FeeTable items={v.items} spaces={spaceList} />}
                  {editable && (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      {v.items && (
                        <Link href={`/admin/settings/fees/new?from=${v.id}`} className="btn-ghost px-2 py-1 text-xs">
                          이 버전을 불러와 새 요금표 만들기
                        </Link>
                      )}
                      {v.status === "scheduled" && (
                        <form action={cancelFeeScheduleAction.bind(null, v.id)} className="flex items-end gap-2">
                          <label className="flex flex-col gap-1 text-xs font-medium">
                            취소 사유
                            <input name="reason" required minLength={2} className="input w-40 py-1" />
                          </label>
                          <button type="submit" className="btn-secondary px-2 py-1 text-xs">
                            예약 취소
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}
