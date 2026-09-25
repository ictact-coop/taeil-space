import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, PageHeader, ReadOnlyNotice, ResultNotice } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { getBookingWindowView, listWindowSpaces } from "@/server/calendar/booking-window-service";
import { db } from "@/server/db/client";
import { extendWindowAction, setWindowAction } from "./actions";

export const metadata: Metadata = { title: "교육실 접수기간" };

export default async function BookingWindowsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const editable = canManage(admin.role, "bookingWindows");
  const spaces = await listWindowSpaces(db);
  const views = await Promise.all(spaces.map(async (s) => ({ space: s, view: await getBookingWindowView(db, s.id) })));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="교육실 접수기간"
        description="신청기한 대신 담당자가 공개한 기간 안에서만 신청받는 공간입니다(AT-04). 공간 설정에서 신청기한을 비운 공간이 여기에 나타납니다."
        crumbs={[{ href: "/admin/settings", label: "정책 설정" }]}
      />
      <ResultNotice done={done} error={error} />
      {!editable && <ReadOnlyNotice />}
      {views.length === 0 && <Notice kind="info">접수기간으로 운영하는 공간이 없습니다.</Notice>}
      {views.map(({ space, view }) => (
        <Card key={space.id}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-navy">{space.name}</h2>
            <p className="text-xs text-muted">
              공개 방식: {view.mode === "auto" ? `자동(오늘부터 ${view.autoDays}일)` : "담당자가 직접 공개"} ·{" "}
              <Link href="/admin/settings/schedule" className="underline">
                방식 바꾸기
              </Link>
            </p>
          </div>
          <p className="text-sm">
            지금 신청 가능한 기간:{" "}
            {view.effective ? (
              <strong className="text-status-green">
                {view.effective.from} ~ {view.effective.until}
              </strong>
            ) : (
              <strong className="text-danger">없음 — 신청을 받을 수 없습니다</strong>
            )}
          </p>
          {view.mode === "manual" && view.manual && (
            <p className="mt-1 text-xs text-muted">
              마지막으로 공개한 기간: {view.manual.opensFrom} ~ {view.manual.opensUntil}
            </p>
          )}
          {view.mode === "auto" && <p className="mt-1 text-xs text-muted">자동 방식에서는 아래 수동 공개 기간이 쓰이지 않습니다.</p>}

          {editable && view.mode === "manual" && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <form action={extendWindowAction.bind(null, space.id)} className="flex flex-col gap-2 rounded border border-line p-4">
                <p className="text-sm font-medium">{view.extendDays}일 연장</p>
                <p className="text-xs text-muted">
                  {view.manual && view.manual.opensUntil >= view.today ? `종료일을 ${view.extendDays}일 늦춥니다.` : `오늘부터 ${view.extendDays}일 동안 엽니다.`}
                </p>
                <input name="reason" required minLength={2} placeholder="변경 사유" aria-label="연장 사유" className="input" defaultValue="정기 접수기간 연장" />
                <button type="submit" className="btn-primary self-start">
                  {view.extendDays}일 연장
                </button>
              </form>
              <form action={setWindowAction.bind(null, space.id)} className="flex flex-col gap-2 rounded border border-line p-4">
                <p className="text-sm font-medium">직접 설정</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    시작일
                    <input name="opensFrom" type="date" required defaultValue={view.effective?.from ?? view.today} className="input" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    종료일
                    <input name="opensUntil" type="date" required defaultValue={view.effective?.until ?? ""} className="input" />
                  </label>
                </div>
                <input name="reason" required minLength={2} placeholder="변경 사유" aria-label="변경 사유" className="input" />
                <button type="submit" className="btn-secondary self-start">
                  저장
                </button>
              </form>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
