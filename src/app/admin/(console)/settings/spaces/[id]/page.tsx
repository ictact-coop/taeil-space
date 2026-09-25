import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, ReadOnlyNotice } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { getSpace } from "@/server/spaces/service";
import { listSpacePhotos } from "@/server/spaces/photos";
import { Card } from "@/components/admin/ui";
import { deletePhotoAction } from "./photo-actions";
import { PhotoUploader } from "./photo-manager";
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
  const photos = await listSpacePhotos(db, space.id);
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
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">공간 사진</h2>
        {photos.length === 0 ? (
          <p className="mb-3 text-sm text-muted">등록된 사진이 없습니다. 이용자 화면에는 “사진 준비 중”으로 보입니다.</p>
        ) : (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element -- 업로드한 사진 미리보기 */}
                <img src={`/media/space-photos/${p.id}`} alt={p.alt} className="aspect-[4/3] w-full rounded object-cover" />
                <span className="text-muted">{p.alt}</span>
                {editable && (
                  <form action={deletePhotoAction.bind(null, space.id, p.id)}>
                    <button type="submit" className="text-danger underline">
                      삭제
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && <PhotoUploader spaceId={space.id} />}
      </Card>
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
