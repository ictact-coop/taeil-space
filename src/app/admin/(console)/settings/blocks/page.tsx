import type { Metadata } from "next";
import { Card, PageHeader, ReadOnlyNotice, ResultNotice } from "@/components/admin/ui";
import { blockKindLabels } from "@/domain/calendar/block-input";
import { formatKst, toKstLocalInput } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { listUpcomingBlocks } from "@/server/calendar/block-service";
import { db } from "@/server/db/client";
import { listSpaces } from "@/server/spaces/service";
import { createBlockAction, deleteBlockAction } from "./actions";
import { BlockForm } from "./block-form";

export const metadata: Metadata = { title: "일정 차단" };

export default async function BlocksPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const { done, error } = await searchParams;
  const editable = canManage(admin.role, "blocks");
  const [blocks, spaces] = await Promise.all([listUpcomingBlocks(db), listSpaces(db)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="일정 차단"
        description="기념관 자체행사·시설점검·임시차단 시간을 등록합니다. 등록한 시간에는 신청을 받을 수 없고, 이미 신청·차단이 있는 시간과는 겹치게 등록할 수 없습니다(BR-02, AT-10)."
        crumbs={[{ href: "/admin/settings", label: "정책 설정" }]}
      />
      <ResultNotice done={done} error={error} />
      {!editable && <ReadOnlyNotice />}
      <Card>
        <h2 className="mb-3 font-semibold text-navy">예정된 차단</h2>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">예정된 차단이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {blocks.map(({ block, spaceName }) => (
              <li key={block.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="badge bg-cream text-muted">{blockKindLabels[block.kind]}</span>
                    {spaceName ?? "전체 공간"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatKst(block.startsAt)} ~ {formatKst(block.endsAt)}
                  </p>
                  <p className="mt-1 text-xs">{block.reason}</p>
                </div>
                {editable && (
                  <form action={deleteBlockAction.bind(null, block.id)} className="flex shrink-0 items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs font-medium">
                      해제 사유
                      <input name="reason" required minLength={2} className="input w-40 py-1" />
                    </label>
                    <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                      차단 해제
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
          <h2 className="mb-3 font-semibold text-navy">차단 등록</h2>
          <BlockForm action={createBlockAction} spaces={spaces.map((s) => ({ id: s.id, name: s.name }))} defaultStart={toKstLocalInput(new Date()).slice(0, 11) + "10:00"} />
        </Card>
      )}
    </div>
  );
}
