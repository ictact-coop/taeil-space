"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError } from "@/components/admin/ui";
import { FormError } from "@/components/auth-shell";
import type { RecoveryState } from "../../recovery-actions";

type Action = (prev: RecoveryState, form: FormData) => Promise<RecoveryState>;

export function NewPasswordForm({ action, minLength }: { action: Action; minLength: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.doneLoginId) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green">
          비밀번호를 바꿨습니다. {state.doneLoginId} 계정으로 새 비밀번호와 OTP 인증 코드를 입력해 로그인하세요.
        </p>
        <Link href="/admin/login" className="btn-primary text-center">
          로그인
        </Link>
      </div>
    );
  }
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        새 비밀번호
        <input name="next" type="password" autoComplete="new-password" required minLength={minLength} className="input" aria-describedby="next-error next-help" aria-invalid={Boolean(e.next)} />
        <span id="next-help" className="text-xs font-normal text-muted">
          {minLength}자 이상, 영문과 숫자를 함께 넣습니다.
        </span>
        <FieldError id="next-error" message={e.next} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        새 비밀번호 확인
        <input name="confirm" type="password" autoComplete="new-password" required className="input" aria-describedby="confirm-error" aria-invalid={Boolean(e.confirm)} />
        <FieldError id="confirm-error" message={e.confirm} />
      </label>
      <button type="submit" className="btn-primary mt-2" disabled={pending}>
        {pending ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );
}
