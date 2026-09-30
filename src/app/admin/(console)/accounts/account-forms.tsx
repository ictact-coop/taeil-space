"use client";

import { useActionState, useState } from "react";
import { type FormState, str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";
import type { AdminRoleName } from "@/domain/settings/define";
import { roleLabels } from "@/lib/labels";
import type { AccountFormState } from "./actions";

const roles = Object.entries(roleLabels) as [AdminRoleName, string][];

const roleHelp: Record<AdminRoleName, string> = {
  rental: "신청 심사, 휴관일·일정 차단·접수기간 수정, 환불 처리",
  accounting: "신청·결제 조회, 환불 처리",
  system: "모든 기능과 정책 설정, 계정 관리, 감사 로그",
};

/** 임시 비밀번호는 이 화면에서 한 번만 보여 준다. */
function TemporaryPassword({ loginId, password }: { loginId?: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded border border-warning/40 bg-warning/5 p-3 text-sm">
      <p className="font-medium text-warning">임시 비밀번호 (지금 한 번만 표시됩니다)</p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        {loginId && <span className="text-muted">{loginId} /</span>}
        <code className="rounded bg-white px-2 py-1 font-mono text-base">{password}</code>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true), () => undefined)}
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </p>
      <p className="mt-2 text-xs text-muted">메일·메신저에 그대로 남기지 말고 직접 전달하세요. 첫 로그인 후 &lsquo;내 계정&rsquo;에서 바꾸도록 안내합니다.</p>
    </div>
  );
}

function RoleSelect({ defaultValue, error }: { defaultValue: string; error?: string }) {
  const [role, setRole] = useState(defaultValue as AdminRoleName);
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      역할
      <select name="role" value={role} onChange={(e) => setRole(e.target.value as AdminRoleName)} className="input" aria-describedby="role-help role-error">
        {roles.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <span id="role-help" className="text-xs font-normal text-muted">
        {roleHelp[role]}
      </span>
      <FieldError id="role-error" message={error} />
    </label>
  );
}

type CreateAction = (prev: AccountFormState, form: FormData) => Promise<AccountFormState>;

export function CreateAccountForm({ action }: { action: CreateAction }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <div className="flex flex-col gap-4">
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.temporaryPassword && <TemporaryPassword loginId={state.loginId} password={state.temporaryPassword} />}
      <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
        {state.formError && <Notice kind="error">{state.formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            아이디
            <input name="loginId" defaultValue={str(v, "loginId", "")} className="input" autoComplete="off" aria-describedby="loginId-error" aria-invalid={Boolean(e.loginId)} />
            <FieldError id="loginId-error" message={e.loginId} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            이름
            <input name="name" defaultValue={str(v, "name", "")} className="input" autoComplete="off" aria-describedby="name-error" aria-invalid={Boolean(e.name)} />
            <FieldError id="name-error" message={e.name} />
          </label>
          <RoleSelect defaultValue={str(v, "role", "rental")} error={e.role} />
        </div>
        <div>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "만드는 중…" : "계정 만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}

type UpdateAction = (prev: FormState, form: FormData) => Promise<FormState>;

export function EditAccountForm({ action, name, role, self }: { action: UpdateAction; name: string; role: AdminRoleName; self: boolean }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const v = state.values;
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          이름
          <input name="name" defaultValue={str(v, "name", name)} className="input" aria-describedby="name-error" aria-invalid={Boolean(e.name)} />
          <FieldError id="name-error" message={e.name} />
        </label>
        {self ? (
          <div className="flex flex-col gap-1 text-sm font-medium">
            역할
            <input type="hidden" name="role" value={role} />
            <p className="input bg-cream/50">{roleLabels[role]}</p>
            <span className="text-xs font-normal text-muted">자기 계정의 역할은 다른 시스템 관리자가 바꿉니다.</span>
          </div>
        ) : (
          <RoleSelect defaultValue={str(v, "role", role)} error={e.role} />
        )}
      </div>
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

type CommandAction = (prev: AccountFormState, form: FormData) => Promise<AccountFormState>;

export function AccountCommandForm({
  action,
  title,
  description,
  confirmLabel,
  button,
  danger = false,
}: {
  action: CommandAction;
  title: string;
  description: string;
  confirmLabel: string;
  button: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.temporaryPassword && <TemporaryPassword loginId={state.loginId} password={state.temporaryPassword} />}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      <form key={state.version} action={formAction} className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" value="yes" required />
          {confirmLabel}
        </label>
        <button type="submit" className={danger ? "btn-secondary border-danger text-danger" : "btn-secondary"} disabled={pending}>
          {pending ? "처리 중…" : button}
        </button>
      </form>
    </div>
  );
}
