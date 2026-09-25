import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, ResultNotice } from "@/components/admin/ui";
import { describeDiscount } from "@/domain/pricing/discount-input";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { listDiscountRules } from "@/server/pricing/discount-service";

export const metadata: Metadata = { title: "감면" };

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const admin = await requireAdmin();
  const { done } = await searchParams;
  const rules = await listDiscountRules(db);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="감면" description="감면 유형·비율 또는 금액·증빙 여부를 관리합니다 (P-07, ADM-008)." crumbs={[{ href: "/admin/settings", label: "정책 설정" }]} />
      <ResultNotice done={done} />
      {rules.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-5 text-sm text-muted">등록된 감면 규칙이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <Link href={`/admin/settings/discounts/${r.id}`} className="text-navy underline">
                  {r.name}
                </Link>
                <span className="badge bg-cream text-ink">{describeDiscount(r)}</span>
                {!r.isActive && <span className="badge bg-cream-dark text-muted">사용 안 함</span>}
              </p>
              <p className="text-xs text-muted">
                {r.description || "설명 없음"} · 증빙 {r.proofRequired ? `필수(${r.proofGuide})` : "필요 없음"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canManage(admin.role, "discounts") && (
        <Link href="/admin/settings/discounts/new" className="btn-secondary self-start">
          감면 규칙 추가
        </Link>
      )}
    </div>
  );
}
