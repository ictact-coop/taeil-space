import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, ReadOnlyNotice, ResultNotice } from "@/components/admin/ui";
import { closureTypeLabels, describeClosureRule } from "@/domain/calendar/closures";
import { kstDateOf } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { listClosureRules, toClosureRule } from "@/server/calendar/closure-service";
import { db } from "@/server/db/client";
import { listSpaces } from "@/server/spaces/service";
import { createClosureAction, deactivateClosureAction } from "./actions";
import { ClosureForm } from "./closure-form";
import { MonthPreview } from "./month-preview";

export const metadata: Metadata = { title: "휴관일" };

export default async function ClosuresPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; space?: string; inactive?: string; month?: string }>;
}) {
  const admin = await requireAdmin();
  const { done, error, space, inactive, month } = await searchParams;
  const editable = canManage(admin.role, "closures");
  const [rows, spaces] = await Promise.all([listClosureRules(db, { includeInactive: inactive === "1" }), listSpaces(db)]);
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
  const activeRules = rows.filter((r) => r.isActive).map(toClosureRule);
  const previewSpace = spaces.find((s) => s.id === space) ?? null;

  const today = kstDateOf(new Date());
  const start = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") ? month! : today.slice(0, 7);
  const [y, m] = start.split("-").map(Number) as [number, number];
  const monthAt = (offset: number) => {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  };
  const months = [0, 1, 2].map(monthAt);
  const monthParam = (offset: number) => {
    const { year, month: mo } = monthAt(offset);
    const params = new URLSearchParams({ month: `${year}-${String(mo).padStart(2, "0")}` });
    if (previewSpace) params.set("space", previewSpace.id);
    return `/admin/settings/closures?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="휴관일"
        description="정기 휴관 요일, 매년 같은 날, 특정 날짜·기간, 예외 개관일을 등록합니다. 휴관일은 이용자 달력에서 선택할 수 없고 안내 문구가 표시됩니다(BR-01, AT-01)."
        crumbs={[{ href: "/admin/settings", label: "정책 설정" }]}
      />
      <ResultNotice done={done} error={error} />
      {!editable && <ReadOnlyNotice />}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-navy">달력 미리보기</h2>
          <div className="flex items-center gap-2 text-sm">
            <Link href={monthParam(-3)} className="btn-ghost px-2 py-1 text-xs" aria-label="이전 3개월">
              ‹ 이전
            </Link>
            <Link href={monthParam(3)} className="btn-ghost px-2 py-1 text-xs" aria-label="다음 3개월">
              다음 ›
            </Link>
          </div>
          <form className="flex items-center gap-2 text-sm">
            <input type="hidden" name="month" value={start} />
            <label htmlFor="preview-space" className="text-muted">
              공간
            </label>
            <select id="preview-space" name="space" defaultValue={previewSpace?.id ?? ""} className="input w-auto py-1">
              <option value="">전체 공간 규칙만</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-ghost px-2 py-1 text-xs">
              보기
            </button>
          </form>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {months.map((mo) => (
            <MonthPreview key={`${mo.year}-${mo.month}`} {...mo} spaceId={previewSpace?.id ?? null} rules={activeRules} today={today} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">우선순위: 예외 개관일 &gt; 특정 날짜·기간 &gt; 매년 같은 날 &gt; 정기 휴관 요일</p>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-navy">규칙 목록</h2>
          <Link href={inactive === "1" ? "/admin/settings/closures" : "/admin/settings/closures?inactive=1"} className="text-xs text-navy underline">
            {inactive === "1" ? "꺼진 규칙 숨기기" : "꺼진 규칙도 보기"}
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">등록된 규칙이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className={r.isActive ? "" : "opacity-60"}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="badge bg-cream text-muted">{closureTypeLabels[r.type]}</span>
                    {r.name}
                    {!r.isActive && <span className="badge bg-cream-dark text-muted">꺼짐</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {describeClosureRule(r)} · {r.spaceId ? `${spaceName.get(r.spaceId) ?? "?"}만` : "전체 공간"}
                    {(r.activeFrom || r.activeUntil) && ` · 적용 ${r.activeFrom ?? "처음"} ~ ${r.activeUntil ?? "계속"}`}
                  </p>
                  <p className="mt-1 text-xs">안내: {r.publicMessage}</p>
                </div>
                {editable && r.isActive && (
                  <form action={deactivateClosureAction.bind(null, r.id)} className="flex shrink-0 items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs font-medium">
                      끄는 사유
                      <input name="reason" required minLength={2} className="input w-40 py-1" />
                    </label>
                    <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                      규칙 끄기
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editable && (
        <Card>
          <h2 className="mb-3 font-semibold text-navy">규칙 추가</h2>
          <ClosureForm action={createClosureAction} spaces={spaces.map((s) => ({ id: s.id, name: s.name }))} />
        </Card>
      )}
    </div>
  );
}
