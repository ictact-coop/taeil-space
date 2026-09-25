import type { Metadata } from "next";
import Link from "next/link";
import { formatMinutes, formatWon } from "@/domain/pricing/fee-schedule";
import { getPublicInfo } from "@/server/booking/public-data";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "공간 안내" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const { spaces, fee, photos } = await getPublicInfo(db);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-serif text-3xl text-navy">공간 안내</h1>
      <p className="mt-2 text-muted">공간별 정원·장비·신청 조건을 확인하세요.</p>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((space) => {
          const photo = photos.find((p) => p.spaceId === space.id);
          const f = fee?.items.spaces[space.id];
          return (
            <li key={space.id} className="flex flex-col overflow-hidden rounded-lg border border-line bg-white">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- 업로드된 사진을 그대로 보여 준다
                <img src={`/media/space-photos/${photo.id}`} alt={photo.alt} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-cream text-sm text-muted">사진 준비 중</div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h2 className="text-lg font-semibold text-navy">{space.name}</h2>
                <p className="text-sm">
                  최대 {space.capacity}명{space.minHeadcount ? ` · ${space.minHeadcount}명 이상` : ""} ·{" "}
                  {space.leadDays === null ? "공개된 접수기간에 신청" : `이용일 ${space.leadDays}일 전까지 신청`}
                </p>
                {space.equipment.length > 0 && <p className="text-xs text-muted">장비: {space.equipment.join(", ")}</p>}
                <p className="text-sm">{f ? `${formatMinutes(f.baseMinutes)} ${formatWon(f.baseFee)}부터` : "요금 확정 후 안내"}</p>
                <div className="mt-auto flex gap-2 pt-3">
                  <Link href={`/spaces/${space.code}`} className="btn-secondary flex-1">
                    상세·일정
                  </Link>
                  <Link href={`/apply?space=${space.code}`} className="btn-primary flex-1">
                    신청
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
