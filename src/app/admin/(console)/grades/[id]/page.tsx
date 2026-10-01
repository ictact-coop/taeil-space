import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, Notice, PageHeader, ResultNotice } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { CLUB_GRADE_CODE, listGrades } from "@/server/auth/grades";
import { db } from "@/server/db/client";
import { deleteGradeAction, updateGradeAction } from "../actions";
import { GradeForm } from "../grade-form";

export const metadata: Metadata = { title: "등급 수정" };

export default async function GradeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  if (!admin.isSuper) redirect("/admin?denied=1");
  const [{ id }, { done, error }] = await Promise.all([params, searchParams]);
  const grade = (await listGrades(db)).find((g) => g.id === id);
  if (!grade) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={grade.name} description={`계정 ${grade.activeCount}명이 이 등급을 씁니다.`} crumbs={[{ href: "/admin/grades", label: "등급 관리" }]} />
      <ResultNotice done={done} error={error} />
      <Card>
        <GradeForm
          action={updateGradeAction.bind(null, grade.id)}
          name={grade.name}
          description={grade.description}
          permissions={grade.permissions}
          isSuper={grade.isSuper}
          fixedNotice={
            grade.code === CLUB_GRADE_CODE
              ? "동아리 운영자 등급은 '대관 일정 조회'만 할 수 있도록 고정되어 있습니다. 캘린더에서 시간·공간과 예약 여부만 보이고, 단체명과 신청자 정보는 보이지 않습니다. 더 많은 권한이 필요한 외부 사용자는 새 등급을 만들어 지정하세요."
              : undefined
          }
          submitLabel="저장"
        />
      </Card>
      {!grade.isSuper && (
        <Card>
          <h2 className="mb-1 font-semibold text-navy">등급 삭제</h2>
          {grade.memberCount > 0 ? (
            <Notice kind="info">
              이 등급을 쓰는 계정이 {grade.memberCount}개 있어 지울 수 없습니다. <Link href="/admin/accounts" className="underline">계정 관리</Link>에서 다른 등급으로 옮긴 뒤 지우세요.
            </Notice>
          ) : (
            <form action={deleteGradeAction.bind(null, grade.id)} className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" required />
                이 등급을 지웁니다
              </label>
              <button type="submit" className="btn-secondary border-danger text-danger">
                등급 삭제
              </button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
