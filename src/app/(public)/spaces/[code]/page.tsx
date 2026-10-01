import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpaceCalendar } from "@/components/public/space-calendar";
import { formatMinutes, formatWon } from "@/domain/pricing/fee-schedule";
import { kstDateOf } from "@/lib/time";
import { getPublicInfo } from "@/server/booking/public-data";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const { spaces } = await getPublicInfo(db);
  const space = spaces.find((s) => s.code === code);
  return { title: space ? space.name : "공간" };
}

export default async function SpaceDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { spaces, fee, photos } = await getPublicInfo(db);
  const space = spaces.find((s) => s.code === code);
  if (!space) notFound();
  const f = fee?.items.spaces[space.id];
  const own = photos.filter((p) => p.spaceId === space.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav aria-label="위치" className="mb-3 text-sm text-muted">
        <Link href="/spaces" className="underline">
          공간 안내
        </Link>{" "}
        / {space.name}
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <h1 className="font-serif text-3xl text-navy">{space.name}</h1>
          {own.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {own.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element -- 업로드된 사진을 그대로 보여 준다
                <img key={p.id} src={`/media/space-photos/${p.id}`} alt={p.alt} className="aspect-[4/3] w-full rounded object-cover" />
              ))}
            </div>
          )}
          {space.description && <p>{space.description}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-line bg-white p-5 text-sm">
            <dt className="text-muted">정원</dt>
            <dd>
              {space.capacity}명{space.minHeadcount ? ` (${space.minHeadcount}명 이상일 때 신청 가능)` : ""}
            </dd>
            <dt className="text-muted">신청 조건</dt>
            <dd>{space.leadDays === null ? "기념관이 공개한 접수기간 안의 날짜만 신청할 수 있습니다." : `이용일 ${space.leadDays}일 전까지 신청해야 합니다.`}</dd>
            <dt className="text-muted">예약 단위</dt>
            <dd>
              {formatMinutes(space.slotMinutes)} 단위, 최소 {formatMinutes(space.minDurationMinutes)}
            </dd>
            {space.equipment.length > 0 && (
              <>
                <dt className="text-muted">기본 제공</dt>
                <dd>{space.equipment.join(", ")}</dd>
              </>
            )}
            <dt className="text-muted">요금</dt>
            <dd>
              {f
                ? `${formatMinutes(f.baseMinutes)} ${formatWon(f.baseFee)} · 추가 ${formatMinutes(f.extraUnitMinutes)}당 ${formatWon(f.extraFee)} · 야간 시간당 ${formatWon(f.nightFeePerHour)}`
                : "요금 확정 후 안내"}
            </dd>
            {space.notice && (
              <>
                <dt className="text-muted">유의사항</dt>
                <dd>{space.notice}</dd>
              </>
            )}
          </dl>
        </div>
        <aside className="rounded-lg border border-line bg-white p-5">
          <h2 className="mb-3 font-semibold text-navy">예약 현황</h2>
          <SpaceCalendar spaceId={space.id} initialMonth={kstDateOf(new Date()).slice(0, 7)} />
          <Link href={`/apply?space=${space.code}`} className="btn-primary mt-4 w-full">
            이 공간 신청하기
          </Link>
        </aside>
      </div>
    </div>
  );
}
