import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, ResultNotice } from "@/components/admin/ui";
import { normalizePermissions, permissionDefs } from "@/domain/auth/permissions";
import { requireAdmin } from "@/server/auth/current";
import { listGrades } from "@/server/auth/grades";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "등급 관리" };

const labelOf = Object.fromEntries(permissionDefs.map((d) => [d.key, d.label])) as Record<string, string>;

export default async function GradesPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  if (!admin.isSuper) redirect("/admin?denied=1");
  const { done, error } = await searchParams;
  const grades = await listGrades(db);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="등급 관리" description="관리자 등급과 등급별 권한을 정합니다. 바꾼 권한은 그 등급의 모든 계정에 바로 적용됩니다. 시스템 최고 관리자만 볼 수 있습니다." />
      <ResultNotice done={done} error={error} />
      <ul className="flex flex-col gap-3">
        {grades.map((g) => {
          const perms = normalizePermissions(g.permissions);
          return (
            <li key={g.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/grades/${g.id}`} className="text-lg font-semibold text-navy underline">
                  {g.name}
                </Link>
                <span className="text-xs text-muted">
                  계정 {g.activeCount}명{g.memberCount > g.activeCount ? ` (중지 ${g.memberCount - g.activeCount}명)` : ""}
                </span>
              </div>
              {g.description && <p className="mt-1 text-sm text-muted">{g.description}</p>}
              <p className="mt-3 flex flex-wrap gap-1">
                {g.isSuper ? (
                  <span className="badge bg-navy/10 text-navy">모든 권한</span>
                ) : perms.length === 0 ? (
                  <span className="badge bg-cream-dark text-muted">권한 없음</span>
                ) : (
                  perms.map((p) => (
                    <span key={p} className="badge bg-cream text-ink">
                      {labelOf[p]}
                    </span>
                  ))
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <div>
        <Link href="/admin/grades/new" className="btn-primary">
          새 등급
        </Link>
      </div>
    </div>
  );
}
