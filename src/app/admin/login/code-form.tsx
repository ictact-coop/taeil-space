"use client";

import { useActionState } from "react";
import { FormError } from "@/components/auth-shell";
import type { AuthFormState } from "./actions";

export function CodeForm({
  action,
  submitLabel,
}: {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        인증 코드 6자리
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="input text-center text-lg tracking-[0.4em]"
        />
      </label>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "확인 중…" : submitLabel}
      </button>
    </form>
  );
}
