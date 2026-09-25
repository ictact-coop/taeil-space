import type { Metadata } from "next";
import Link from "next/link";
import { settingGroups, type SettingGroup } from "@/domain/settings/define";
import { getDefinition, settingKeys } from "@/domain/settings/definitions";
import { upcomingRows } from "@/domain/settings/resolve";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { loadPolicyRows } from "@/server/settings/service";

export const metadata: Metadata = { title: "정책 설정" };

export default async function SettingsIndexPage() {
  await requireAdmin();
  const rows = await loadPolicyRows(db);
  const now = new Date();
  const groups = Object.entries(settingGroups) as [SettingGroup, (typeof settingGroups)[SettingGroup]][];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-navy">정책 설정</h1>
      <p className="mt-2 text-sm text-muted">
        운영 정책을 코드 수정 없이 바꿀 수 있습니다. 모든 변경은 적용 시작 시각과 사유가 함께 기록되며, 이미 결제된
        신청에는 결제 당시의 규정이 그대로 적용됩니다.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {groups.map(([id, group]) => {
          const keys = settingKeys.filter((k) => getDefinition(k).group === id);
          const scheduled = keys.reduce((n, k) => n + upcomingRows(rows, k, now, getDefinition(k).defaultValue).length, 0);
          return (
            <li key={id}>
              <Link
                href={`/admin/settings/${id}`}
                className="block h-full rounded-lg border border-line bg-white p-5 hover:border-navy"
              >
                <p className="font-semibold text-navy">{group.label}</p>
                <p className="mt-1 text-sm text-muted">{group.description}</p>
                <p className="mt-3 flex gap-2 text-xs text-muted">
                  <span>{keys.length}개 항목</span>
                  {scheduled > 0 && <span className="badge bg-cream text-warning">예약된 변경 {scheduled}건</span>}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-xs text-muted">
        공간·휴관일·요금표·감면·시점별 환불률은 전용 화면으로 추가될 예정입니다(단계 1).
      </p>
    </div>
  );
}
