import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, ResultNotice } from "@/components/admin/ui";
import { extraConsentCatalog, isExtraConsentKey } from "@/domain/spaces/consents";
import { formatMinutes } from "@/domain/pricing/fee-schedule";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { listSpaces } from "@/server/spaces/service";

export const metadata: Metadata = { title: "공간 설정" };

export default async function SpacesPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const admin = await requireAdmin();
  const { done } = await searchParams;
  const spaces = await listSpaces(db);
  return (
    <div>
      <PageHeader title="공간" description="정원, 신청기한, 예약 시간 단위, 준비·철수 시간 등 공간별 조건입니다." crumbs={[{ href: "/admin/settings", label: "정책 설정" }]} />
      <ResultNotice done={done} />
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2">공간</th>
              <th scope="col" className="px-4 py-2">정원</th>
              <th scope="col" className="px-4 py-2">신청기한</th>
              <th scope="col" className="px-4 py-2">시간 단위 / 최소</th>
              <th scope="col" className="px-4 py-2">준비·철수</th>
              <th scope="col" className="px-4 py-2">추가 동의</th>
              <th scope="col" className="px-4 py-2">공개</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {spaces.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">
                  <Link href={`/admin/settings/spaces/${s.id}`} className="font-medium text-navy underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {s.capacity}명{s.minHeadcount ? ` (최소 ${s.minHeadcount}명)` : ""}
                </td>
                <td className="px-4 py-2">{s.leadDays === null ? "접수기간 공개" : `${s.leadDays}일 전까지`}</td>
                <td className="px-4 py-2">
                  {formatMinutes(s.slotMinutes)} / {formatMinutes(s.minDurationMinutes)}
                </td>
                <td className="px-4 py-2">
                  {s.bufferBeforeMinutes}분 / {s.bufferAfterMinutes}분
                </td>
                <td className="px-4 py-2 text-xs">
                  {s.extraConsents.filter(isExtraConsentKey).map((k) => extraConsentCatalog[k]).join(", ") || "-"}
                </td>
                <td className="px-4 py-2">{s.isPublic ? "공개" : <span className="text-muted">비공개</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage(admin.role, "spaces") && (
        <Link href="/admin/settings/spaces/new" className="btn-secondary mt-4">
          공간 추가
        </Link>
      )}
      <p className="mt-4 text-xs text-muted">공간 사진 등록은 첨부파일 저장소와 함께 단계 2에서 추가됩니다.</p>
    </div>
  );
}
