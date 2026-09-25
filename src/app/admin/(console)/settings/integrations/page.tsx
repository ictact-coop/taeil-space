import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { getIntegrationStatuses } from "@/server/integrations/status";

export const metadata: Metadata = { title: "연동 상태" };

export default async function IntegrationsPage() {
  await requireAdmin();
  const items = getIntegrationStatuses();
  return (
    <div>
      <PageHeader
        title="연동 상태"
        description="외부 서비스 연결 설정 여부입니다. 키 값은 보안상 화면에 표시하지 않으며, 서버 환경변수로만 설정합니다."
        crumbs={[{ href: "/admin/settings", label: "정책 설정" }]}
      />
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col gap-1 p-4">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {i.label}
              <span className={`badge ${i.configured ? "bg-status-green/10 text-status-green" : "bg-cream-dark text-muted"}`}>
                {i.configured ? `설정됨 · ${i.mode}` : "미설정"}
              </span>
              <span className="text-xs font-normal text-muted">구현: {i.stage}</span>
            </p>
            <p className="text-xs text-muted">{i.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
