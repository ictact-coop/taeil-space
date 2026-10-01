"use client";

import { useActionState } from "react";
import { initialFormState, list, str, type FormState } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";

export interface SpaceFormInitial {
  code: string;
  name: string;
  capacity: string;
  minHeadcount: string;
  description: string;
  equipment: string;
  notice: string;
  leadDays: string;
  slotMinutes: string;
  minDurationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  extraConsents: string[];
  isPublic: string;
  sortOrder: string;
}

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function SpaceForm({
  initial,
  action,
  editable,
  consentOptions,
}: {
  initial: SpaceFormInitial;
  action: Action;
  editable: boolean;
  consentOptions: { key: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <Body key={state.version} state={state} initial={initial} formAction={formAction} pending={pending} editable={editable} consentOptions={consentOptions} />
  );
}

function Body({
  state,
  initial,
  formAction,
  pending,
  editable,
  consentOptions,
}: {
  state: FormState;
  initial: SpaceFormInitial;
  formAction: (form: FormData) => void;
  pending: boolean;
  editable: boolean;
  consentOptions: { key: string; label: string }[];
}) {
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const field = (name: keyof SpaceFormInitial, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        name={name}
        defaultValue={str(v, name, initial[name] as string)}
        aria-invalid={Boolean(e[name]) || undefined}
        aria-describedby={e[name] ? `err-${name}` : undefined}
        disabled={!editable}
        className="input"
        {...props}
      />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      <FieldError id={`err-${name}`} message={e[name]} />
    </label>
  );
  const consents = list(v, "extraConsents", initial.extraConsents);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-navy">기본 정보</legend>
        {field("name", "공간 이름")}
        {field("code", "코드", { placeholder: "seminar" }, "영문 소문자. 내부 식별용입니다.")}
        {field("capacity", "정원(명)", { type: "number", min: 1, inputMode: "numeric" }, "BR-05: 예상 인원이 정원을 넘으면 신청할 수 없습니다.")}
        {field("minHeadcount", "최소 인원(명)", { type: "number", min: 1, inputMode: "numeric" }, "비우면 제한 없음. BR-08: 공연장 20명.")}
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          설명
          <textarea name="description" rows={2} defaultValue={str(v, "description", initial.description)} disabled={!editable} className="input" />
        </label>
        {field("equipment", "기본 제공 장비", { placeholder: "빔프로젝터, 화이트보드" }, "쉼표로 구분합니다.")}
        <label className="flex flex-col gap-1 text-sm font-medium">
          유의사항
          <textarea name="notice" rows={2} defaultValue={str(v, "notice", initial.notice)} disabled={!editable} className="input" />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-navy">신청 조건·시간 (P-02)</legend>
        {field(
          "leadDays",
          "신청기한(이용일 며칠 전까지)",
          { type: "number", min: 0, inputMode: "numeric" },
          "비우면 교육실처럼 관리자가 공개한 접수기간 안에서만 신청받습니다.",
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          예약 시간 단위
          <select name="slotMinutes" defaultValue={str(v, "slotMinutes", initial.slotMinutes)} disabled={!editable} className="input">
            {[15, 30, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
          <FieldError id="err-slotMinutes" message={e.slotMinutes} />
        </label>
        {field("minDurationMinutes", "최소 대관시간(분)", { type: "number", min: 15, step: 15, inputMode: "numeric" }, "예약 시간 단위의 배수")}
        <div className="grid grid-cols-2 gap-3">
          {field("bufferBeforeMinutes", "준비 시간(분)", { type: "number", min: 0, step: 5, inputMode: "numeric" })}
          {field("bufferAfterMinutes", "철수 시간(분)", { type: "number", min: 0, step: 5, inputMode: "numeric" })}
        </div>
        <p className="text-xs text-muted sm:col-span-2">준비·철수 시간은 앞뒤 신청과 겹치지 않도록 일정을 함께 잡아 둡니다.</p>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-navy">공개·동의</legend>
        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium">이용자 화면 공개</span>
          <div className="flex gap-4">
            {[
              { value: "true", label: "공개" },
              { value: "false", label: "비공개" },
            ].map((o) => (
              <label key={o.value} className="flex items-center gap-2">
                <input type="radio" name="isPublic" value={o.value} defaultChecked={str(v, "isPublic", initial.isPublic) === o.value} disabled={!editable} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        {field("sortOrder", "표시 순서", { type: "number", min: 0, inputMode: "numeric" })}
        <div className="flex flex-col gap-2 text-sm sm:col-span-2">
          <span className="font-medium">추가 동의 항목</span>
          <span className="text-xs text-muted">개인정보·운영규정·환불규정 동의는 모든 공간에 받고, 야간 규정 동의는 야간을 포함할 때 받습니다.</span>
          {consentOptions.map((c) => (
            <label key={c.key} className="flex items-center gap-2">
              <input type="checkbox" name="extraConsents" value={c.key} defaultChecked={consents.includes(c.key)} disabled={!editable} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      {editable && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            변경 사유 <span className="text-xs font-normal text-muted">감사 로그에 남습니다. (필수)</span>
            <textarea name="reason" rows={2} required defaultValue={str(v, "reason", "")} className="input" maxLength={500} />
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
