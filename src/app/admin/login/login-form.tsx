"use client";

import { useActionState } from "react";
import { FormError } from "@/components/auth-shell";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        아이디
        <input name="loginId" autoComplete="username" required defaultValue={state.loginId} className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        비밀번호
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={Boolean(state.error)}
          className="input"
        />
      </label>
      <button type="submit" className="btn-primary mt-2" disabled={pending}>
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
