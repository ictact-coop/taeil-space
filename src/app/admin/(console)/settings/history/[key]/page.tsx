import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { settingGroups } from "@/domain/settings/define";
import { getDefinition, isSettingKey } from "@/domain/settings/definitions";
import { classifyHistory, type HistoryStatus } from "@/domain/settings/resolve";
import { formatKst } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { canEditSetting, getSettingHistory } from "@/server/settings/service";
import { cancelScheduledAction, revertAction } from "./actions";

export const metadata: Metadata = { title: "설정 변경 이력" };

const statusBadges: Record<HistoryStatus, { label: string; className: string } | null> = {
  active: { label: "적용 중", className: "bg-status-green/10 text-status-green" },
  scheduled: { label: "예약", className: "bg-cream text-warning" },
  cancelled: { label: "예약 취소됨", className: "bg-cream-dark text-muted" },
  superseded: { label: "적용 안 됨(대체됨)", className: "bg-cream-dark text-muted" },
  past: null,
};

export default async function SettingHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const key = decodeURIComponent((await params).key);
  if (!isSettingKey(key)) notFound();
  const { done, error } = await searchParams;
  const admin = await requireAdmin();
  const def = getDefinition(key);
  const editable = canEditSetting(admin.role, key);
  const history = await getSettingHistory(db, key);
  const now = new Date();
  const statuses = classifyHistory(
    history.map((h) => ({ id: h.id, key, value: h.value, effectiveFrom: h.effectiveFrom })),
    now,
    def.defaultValue,
  );

  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="위치" className="mb-2 text-sm text-muted">
        <Link href="/admin/settings" className="underline">
          정책 설정
        </Link>{" "}
        /{" "}
        <Link href={`/admin/settings/${def.group}`} className="underline">
          {settingGroups[def.group].label}
        </Link>{" "}
        / 변경 이력
      </nav>
      <h1 className="text-2xl font-bold text-navy">{def.label}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">기본값: {def.format(def.defaultValue)}</p>

      {done && (
        <p role="status" className="mb-4 rounded border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {history.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-5 text-sm text-muted">아직 변경된 적이 없습니다. 기본값을 적용 중입니다.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {history.map((h) => {
            const status = statuses.get(h.id) ?? "past";
            const badge = statusBadges[status];
            const canCancel = status === "scheduled";
            const canRevert = status === "past";
            return (
              <li key={h.id} className="rounded-lg border border-line bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-ink">{h.displayValue}</strong>
                  {badge && <span className={`badge ${badge.className}`}>{badge.label}</span>}
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
                  <dt>적용 시작</dt>
                  <dd>{formatKst(h.effectiveFrom)}</dd>
                  <dt>저장</dt>
                  <dd>
                    {formatKst(h.createdAt)} · {h.createdByName ?? "시스템"}
                  </dd>
                  <dt>사유</dt>
                  <dd className="text-ink">{h.reason}</dd>
                </dl>
                {editable && (canCancel || canRevert) && (
                  <form
                    action={(canCancel ? cancelScheduledAction : revertAction).bind(null, key)}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="policyValueId" value={h.id} />
                    <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                      {canCancel ? "취소 사유" : "되돌리는 사유"}
                      <input name="reason" required minLength={2} maxLength={500} className="input" />
                    </label>
                    <button type="submit" className="btn-secondary">
                      {canCancel ? "예약 취소" : "이 값으로 되돌리기"}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
