"use client";

import { useActionState } from "react";
import { type FormState, str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export function ChangeEmailForm({ action, email }: { action: Action; email: string | null }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      <label className="flex flex-col gap-1 text-sm font-medium">
        이메일
        <input type="email" name="email" autoComplete="email" defaultValue={str(state.values, "email", email ?? "")} className="input" aria-describedby="email-error" aria-invalid={Boolean(e.email)} />
        <FieldError id="email-error" message={e.email} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        현재 비밀번호
        <input type="password" name="current" autoComplete="current-password" className="input" aria-describedby="email-current-error" aria-invalid={Boolean(e.current)} />
        <FieldError id="email-current-error" message={e.current} />
      </label>
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "이메일 저장"}
        </button>
      </div>
    </form>
  );
}
