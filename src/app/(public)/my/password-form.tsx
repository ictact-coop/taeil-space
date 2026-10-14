"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "./actions";

/** 나의 대관 비밀번호 변경(이메일 확인 코드로 들어온 경우 잊은 비밀번호 재설정에도 쓴다) */
export function PasswordForm({ viaEmail }: { viaEmail: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, { version: 0 } as PasswordState);
  return (
    <details className="mt-8 rounded-lg border border-line bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-navy">비밀번호 변경</summary>
      <form key={state.done ? state.version : "form"} action={action} className="mt-4 flex max-w-sm flex-col gap-3">
        <p className="text-xs text-muted">
          {viaEmail
            ? "이 이메일로 된 신청 모두에 새 비밀번호를 정합니다. 비밀번호를 잊은 경우 여기서 다시 정하세요."
            : "지금 보이는 신청 모두에 새 비밀번호를 정합니다."}
        </p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          새 비밀번호
          <input name="password" type="password" required minLength={4} maxLength={50} autoComplete="new-password" className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          새 비밀번호 확인
          <input name="passwordConfirm" type="password" required minLength={4} maxLength={50} autoComplete="new-password" className="input" />
        </label>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.done && (
          <p role="status" className="text-sm text-status-green">
            {state.done}
          </p>
        )}
        <button type="submit" className="btn-secondary self-start" disabled={pending}>
          비밀번호 바꾸기
        </button>
      </form>
    </details>
  );
}
