"use client";

import { useActionState } from "react";
import { str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";
import { blockKindLabels } from "@/domain/calendar/block-input";
import type { BlockFormState } from "./actions";

type Action = (prev: BlockFormState, form: FormData) => Promise<BlockFormState>;

export function BlockForm({ action, spaces, defaultStart }: { action: Action; spaces: { id: string; name: string }[]; defaultStart: string }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      {state.conflicts && state.conflicts.length > 0 && (
        <ul className="list-disc rounded border border-danger/30 bg-white py-2 pl-8 pr-3 text-xs">
          {state.conflicts.map((c, i) => (
            <li key={i}>
              {c.spaceName} · {c.label}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          종류
          <select name="kind" defaultValue={str(v, "kind", "event")} className="input">
            {Object.entries(blockKindLabels).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          적용 공간
          <select name="spaceId" defaultValue={str(v, "spaceId", "")} className="input">
            <option value="">전체 공간</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          시작 (한국 시간)
          <input name="startsAt" type="datetime-local" step={600} defaultValue={str(v, "startsAt", defaultStart)} className="input" aria-invalid={Boolean(e.startsAt) || undefined} />
          <FieldError id="err-startsAt" message={e.startsAt} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          종료 (한국 시간)
          <input name="endsAt" type="datetime-local" step={600} defaultValue={str(v, "endsAt", "")} className="input" aria-invalid={Boolean(e.endsAt) || undefined} />
          <FieldError id="err-endsAt" message={e.endsAt} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          사유 <span className="text-xs font-normal text-muted">내부 기록용입니다. 이용자 달력에는 “대관불가”로만 표시됩니다.</span>
          <input name="reason" defaultValue={str(v, "reason", "")} placeholder="기념관 자체행사" className="input" aria-invalid={Boolean(e.reason) || undefined} />
          <FieldError id="err-reason" message={e.reason} />
        </label>
      </div>
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "등록 중…" : "일정 차단 등록"}
        </button>
      </div>
    </form>
  );
}
