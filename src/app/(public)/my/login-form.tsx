"use client";

import { useActionState, useState } from "react";
import { phoneLoginAction, requestCodeAction, verifyCodeAction, type LoginState, type PhoneLoginState } from "./actions";

/** 나의 대관 로그인: 전화번호 + 신청 때 정한 비밀번호(기본), 또는 이메일 확인 코드 */
export function LoginForm() {
  const [mode, setMode] = useState<"phone" | "email">("phone");
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 rounded-lg bg-cream p-1 text-sm font-semibold" role="tablist" aria-label="확인 방법">
        {(
          [
            ["phone", "전화번호·비밀번호"],
            ["email", "이메일 확인 코드"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={`rounded-md px-3 py-2 ${mode === key ? "bg-white text-navy shadow-sm" : "text-muted hover:text-navy"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "phone" ? <PhoneLoginForm /> : <EmailLoginForm />}
    </div>
  );
}

function PhoneLoginForm() {
  const [state, login, pending] = useActionState(phoneLoginAction, {} as PhoneLoginState);
  return (
    <form action={login} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        신청할 때 적은 휴대전화 번호
        <input name="phone" type="tel" inputMode="tel" required autoComplete="tel" placeholder="010-0000-0000" defaultValue={state.phone ?? ""} className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        신청할 때 정한 비밀번호
        <input name="password" type="password" required autoComplete="current-password" className="input" />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        신청 내역 보기
      </button>
      <p className="text-xs text-muted">비밀번호가 기억나지 않으면 위의 &apos;이메일 확인 코드&apos;로 들어온 뒤 아래쪽 &apos;비밀번호 변경&apos;에서 다시 정하세요. 이메일을 받을 수 없으면 기념관(02-318-0903)으로 문의해 주세요.</p>
    </form>
  );
}

function EmailLoginForm() {
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
    </div>
  );
}
