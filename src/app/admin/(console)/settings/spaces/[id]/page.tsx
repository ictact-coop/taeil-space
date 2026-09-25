import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, ReadOnlyNotice } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { getSpace } from "@/server/spaces/service";
import { saveSpaceAction } from "../actions";
import { consentOptions } from "../consent-options";
import { SpaceForm } from "../space-form";

export const metadata: Metadata = { title: "공간 설정" };

export default async function EditSpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const space = await getSpace(db, id);
  if (!space) notFound();
  const editable = canManage(admin.role, "spaces");
  return (
    <div>
      <PageHeader
        title={space.name}
        crumbs={[
          { href: "/admin/settings", label: "정책 설정" },
          { href: "/admin/settings/spaces", label: "공간" },
        ]}
      />
      {!editable && <ReadOnlyNotice />}
      <SpaceForm
        action={saveSpaceAction.bind(null, space.id)}
        editable={editable}
        consentOptions={consentOptions}
        initial={{
          code: space.code,
          name: space.name,
          capacity: String(space.capacity),
          minHeadcount: space.minHeadcount === null ? "" : String(space.minHeadcount),
          description: space.description,
          equipment: space.equipment.join(", "),
          notice: space.notice,
          leadDays: space.leadDays === null ? "" : String(space.leadDays),
          slotMinutes: String(space.slotMinutes),
          minDurationMinutes: String(space.minDurationMinutes),
          bufferBeforeMinutes: String(space.bufferBeforeMinutes),
          bufferAfterMinutes: String(space.bufferAfterMinutes),
          extraConsents: space.extraConsents,
          isPublic: String(space.isPublic),
          sortOrder: String(space.sortOrder),
        }}
      />
    </div>
  );
}
