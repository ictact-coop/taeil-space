"use client";

import { useActionState, useState } from "react";
import { type FormState, str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";
import type { AccountFormState } from "./actions";

/** 등급 선택지 (최고 관리자가 아니면 최고 관리자 등급은 빠진 목록을 받는다) */
export interface GradeOption {
  id: string;
  name: string;
  description: string;
}

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

function GradeSelect({ grades, defaultValue, error }: { grades: GradeOption[]; defaultValue: string; error?: string }) {
  const [gradeId, setGradeId] = useState(defaultValue || grades[0]?.id || "");
  const selected = grades.find((g) => g.id === gradeId);
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      등급
      <select name="gradeId" value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="input" aria-describedby="grade-help grade-error">
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <span id="grade-help" className="text-xs font-normal text-muted">
        {selected?.description}
      </span>
      <FieldError id="grade-error" message={error} />
    </label>
  );
}

type CreateAction = (prev: AccountFormState, form: FormData) => Promise<AccountFormState>;

export function CreateAccountForm({ action, grades, defaultGradeId }: { action: CreateAction; grades: GradeOption[]; defaultGradeId: string }) {
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
          <GradeSelect grades={grades} defaultValue={str(v, "gradeId", defaultGradeId)} error={e.gradeId} />
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

export function EditAccountForm({
  action,
  name,
  grade,
  grades,
  gradeLocked,
}: {
  action: UpdateAction;
  name: string;
  grade: GradeOption;
  grades: GradeOption[];
  /** 자기 계정이거나 최고 관리자 계정을 최고 관리자가 아닌 사람이 볼 때 */
  gradeLocked: string | null;
}) {
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
        {gradeLocked ? (
          <div className="flex flex-col gap-1 text-sm font-medium">
            등급
            <input type="hidden" name="gradeId" value={grade.id} />
            <p className="input bg-cream/50">{grade.name}</p>
            <span className="text-xs font-normal text-muted">{gradeLocked}</span>
          </div>
        ) : (
          <GradeSelect grades={grades} defaultValue={str(v, "gradeId", grade.id)} error={e.gradeId} />
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
