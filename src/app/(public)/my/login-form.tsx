"use client";

import { useActionState } from "react";
import { requestCodeAction, verifyCodeAction, type LoginState } from "./actions";

export function LoginForm() {
  const [emailState, requestCode, requesting] = useActionState(requestCodeAction, { step: "email" } as LoginState);
  const [codeState, verify, verifying] = useActionState(verifyCodeAction, { step: "code" } as LoginState);
  const email = codeState.email ?? emailState.email ?? "";
  const onCodeStep = emailState.step === "code";

  return (
    <div className="flex flex-col gap-6">
      <form action={requestCode} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          신청할 때 적은 이메일
          <input name="email" type="email" required autoComplete="email" defaultValue={email} className="input" />
        </label>
        {emailState.error && (
          <p role="alert" className="text-sm text-danger">
            {emailState.error}
          </p>
        )}
        <button type="submit" className="btn-secondary" disabled={requesting}>
          {onCodeStep ? "확인 코드 다시 받기" : "확인 코드 받기"}
        </button>
      </form>
      {onCodeStep && (
        <form action={verify} className="flex flex-col gap-3 border-t border-line pt-5">
          <p role="status" className="text-sm text-muted">
            {emailState.info}
          </p>
          <input type="hidden" name="email" value={emailState.email} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            확인 코드 6자리
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="input text-center text-lg tracking-[0.4em]" />
          </label>
          {codeState.error && (
            <p role="alert" className="text-sm text-danger">
              {codeState.error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={verifying}>
            확인
          </button>
        </form>
      )}
      <p className="text-xs text-muted">휴대전화 번호로 확인하는 방법은 문자 발송 연결 후 제공됩니다.</p>
    </div>
  );
}
