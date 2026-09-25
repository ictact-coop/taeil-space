import type { Metadata } from "next";
import { Steps } from "@/components/public/steps";
import { isValidDateString } from "@/domain/calendar/closures";
import { kstDateOf } from "@/lib/time";
import { listPublicSpaces } from "@/server/booking/context";
import { db } from "@/server/db/client";
import { BookingPicker } from "./booking-picker";

export const metadata: Metadata = { title: "대관 신청" };
export const dynamic = "force-dynamic";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const spaces = await listPublicSpaces(db);
  const selected = spaces.find((s) => s.code === q.space) ?? null;
  const time = (v?: string) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold text-brick">대관 신청</p>
      <h1 className="mt-1 font-serif text-3xl text-navy">공간과 날짜를 선택해 주세요</h1>
      <div className="my-6">
        <Steps current={1} />
      </div>
      <BookingPicker
        spaces={spaces.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          capacity: s.capacity,
          minHeadcount: s.minHeadcount,
          leadDays: s.leadDays,
          summary: `최대 ${s.capacity}명${s.minHeadcount ? ` · ${s.minHeadcount}명 이상` : ""}${s.leadDays === null ? " · 접수기간 공개" : ` · ${s.leadDays}일 전 신청`}`,
        }))}
        initial={{
          spaceId: selected?.id ?? null,
          date: selected && q.date && isValidDateString(q.date) ? q.date : null,
          start: selected ? time(q.start) : null,
          end: selected ? time(q.end) : null,
        }}
        initialMonth={q.date && isValidDateString(q.date) ? q.date.slice(0, 7) : kstDateOf(new Date()).slice(0, 7)}
      />
    </div>
  );
}
