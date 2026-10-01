"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError } from "@/components/auth-shell";
import { findIdAction, requestResetAction, type RecoveryState } from "./recovery-actions";

function Sent({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="rounded border border-status-green/30 bg-status-green/5 px-3 py-2 text-sm text-status-green">
        {message}
      </p>
      <Link href="/admin/login" className="btn-primary text-center">
        로그인 화면으로
      </Link>
    </div>
  );
}

export function FindIdForm() {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(findIdAction, {});
  if (state.sent) return <Sent message={state.sent} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">계정에 등록된 이메일을 입력하면 그 주소로 아이디를 보내 드립니다.</p>
      <FormError message={state.error} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        이메일
        <input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className="input" />
      </label>
      <button type="submit" className="btn-primary mt-2" disabled={pending}>
        {pending ? "보내는 중…" : "아이디 안내 받기"}
      </button>
    </form>
  );
}

export function RequestResetForm() {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(requestResetAction, {});
  if (state.sent) return <Sent message={state.sent} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">아이디와 등록된 이메일을 입력하면 비밀번호를 새로 정할 수 있는 링크를 보내 드립니다.</p>
      <FormError message={state.error} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        아이디
        <input name="loginId" autoComplete="username" required defaultValue={state.values?.loginId} className="input" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        이메일
        <input name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className="input" />
      </label>
      <button type="submit" className="btn-primary mt-2" disabled={pending}>
        {pending ? "보내는 중…" : "재설정 링크 받기"}
      </button>
    </form>
  );
}
