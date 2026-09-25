import type { Metadata } from "next";
import Link from "next/link";
import { auditActionLabels } from "@/lib/labels";
import { formatKst } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { listAuditLogs } from "@/server/audit/query";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "감사 로그" };

const PAGE_SIZE = 50;

function preview(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requireAdmin(["system"]);
  const before = Number((await searchParams).before);
  const rows = await listAuditLogs(db, { before, limit: PAGE_SIZE });
  const last = rows.at(-1)?.log.id;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold text-navy">감사 로그</h1>
      <p className="mt-1 mb-6 text-sm text-muted">로그인, 설정 변경 등 주요 행위 기록입니다. 기록은 수정하거나 지울 수 없습니다.</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2">시각</th>
              <th scope="col" className="px-4 py-2">처리자</th>
              <th scope="col" className="px-4 py-2">행위</th>
              <th scope="col" className="px-4 py-2">대상</th>
              <th scope="col" className="px-4 py-2">내용·사유</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ log, actorName }) => (
              <tr key={log.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs">{formatKst(log.createdAt)}</td>
                <td className="px-4 py-2">{actorName ?? (log.actorType === "system" ? "시스템" : "-")}</td>
                <td className="px-4 py-2">{auditActionLabels[log.action] ?? log.action}</td>
                <td className="px-4 py-2 text-xs">
                  {log.targetType}
                  {log.targetId && <div className="break-all text-muted">{log.targetId}</div>}
                </td>
                <td className="px-4 py-2 text-xs">
                  {log.before != null && <div className="break-all text-muted">이전 {preview(log.before)}</div>}
                  {log.after != null && <div className="break-all">이후 {preview(log.after)}</div>}
                  {log.reason && <div className="mt-1 text-ink">사유: {log.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === PAGE_SIZE && last && (
        <Link href={`/admin/audit?before=${last}`} className="btn-ghost mt-4">
          이전 기록 더 보기
        </Link>
      )}
    </div>
  );
}
