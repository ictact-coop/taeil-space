import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, ResultNotice } from "@/components/admin/ui";
import { isSettingKey } from "@/domain/settings/definitions";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { computeReadiness, type ReadinessItem } from "@/server/settings/readiness";
import { canEditSetting } from "@/server/settings/service";
import { confirmSettingAction } from "./readiness-actions";

export const metadata: Metadata = { title: "정책 설정" };

const stateStyles: Record<ReadinessItem["state"], { label: string; className: string }> = {
  ok: { label: "완료", className: "bg-status-green/10 text-status-green" },
  confirm: { label: "확인 필요", className: "bg-warning/10 text-warning" },
  todo: { label: "입력 필요", className: "bg-danger/10 text-danger" },
};

export default async function SettingsIndexPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const items = await computeReadiness(db);
  const remaining = items.filter((i) => i.state !== "ok").length;

  return (
    <div>
      <PageHeader
        title="정책 설정"
        description="운영 정책을 코드 수정 없이 바꿀 수 있습니다. 모든 변경은 적용 시각과 사유가 함께 기록되며, 이미 결제된 신청에는 결제 당시의 규정이 그대로 적용됩니다."
      />
      <ResultNotice done={done} error={error} />
      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-navy">오픈 준비 점검</h2>
          <p className="text-sm text-muted">
            {remaining === 0 ? "오픈 전 필수 값이 모두 확정되었습니다." : `남은 항목 ${remaining}개 / 전체 ${items.length}개`}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const style = stateStyles[item.state];
            const confirmable =
              item.state === "confirm" && item.settingKey && isSettingKey(item.settingKey) && canEditSetting(admin.role, item.settingKey);
            return (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className={`badge ${style.className}`}>{style.label}</span>
                    <Link href={item.href} className="underline decoration-line underline-offset-2 hover:text-navy">
                      {item.label}
                    </Link>
                  </p>
                  <p className="mt-1 text-xs text-muted">{item.detail}</p>
                </div>
                {confirmable && (
                  <form action={confirmSettingAction} className="flex shrink-0 items-center gap-2">
                    <input type="hidden" name="key" value={item.settingKey} />
                    <input type="hidden" name="reason" value="오픈 준비 점검에서 현재 값으로 확정" />
                    <button type="submit" className="btn-secondary px-3 py-1 text-xs">
                      현재 값으로 확정
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
