"use client";

import { useState } from "react";

interface Row {
  id: number;
  daysBefore: string;
  percent: string;
}

function parseInitial(initial: string): Row[] {
  try {
    const parsed: unknown = JSON.parse(initial || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t, i) => ({
      id: i,
      daysBefore: String((t as { daysBefore?: unknown }).daysBefore ?? ""),
      percent: String((t as { percent?: unknown }).percent ?? ""),
    }));
  } catch {
    return [];
  }
}

/** 시점별 환불률표 편집. 제출값은 hidden input에 JSON으로 담는다. */
export function TiersInput({
  name,
  initial,
  disabled,
  describedBy,
  labelledBy,
}: {
  name: string;
  initial: string;
  disabled: boolean;
  describedBy?: string;
  labelledBy: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => parseInitial(initial));
  const [nextId, setNextId] = useState(1000);
  const toNumber = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  const json = JSON.stringify(rows.map((r) => ({ daysBefore: toNumber(r.daysBefore), percent: toNumber(r.percent) })));

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex flex-col gap-2">
      {!disabled && <input type="hidden" name={name} value={json} />}
      {rows.length === 0 && <p className="text-sm text-muted">구간이 없습니다. 구간을 추가하세요.</p>}
      {rows.map((row, i) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="sr-only">구간 {i + 1}</span>
          <span>이용일</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            aria-label={`구간 ${i + 1} 남은 일수`}
            value={row.daysBefore}
            onChange={(e) => update(row.id, { daysBefore: e.target.value })}
            disabled={disabled}
            className="input w-20"
          />
          <span>일 전까지</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            aria-label={`구간 ${i + 1} 환불률`}
            value={row.percent}
            onChange={(e) => update(row.id, { percent: e.target.value })}
            disabled={disabled}
            className="input w-20"
          />
          <span>% 환불</span>
          {!disabled && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}>
              삭제
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <div>
          <button
            type="button"
            className="btn-secondary px-3 py-1 text-xs"
            onClick={() => {
              setRows((rs) => [...rs, { id: nextId, daysBefore: "", percent: "" }]);
              setNextId((n) => n + 1);
            }}
          >
            구간 추가
          </button>
          <p className="mt-1 text-xs text-muted">0일 전은 이용 당일을 뜻합니다. 저장하면 일수가 큰 순서로 정렬됩니다.</p>
        </div>
      )}
    </div>
  );
}
