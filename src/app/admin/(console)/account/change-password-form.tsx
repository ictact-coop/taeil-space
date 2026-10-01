"use client";

import { useActionState } from "react";
import type { FormState } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const fields = [
  { name: "current", label: "현재 비밀번호", autoComplete: "current-password" },
  { name: "next", label: "새 비밀번호", autoComplete: "new-password" },
  { name: "confirm", label: "새 비밀번호 확인", autoComplete: "new-password" },
] as const;

export function ChangePasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-sm font-medium">
          {f.label}
          <input type="password" name={f.name} autoComplete={f.autoComplete} className="input" aria-describedby={`${f.name}-error`} aria-invalid={Boolean(e[f.name])} />
          <FieldError id={`${f.name}-error`} message={e[f.name]} />
        </label>
      ))}
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "바꾸는 중…" : "비밀번호 변경"}
        </button>
      </div>
    </form>
  );
}
