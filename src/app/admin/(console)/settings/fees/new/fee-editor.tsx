"use client";

import { useActionState, useMemo, useState } from "react";
import { str } from "@/components/admin/form-state";
import { Notice } from "@/components/admin/ui";
import type { FeeScheduleItems } from "@/domain/pricing/fee-schedule";
import type { FeeFormState } from "../actions";

type Action = (prev: FeeFormState, form: FormData) => Promise<FeeFormState>;
type SpaceRow = { baseMinutes: string; baseFee: string; extraUnitMinutes: string; extraFee: string; nightFeePerHour: string };
type OptionRow = { key: string; name: string; fee: string; unit: "per_booking" | "per_hour" };

const fields: { key: keyof SpaceRow; label: string; unit: string }[] = [
  { key: "baseMinutes", label: "기본시간", unit: "분" },
  { key: "baseFee", label: "기본요금", unit: "원" },
  { key: "extraUnitMinutes", label: "추가 단위", unit: "분" },
  { key: "extraFee", label: "추가요금", unit: "원" },
  { key: "nightFeePerHour", label: "야간 시간당", unit: "원" },
];

function toRows(items: FeeScheduleItems | null, spaces: { id: string }[]) {
  const rows: Record<string, SpaceRow> = {};
  for (const s of spaces) {
    const f = items?.spaces[s.id];
    rows[s.id] = f
      ? { baseMinutes: String(f.baseMinutes), baseFee: String(f.baseFee), extraUnitMinutes: String(f.extraUnitMinutes), extraFee: String(f.extraFee), nightFeePerHour: String(f.nightFeePerHour) }
      : { baseMinutes: "180", baseFee: "", extraUnitMinutes: "60", extraFee: "", nightFeePerHour: "" };
  }
  const options: OptionRow[] = (items?.options ?? []).map((o) => ({ key: o.key, name: o.name, fee: String(o.fee), unit: o.unit }));
  return { rows, options };
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

export function FeeEditor({
  action,
  spaces,
  initial,
  nowLocal,
}: {
  action: Action;
  spaces: { id: string; name: string; isPublic: boolean }[];
  initial: FeeScheduleItems | null;
  nowLocal: string;
}) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const restored = useMemo(() => {
    if (!state.items) return null;
    try {
      return JSON.parse(state.items) as FeeScheduleItems;
    } catch {
      return null;
    }
  }, [state.items]);
  return (
    <Body
      key={state.version}
      state={state}
      formAction={formAction}
      pending={pending}
      spaces={spaces}
      initial={restored ?? initial}
      nowLocal={nowLocal}
    />
  );
}

function Body({
  state,
  formAction,
  pending,
  spaces,
  initial,
  nowLocal,
}: {
  state: FeeFormState;
  formAction: (form: FormData) => void;
  pending: boolean;
  spaces: { id: string; name: string; isPublic: boolean }[];
  initial: FeeScheduleItems | null;
  nowLocal: string;
}) {
  const start = useMemo(() => toRows(initial, spaces), [initial, spaces]);
  const [rows, setRows] = useState(start.rows);
  const [options, setOptions] = useState<OptionRow[]>(start.options);
  const [mode, setMode] = useState(str(state.values, "effectiveMode", "now"));
  const errors = state.fieldErrors ?? {};

  const json = JSON.stringify({
    spaces: Object.fromEntries(
      Object.entries(rows).map(([id, r]) => [
        id,
        { baseMinutes: num(r.baseMinutes), baseFee: num(r.baseFee), extraUnitMinutes: num(r.extraUnitMinutes), extraFee: num(r.extraFee), nightFeePerHour: num(r.nightFeePerHour) },
      ]),
    ),
    options: options.map((o) => ({ key: o.key, name: o.name, fee: num(o.fee), unit: o.unit })),
  });

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="items" value={json} />
      {state.formError && <Notice kind="error">{state.formError}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">공간</th>
              {fields.map((f) => (
                <th key={f.key} scope="col" className="px-3 py-2">
                  {f.label}({f.unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {spaces.map((s) => (
              <tr key={s.id} className="align-top">
                <th scope="row" className="px-3 py-2 font-medium">
                  {s.name}
                  {!s.isPublic && <span className="ml-1 text-xs text-muted">(비공개)</span>}
                </th>
                {fields.map((f) => {
                  const err = errors[`spaces.${s.id}.${f.key}`] ?? (f.key === "baseMinutes" ? errors[`spaces.${s.id}`] : undefined);
                  return (
                    <td key={f.key} className="px-3 py-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={f.unit === "분" ? 15 : 1000}
                        aria-label={`${s.name} ${f.label}`}
                        aria-invalid={Boolean(err) || undefined}
                        value={rows[s.id]?.[f.key] ?? ""}
                        onChange={(e) => setRows((rs) => ({ ...rs, [s.id]: { ...rs[s.id]!, [f.key]: e.target.value } }))}
                        className="input w-28"
                      />
                      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="-mt-4 text-xs text-muted">
        예: 기본시간 180분 · 기본요금 60,000원이면 3시간까지 60,000원이고, 추가 단위 60분 · 추가요금 20,000원이면 그 뒤 1시간마다 20,000원이 더해집니다. 야간요금은 주간 대관 종료 시각 이후 시간에 시간당 더해집니다.
      </p>

      <fieldset className="rounded-lg border border-line bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-navy">부대시설·옵션 (선택)</legend>
        {options.length === 0 && <p className="text-sm text-muted">옵션이 없습니다.</p>}
        <div className="flex flex-col gap-2">
          {options.map((o, i) => (
            <div key={o.key} className="flex flex-wrap items-center gap-2 text-sm">
              <input aria-label={`옵션 ${i + 1} 이름`} value={o.name} placeholder="빔프로젝터" onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="input w-40" />
              <select aria-label={`옵션 ${i + 1} 단위`} value={o.unit} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, unit: e.target.value as OptionRow["unit"] } : x)))} className="input w-24">
                <option value="per_booking">1회</option>
                <option value="per_hour">시간당</option>
              </select>
              <input aria-label={`옵션 ${i + 1} 금액`} type="number" min={0} step={1000} value={o.fee} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} className="input w-28" />
              <span>원</span>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}>
                삭제
              </button>
              {(errors[`options.${i}.name`] || errors[`options.${i}.fee`]) && (
                <span className="text-xs text-danger">{errors[`options.${i}.name`] ?? errors[`options.${i}.fee`]}</span>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary mt-3 px-3 py-1 text-xs"
          onClick={() => setOptions((os) => [...os, { key: `opt-${Date.now().toString(36)}`, name: "", fee: "", unit: "per_booking" }])}
        >
          옵션 추가
        </button>
      </fieldset>

      <fieldset className="rounded-lg border border-line bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-navy">적용</legend>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="effectiveMode" value="now" checked={mode === "now"} onChange={() => setMode("now")} />
              지금 바로 적용
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="effectiveMode" value="scheduled" checked={mode === "scheduled"} onChange={() => setMode("scheduled")} />
              적용 시작 시각 예약
            </label>
          </div>
          {mode === "scheduled" && (
            <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
              적용 시작 시각 (한국 시간)
              <input type="datetime-local" name="effectiveFrom" min={nowLocal} defaultValue={str(state.values, "effectiveFrom", nowLocal)} className="input" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            변경 사유 <span className="text-xs font-normal text-muted">감사 로그에 남습니다. (필수)</span>
            <textarea name="reason" rows={2} defaultValue={str(state.values, "reason", "")} className="input" maxLength={500} />
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "저장 중…" : mode === "scheduled" ? "요금표 예약" : "요금표 저장"}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
