"use client";

import { useActionState } from "react";
import { initialFormState, str, type FormState } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";

export interface DiscountFormInitial {
  name: string;
  description: string;
  kind: string;
  value: string;
  proofRequired: string;
  proofGuide: string;
  isActive: string;
  sortOrder: string;
}

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function DiscountForm({ action, initial, editable }: { action: Action; initial: DiscountFormInitial; editable: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const radio = (name: keyof DiscountFormInitial, options: { value: string; label: string }[]) => (
    <div className="flex flex-wrap gap-4 text-sm">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2">
          <input type="radio" name={name} value={o.value} defaultChecked={str(v, name, initial[name]) === o.value} disabled={!editable} />
          {o.label}
        </label>
      ))}
    </div>
  );
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5" noValidate>
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          감면 이름
          <input name="name" defaultValue={str(v, "name", initial.name)} placeholder="공익 협력단체" disabled={!editable} className="input" aria-invalid={Boolean(e.name) || undefined} />
          <FieldError id="err-name" message={e.name} />
        </label>
        <div className="flex flex-col gap-1 text-sm font-medium">
          방식
          {radio("kind", [
            { value: "percent", label: "비율(%)" },
            { value: "amount", label: "금액(원)" },
          ])}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          값
          <input name="value" type="number" min={1} defaultValue={str(v, "value", initial.value)} disabled={!editable} className="input max-w-40" aria-invalid={Boolean(e.value) || undefined} />
          <FieldError id="err-value" message={e.value} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          설명(이용자에게 표시)
          <input name="description" defaultValue={str(v, "description", initial.description)} placeholder="비영리 공익활동 단체" disabled={!editable} className="input" />
        </label>
        <div className="flex flex-col gap-1 text-sm font-medium">
          증빙 제출
          {radio("proofRequired", [
            { value: "true", label: "필수" },
            { value: "false", label: "필요 없음" },
          ])}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          증빙 안내
          <input name="proofGuide" defaultValue={str(v, "proofGuide", initial.proofGuide)} placeholder="고유번호증 사본" disabled={!editable} className="input" aria-invalid={Boolean(e.proofGuide) || undefined} />
          <FieldError id="err-proofGuide" message={e.proofGuide} />
        </label>
        <div className="flex flex-col gap-1 text-sm font-medium">
          사용 여부
          {radio("isActive", [
            { value: "true", label: "사용" },
            { value: "false", label: "사용 안 함" },
          ])}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          표시 순서
          <input name="sortOrder" type="number" min={0} defaultValue={str(v, "sortOrder", initial.sortOrder)} disabled={!editable} className="input max-w-32" />
        </label>
      </div>
      <p className="text-xs text-muted">감면은 신청자가 고르고, 심사에서 증빙을 확인해 인정합니다. 인정되지 않으면 현재 설정(P-16)에 따라 반려합니다.</p>
      {editable && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            변경 사유 <span className="text-xs font-normal text-muted">감사 로그에 남습니다. (필수)</span>
            <input name="reason" defaultValue={str(v, "reason", "")} className="input" maxLength={500} />
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
