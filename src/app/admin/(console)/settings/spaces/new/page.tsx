import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { saveSpaceAction } from "../actions";
import { consentOptions } from "../consent-options";
import { SpaceForm } from "../space-form";

export const metadata: Metadata = { title: "공간 추가" };

export default async function NewSpacePage() {
  await requireAdmin(["system"]);
  return (
    <div>
      <PageHeader
        title="공간 추가"
        crumbs={[
          { href: "/admin/settings", label: "정책 설정" },
          { href: "/admin/settings/spaces", label: "공간" },
        ]}
      />
      <SpaceForm
        action={saveSpaceAction.bind(null, null)}
        editable
        consentOptions={consentOptions}
        initial={{
          code: "",
          name: "",
          capacity: "",
          minHeadcount: "",
          description: "",
          equipment: "",
          notice: "",
          leadDays: "14",
          slotMinutes: "60",
          minDurationMinutes: "60",
          bufferBeforeMinutes: "0",
          bufferAfterMinutes: "0",
          extraConsents: [],
          isPublic: "false",
          sortOrder: "10",
        }}
      />
    </div>
  );
}
