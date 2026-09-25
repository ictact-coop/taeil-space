"use client";

import { useActionState, useState } from "react";
import { str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";
import { closureTypeLabels, weekdayLabels, type ClosureRuleType } from "@/domain/calendar/closures";
import type { ClosureFormState } from "./actions";

type Action = (prev: ClosureFormState, form: FormData) => Promise<ClosureFormState>;

export function ClosureForm({ action, spaces }: { action: Action; spaces: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  return <Body key={state.version} state={state} formAction={formAction} pending={pending} spaces={spaces} />;
}

function Body({
  state,
  formAction,
  pending,
  spaces,
}: {
  state: ClosureFormState;
  formAction: (form: FormData) => void;
  pending: boolean;
  spaces: { id: string; name: string }[];
}) {
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState<ClosureRuleType>((str(v, "type", "date_range") as ClosureRuleType) || "date_range");
  const hasConflicts = (state.conflicts?.length ?? 0) > 0;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind={hasConflicts ? "warning" : "error"}>{state.formError}</Notice>}
      {hasConflicts && (
        <div className="rounded border border-warning/30 bg-white p-3 text-sm">
          <p className="mb-2 font-medium">휴관일에 걸리는 진행 중 신청</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {state.conflicts!.map((c) => (
              <li key={c.applicationNo}>
                {c.date} · {c.spaceName} · {c.applicationNo} ({c.orgName})
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="confirmConflicts" value="true" />
            확인했습니다. 기존 신청은 그대로 두고 규칙을 추가합니다.
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          규칙 유형
          <select name="type" value={type} onChange={(ev) => setType(ev.target.value as ClosureRuleType)} className="input">
            {(Object.keys(closureTypeLabels) as ClosureRuleType[]).map((t) => (
              <option key={t} value={t}>
                {closureTypeLabels[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          적용 공간
          <select name="spaceId" defaultValue={str(v, "spaceId", "")} className="input">
            <option value="">전체 공간(기념관 휴관)</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}만
              </option>
            ))}
          </select>
        </label>

        {type === "weekly" && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            요일
            <select name="weekday" defaultValue={str(v, "weekday", "1")} className="input">
              {weekdayLabels.map((w, i) => (
                <option key={w} value={i}>
                  매주 {w}요일
                </option>
              ))}
            </select>
            <FieldError id="err-weekday" message={e.weekday} />
          </label>
        )}
        {type === "annual" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              월
              <input name="month" type="number" min={1} max={12} defaultValue={str(v, "month", "")} className="input" aria-invalid={Boolean(e.month) || undefined} />
              <FieldError id="err-month" message={e.month} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              일
              <input name="day" type="number" min={1} max={31} defaultValue={str(v, "day", "")} className="input" aria-invalid={Boolean(e.day) || undefined} />
              <FieldError id="err-day" message={e.day} />
            </label>
          </div>
        )}
        {(type === "date_range" || type === "open_exception") && (
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              시작일
              <input name="startDate" type="date" defaultValue={str(v, "startDate", "")} className="input" aria-invalid={Boolean(e.startDate) || undefined} />
              <FieldError id="err-startDate" message={e.startDate} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              종료일
              <input name="endDate" type="date" defaultValue={str(v, "endDate", "")} className="input" aria-invalid={Boolean(e.endDate) || undefined} />
              <FieldError id="err-endDate" message={e.endDate} />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium">
          규칙 이름
          <input name="name" defaultValue={str(v, "name", "")} placeholder="2027 설 연휴" className="input" aria-invalid={Boolean(e.name) || undefined} />
          <FieldError id="err-name" message={e.name} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          이용자 안내 문구
          <input
            name="publicMessage"
            defaultValue={str(v, "publicMessage", "")}
            placeholder={type === "open_exception" ? "이날은 특별 개관합니다." : "설 연휴 휴관일입니다."}
            className="input"
            aria-invalid={Boolean(e.publicMessage) || undefined}
          />
          <FieldError id="err-publicMessage" message={e.publicMessage} />
        </label>

        {(type === "weekly" || type === "annual") && (
          <details className="text-sm sm:col-span-2">
            <summary className="cursor-pointer text-navy">규칙 적용 기간 정하기 (선택)</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 font-medium">
                적용 시작일
                <input name="activeFrom" type="date" defaultValue={str(v, "activeFrom", "")} className="input" />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                적용 종료일
                <input name="activeUntil" type="date" defaultValue={str(v, "activeUntil", "")} className="input" />
                <FieldError id="err-activeUntil" message={e.activeUntil} />
              </label>
            </div>
          </details>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        변경 사유 <span className="text-xs font-normal text-muted">감사 로그에 남습니다. (필수)</span>
        <input name="reason" defaultValue={str(v, "reason", "")} required className="input" maxLength={500} />
      </label>
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "규칙 추가"}
        </button>
      </div>
    </form>
  );
}
