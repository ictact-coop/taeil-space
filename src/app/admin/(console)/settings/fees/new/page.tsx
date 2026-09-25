import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { toKstLocalInput } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { listFeeSchedules } from "@/server/pricing/fee-service";
import { listSpaces } from "@/server/spaces/service";
import { saveFeeScheduleAction } from "../actions";
import { FeeEditor } from "./fee-editor";

export const metadata: Metadata = { title: "새 요금표" };

export default async function NewFeeSchedulePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireAdmin(["system"]);
  const from = Number((await searchParams).from);
  const [versions, spaces] = await Promise.all([listFeeSchedules(db), listSpaces(db)]);
  const base = versions.find((v) => v.id === from)?.items ?? null;
  return (
    <div>
      <PageHeader
        title="새 요금표"
        description={base ? "선택한 버전의 값을 불러왔습니다. 고칠 부분만 바꾸고 저장하세요." : "모든 공개 공간의 요금을 입력하세요."}
        crumbs={[
          { href: "/admin/settings", label: "정책 설정" },
          { href: "/admin/settings/fees", label: "요금표" },
        ]}
      />
      <FeeEditor
        action={saveFeeScheduleAction}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name, isPublic: s.isPublic }))}
        initial={base}
        nowLocal={toKstLocalInput(new Date())}
      />
    </div>
  );
}
