"use client";

import { useEffect, useState } from "react";

type DayState = "available" | "partial" | "in_progress" | "booked" | "unavailable";
interface CalendarDay {
  date: string;
  state: DayState;
  reason?: string;
}

/** 이용자 달력 상태: 색과 문자를 함께 표시한다(NFR-02). 단체명은 보여 주지 않는다(USR-003). */
export const dayStateInfo: Record<DayState, { label: string; className: string; selectable: boolean }> = {
  available: { label: "예약가능", className: "bg-white border-status-green/50 text-ink hover:border-status-green", selectable: true },
  partial: { label: "일부가능", className: "bg-white border-status-green/40 text-ink hover:border-status-green", selectable: true },
  in_progress: { label: "신청진행", className: "bg-warning/10 border-transparent text-warning", selectable: false },
  booked: { label: "예약완료", className: "bg-navy/10 border-transparent text-navy", selectable: false },
  unavailable: { label: "대관불가", className: "bg-cream-dark/50 border-transparent text-muted line-through decoration-muted/50", selectable: false },
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function SpaceCalendar({
  spaceId,
  initialMonth,
  selectedDate,
  onSelect,
}: {
  spaceId: string;
  initialMonth: string;
  selectedDate?: string | null;
  onSelect?: (date: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<{ key: string; days: CalendarDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const key = `${spaceId}:${month}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/spaces/${spaceId}/calendar?month=${month}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as { days: CalendarDay[] };
      })
      .then((d) => {
        if (!cancelled) {
          setData({ key, days: d.days });
          setError(null);
        }
      })
      .catch(() => !cancelled && setError("달력을 불러오지 못했습니다. 잠시 후 다시 시도하세요."));
    return () => {
      cancelled = true;
    };
  }, [spaceId, month, key]);

  const days = data?.key === key ? data.days : null;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className="btn-ghost px-2 py-1" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">
          ‹
        </button>
        <p className="font-semibold text-navy" aria-live="polite">
          {y}년 {m}월
        </p>
        <button type="button" className="btn-ghost px-2 py-1" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">
          ›
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`${y}년 ${m}월 대관 달력`} aria-busy={!days}>
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <div key={w} role="columnheader" className="py-1 text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {(days ?? []).map((d) => {
          const info = dayStateInfo[d.state];
          const day = Number(d.date.slice(8));
          const selected = selectedDate === d.date;
          const label = `${d.date} ${info.label}${d.reason ? `: ${d.reason}` : ""}`;
          return (
            <button
              key={d.date}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected}
              aria-disabled={!info.selectable}
              title={d.reason ?? info.label}
              onClick={() => {
                if (info.selectable) {
                  setMessage(null);
                  onSelect?.(d.date);
                } else setMessage(`${d.date}: ${d.reason ?? info.label}`);
              }}
              className={`min-h-12 rounded border px-0.5 py-1 ${info.className} ${selected ? "!border-brick !bg-brick !text-white" : ""} ${
                info.selectable ? "cursor-pointer" : "cursor-not-allowed"
              }`}
            >
              <span className="block text-sm font-medium">{day}</span>
              <span className="block text-[10px] leading-tight no-underline">{info.label}</span>
            </button>
          );
        })}
      </div>
      {!days && !error && <p className="mt-2 text-xs text-muted">불러오는 중…</p>}
      {message && (
        <p role="status" className="mt-2 rounded bg-cream px-3 py-2 text-xs">
          {message}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted" aria-label="달력 표시 설명">
        {(Object.keys(dayStateInfo) as DayState[]).map((s) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded border ${dayStateInfo[s].className}`} aria-hidden />
            {dayStateInfo[s].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
