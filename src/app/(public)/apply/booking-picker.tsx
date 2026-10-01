"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SpaceCalendar } from "@/components/public/space-calendar";

export interface PickerSpace {
  id: string;
  code: string;
  name: string;
  capacity: number;
  minHeadcount: number | null;
  leadDays: number | null;
  summary: string;
}

interface DayAvailability {
  dateViolation: { message: string } | null;
  dayEnd: string;
  closing: string;
  nightEnabled: boolean;
  slotMinutes: number;
  minDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slots: { start: string; end: string; state: "free" | "pending" | "booked" | "blocked" | "past" }[];
  busy: { from: number; to: number }[];
}

interface Quote {
  violations: { code: string; message: string }[];
  price: { items: { label: string; amount: number }[]; total: number } | null;
  feeMissing: boolean;
  includesNight: boolean;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const slotLabel: Record<DayAvailability["slots"][number]["state"], string> = {
  free: "가능",
  pending: "신청진행",
  booked: "예약완료",
  blocked: "대관불가",
  past: "지난 시간",
};

export function BookingPicker({
  spaces,
  initial,
  initialMonth,
}: {
  spaces: PickerSpace[];
  initial: { spaceId: string | null; date: string | null; start: string | null; end: string | null };
  initialMonth: string;
}) {
  const [spaceId, setSpaceId] = useState<string | null>(initial.spaceId);
  const [date, setDate] = useState<string | null>(initial.date);
  const [start, setStart] = useState<string | null>(initial.start);
  const [end, setEnd] = useState<string | null>(initial.end);
  const [dayState, setDayState] = useState<{ key: string; data: DayAvailability } | null>(null);
  const [quoteState, setQuoteState] = useState<{ key: string; data: Quote } | null>(null);
  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const dayKey = `${spaceId}|${date}`;
  const day = dayState?.key === dayKey ? dayState.data : null;

  useEffect(() => {
    if (!spaceId || !date) return;
    let cancelled = false;
    fetch(`/api/spaces/${spaceId}/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: DayAvailability) => !cancelled && setDayState({ key: `${spaceId}|${date}`, data: d }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [spaceId, date]);

  /** 준비·철수 시간을 포함해 바쁜 구간과 겹치지 않는 연속 범위만 허용 */
  const endOptionsFor = useMemo(() => {
    return (startTime: string): string[] => {
      if (!day) return [];
      const s = toMin(startTime);
      const closing = toMin(day.closing);
      const result: string[] = [];
      for (let e = s + day.slotMinutes; e <= closing; e += day.slotMinutes) {
        const from = s - day.bufferBeforeMinutes;
        const to = e + day.bufferAfterMinutes;
        if (day.busy.some((b) => b.from < to && from < b.to)) break;
        if (e - s >= day.minDurationMinutes) result.push(toTime(e));
      }
      return result;
    };
  }, [day]);

  const startOptions = useMemo(
    () => (day && !day.dateViolation ? day.slots.filter((s) => s.state === "free" && endOptionsFor(s.start).length > 0).map((s) => s.start) : []),
    [day, endOptionsFor],
  );
  const endOptions = start ? endOptionsFor(start) : [];
  const validSelection = Boolean(space && date && start && end && startOptions.includes(start) && endOptions.includes(end));
  const quoteKey = validSelection ? `${spaceId}|${date}|${start}|${end}` : "";

  useEffect(() => {
    if (!quoteKey) return;
    const [sid, d, s, e] = quoteKey.split("|");
    let cancelled = false;
    fetch("/api/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: sid, date: d, start: s, end: e }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((q: Quote) => !cancelled && setQuoteState({ key: quoteKey, data: q }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quoteKey]);

  const quote = quoteState?.key === quoteKey && quoteKey ? quoteState.data : null;

  useEffect(() => {
    const params = new URLSearchParams();
    if (space) params.set("space", space.code);
    if (date) params.set("date", date);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    window.history.replaceState(null, "", `/apply${params.size ? `?${params.toString()}` : ""}`);
  }, [space, date, start, end]);

  const selectSpace = (id: string) => {
    setSpaceId(id);
    setDate(null);
    setStart(null);
    setEnd(null);
  };
  const canProceed = Boolean(quote && quote.violations.length === 0 && quote.price);
  const nextHref = canProceed ? `/apply/form?${new URLSearchParams({ space: space!.code, date: date!, start: start!, end: end! }).toString()}` : null;

  return (
    <div className="grid overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-[260px_1fr_280px]">
      <section className="border-b border-line p-5 lg:border-r lg:border-b-0" aria-labelledby="h-space">
        <h2 id="h-space" className="mb-3 font-medium">
          1. 공간 선택
        </h2>
        <ul className="flex flex-col gap-2">
          {spaces.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => selectSpace(s.id)}
                aria-pressed={s.id === spaceId}
                className={`w-full rounded border p-3 text-left ${s.id === spaceId ? "border-brick bg-brick/5" : "border-line hover:border-navy"}`}
              >
                <span className="block font-semibold text-navy">{s.name}</span>
                <span className="block text-xs text-muted">{s.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-b border-line p-5 lg:border-r lg:border-b-0" aria-labelledby="h-date">
        <h2 id="h-date" className="mb-1 font-medium">
          2. 날짜·시간 선택
        </h2>
        {!space ? (
          <p className="mt-4 text-sm text-muted">먼저 공간을 선택하세요.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              {space.leadDays === null ? `${space.name}은(는) 공개된 접수기간 안의 날짜만 신청할 수 있습니다.` : `${space.name}은(는) 이용일 ${space.leadDays}일 전까지 신청할 수 있습니다.`}
            </p>
            <SpaceCalendar
              key={space.id}
              spaceId={space.id}
              initialMonth={date?.slice(0, 7) ?? initialMonth}
              selectedDate={date}
              onSelect={(d) => {
                setDate(d);
                setStart(null);
                setEnd(null);
              }}
            />
            {date && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2 text-sm font-medium">{date} 시간</p>
                {!day ? (
                  <p className="text-xs text-muted">불러오는 중…</p>
                ) : day.dateViolation ? (
                  <p className="text-sm text-danger">{day.dateViolation.message}</p>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-1" aria-label="시간대별 상태">
                      {day.slots.map((s) => (
                        <span
                          key={s.start}
                          title={`${s.start}~${s.end} ${slotLabel[s.state]}`}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            s.state === "free" ? "bg-status-green/10 text-status-green" : s.state === "past" ? "bg-cream text-muted" : "bg-cream-dark text-muted line-through"
                          } ${toMin(s.start) >= toMin(day.dayEnd) ? "ring-1 ring-navy/30" : ""}`}
                        >
                          {s.start}
                          <span className="sr-only"> {slotLabel[s.state]}</span>
                        </span>
                      ))}
                    </div>
                    {startOptions.length === 0 ? (
                      <p className="text-sm text-muted">이날은 신청할 수 있는 시간이 없습니다.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1 text-sm font-medium">
                          시작
                          <select
                            className="input"
                            value={start ?? ""}
                            onChange={(e) => {
                              const s = e.target.value || null;
                              setStart(s);
                              const ends = s ? endOptionsFor(s) : [];
                              setEnd(ends[0] ?? null);
                            }}
                          >
                            <option value="">선택</option>
                            {startOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-medium">
                          종료
                          <select className="input" value={end ?? ""} onChange={(e) => setEnd(e.target.value || null)} disabled={!start}>
                            <option value="">선택</option>
                            {endOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                                {toMin(t) > toMin(day.dayEnd) ? " (야간)" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    {(day.bufferBeforeMinutes > 0 || day.bufferAfterMinutes > 0) && (
                      <p className="mt-2 text-xs text-muted">
                        준비 {day.bufferBeforeMinutes}분·철수 {day.bufferAfterMinutes}분을 포함해 앞뒤 일정과 겹치지 않는 시간만 고를 수 있습니다.
                      </p>
                    )}
                    {end && toMin(end) > toMin(day.dayEnd) && (
                      <p className="mt-2 rounded bg-cream px-3 py-2 text-xs">
                        야간({day.dayEnd} 이후)을 포함합니다. 신청서에 출입문 관리 담당자를 입력하고, 18:00 이전에 사용·철수 방법을 인계받아야 합니다.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="bg-cream p-5" aria-labelledby="h-summary">
        <p id="h-summary" className="text-xs font-semibold text-brick">
          선택한 대관
        </p>
        <p className="mt-2 font-serif text-2xl text-navy">{space?.name ?? "공간 미선택"}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">날짜</dt>
          <dd className="text-right font-medium">{date ?? "-"}</dd>
          <dt className="text-muted">시간</dt>
          <dd className="text-right font-medium">{start && end ? `${start}–${end}` : "-"}</dd>
        </dl>
        <div className="mt-4 border-t border-brick/30 pt-4" aria-live="polite">
          {quote?.violations.length ? (
            <ul className="flex flex-col gap-1 text-xs text-danger">
              {quote.violations.map((v) => (
                <li key={v.code}>{v.message}</li>
              ))}
            </ul>
          ) : quote?.feeMissing ? (
            <p className="text-sm text-muted">요금 확정 후 표시됩니다.</p>
          ) : quote?.price ? (
            <>
              <ul className="flex flex-col gap-1 text-xs">
                {quote.price.items.map((i) => (
                  <li key={i.label} className="flex justify-between gap-2">
                    <span>{i.label}</span>
                    <span>{won(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">예상 대관료</p>
              <p className="font-serif text-3xl text-brick">{won(quote.price.total)}</p>
              <p className="mt-1 text-xs text-muted">옵션·감면은 다음 단계에서 고를 수 있습니다.</p>
            </>
          ) : (
            <p className="text-sm text-muted">공간·날짜·시간을 고르면 예상 금액을 보여 드립니다.</p>
          )}
        </div>
        {nextHref ? (
          <Link href={nextHref} className="btn-primary mt-5 w-full">
            다음: 신청정보 입력 →
          </Link>
        ) : (
          <button type="button" disabled className="btn-primary mt-5 w-full">
            다음: 신청정보 입력 →
          </button>
        )}
      </aside>
    </div>
  );
}
