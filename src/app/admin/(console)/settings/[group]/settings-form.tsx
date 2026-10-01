"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { SettingFieldView } from "@/server/settings/view";
import type { SettingsFormState } from "./actions";
import { TiersInput } from "./tiers-input";

type Action = (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export function SettingsForm({
  fields,
  action,
  canEditAny,
  nowLocal,
}: {
  fields: SettingFieldView[];
  action: Action;
  canEditAny: boolean;
  nowLocal: string;
}) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  return (
    // 제출할 때마다 key를 바꿔 다시 그린다. 오류 시에는 제출값, 성공 시에는 새 저장값이 초기값이 된다.
    <FormBody
      key={state.version}
      fields={fields}
      state={state}
      formAction={formAction}
      pending={pending}
      canEditAny={canEditAny}
      nowLocal={nowLocal}
    />
  );
}

function FormBody({
  fields,
  state,
  formAction,
  pending,
  canEditAny,
  nowLocal,
}: {
  fields: SettingFieldView[];
  state: SettingsFormState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  canEditAny: boolean;
  nowLocal: string;
}) {
  const [mode, setMode] = useState(state.effectiveMode ?? "now");
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.ok && state.message && (
        <p role="status" className="rounded border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green">
          {state.message}
        </p>
      )}
      {state.formError && (
        <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.formError}
        </p>
      )}

      <div className="divide-y divide-line rounded-lg border border-line bg-white">
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            error={errors[field.key]}
            initial={state.submitted?.[field.key] ?? field.inputValue}
          />
        ))}
      </div>

      {canEditAny && (
        <fieldset className="rounded-lg border border-line bg-white p-5">
          <legend className="px-1 text-sm font-semibold text-navy">변경 적용</legend>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="effectiveMode" value="now" checked={mode === "now"} onChange={() => setMode("now")} />
                지금 바로 적용
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="effectiveMode"
                  value="scheduled"
                  checked={mode === "scheduled"}
                  onChange={() => setMode("scheduled")}
                />
                적용 시작 시각 예약
              </label>
            </div>
            {mode === "scheduled" && (
              <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
                적용 시작 시각 (한국 시간)
                <input
                  type="datetime-local"
                  name="effectiveFrom"
                  min={nowLocal}
                  defaultValue={state.effectiveFrom || nowLocal}
                  className="input"
                  required
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium">
              변경 사유 <span className="text-xs font-normal text-muted">감사 로그에 남습니다. (필수)</span>
              <textarea name="reason" rows={2} required defaultValue={state.reason} className="input" maxLength={500} />
            </label>
            <div>
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending ? "저장 중…" : mode === "scheduled" ? "변경 예약" : "저장"}
              </button>
              <span className="ml-3 text-xs text-muted">바뀐 항목만 새 버전으로 저장됩니다.</span>
            </div>
          </div>
        </fieldset>
      )}
    </form>
  );
}

function FieldRow({ field, error, initial }: { field: SettingFieldView; error?: string; initial: string }) {
  const id = `f-${field.key}`;
  const describedBy = [field.description ? `${id}-desc` : null, error ? `${id}-err` : null].filter(Boolean).join(" ");
  return (
    <div className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <label htmlFor={id} id={`${id}-label`} className="font-medium text-ink">
          {field.label}
        </label>
        <div className="mt-1 flex flex-wrap gap-1">
          {field.refs.map((r) => (
            <span key={r} className="badge bg-cream text-muted">
              {r}
            </span>
          ))}
          {field.requiredBeforeOpen && (
            <span className="badge bg-brick/10 text-brick" title="오픈 전에 기념관이 확정해야 하는 값">
              오픈 전 필수
            </span>
          )}
          {field.source === "default" && <span className="badge bg-cream-dark text-muted">기본값</span>}
        </div>
        {field.description && (
          <p id={`${id}-desc`} className="mt-2 text-xs text-muted">
            {field.description}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          현재: <strong className="text-ink">{field.displayValue}</strong>
          {field.since && <> · {field.since}부터</>}
          {field.source === "stored" && <> · 기본값 {field.defaultDisplay}</>}
        </p>
        {field.invalidStored && (
          <p className="mt-1 text-xs text-warning">저장된 값이 현재 허용 범위를 벗어나 기본값을 적용 중입니다.</p>
        )}
        {field.upcoming.map((u) => (
          <p key={u.id} className="mt-1 text-xs text-warning">
            예약: {u.effectiveFrom}부터 → <strong>{u.displayValue}</strong>
          </p>
        ))}
        <Link href={`/admin/settings/history/${encodeURIComponent(field.key)}`} className="mt-2 inline-block text-xs text-navy underline">
          변경 이력
        </Link>
      </div>
      <div className="flex flex-col gap-1">
        <FieldInput field={field} id={id} initial={initial} invalid={Boolean(error)} describedBy={describedBy} />
        {error && (
          <p id={`${id}-err`} className="text-xs text-danger">
            {error}
          </p>
        )}
        {!field.editable && <p className="text-xs text-muted">수정 권한이 없습니다.</p>}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  id,
  initial,
  invalid,
  describedBy,
}: {
  field: SettingFieldView;
  id: string;
  initial: string;
  invalid: boolean;
  describedBy: string;
}) {
  const common = {
    id,
    name: `v:${field.key}`,
    disabled: !field.editable,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy || undefined,
  };
  const input = field.input;
  switch (input.kind) {
    case "integer":
    case "percent": {
      const min = input.kind === "percent" ? 0 : input.min;
      const max = input.kind === "percent" ? 100 : input.max;
      const unit = input.kind === "percent" ? "%" : input.unit;
      return (
        <div className="flex items-center gap-2">
          <input {...common} type="number" inputMode="numeric" min={min} max={max} step={1} defaultValue={initial} className="input max-w-40" />
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
      );
    }
    case "boolean":
      return (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-4 text-sm">
          {[
            { value: "true", label: input.trueLabel },
            { value: "false", label: input.falseLabel },
          ].map((o) => (
            <label key={o.value} className="flex items-center gap-2">
              <input type="radio" name={common.name} value={o.value} defaultChecked={initial === o.value} disabled={common.disabled} />
              {o.label}
            </label>
          ))}
        </div>
      );
    case "enum":
      return (
        <select {...common} defaultValue={initial} className="input">
          {input.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "time":
      return <input {...common} type="time" defaultValue={initial} className="input max-w-40" />;
    case "date":
      return <input {...common} type="date" defaultValue={initial} className="input max-w-48" />;
    case "monthDay":
      return <input {...common} placeholder="MM-DD" pattern="\d{2}-\d{2}" defaultValue={initial} className="input max-w-32" />;
    case "text":
      return input.multiline ? (
        <textarea {...common} rows={3} maxLength={input.maxLength} defaultValue={initial} className="input" />
      ) : (
        <input {...common} maxLength={input.maxLength} defaultValue={initial} className="input" />
      );
    case "list":
      return <input {...common} placeholder={input.placeholder} defaultValue={initial} className="input" />;
    case "tiers":
      return (
        <TiersInput
          name={common.name}
          initial={initial}
          disabled={common.disabled}
          describedBy={common["aria-describedby"]}
          labelledBy={`${id}-label`}
        />
      );
  }
}
