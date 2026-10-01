"use client";

import { useActionState } from "react";
import { type FormState, list, str } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";
import { permissionDefs } from "@/domain/auth/permissions";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const groups = [...new Set(permissionDefs.map((d) => d.group))];
const labelOf = Object.fromEntries(permissionDefs.map((d) => [d.key, d.label])) as Record<string, string>;

export function GradeForm({
  action,
  name = "",
  description = "",
  permissions = [],
  isSuper = false,
  submitLabel,
}: {
  action: Action;
  name?: string;
  description?: string;
  permissions?: readonly string[];
  isSuper?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const checked = new Set(list(v, "permissions", [...permissions]));
  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-5" noValidate>
      {state.ok && state.message && <Notice kind="success">{state.message}</Notice>}
      {state.formError && <Notice kind="error">{state.formError}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          등급 이름
          <input name="name" defaultValue={str(v, "name", name)} className="input" maxLength={30} aria-describedby="name-error" aria-invalid={Boolean(e.name)} />
          <FieldError id="name-error" message={e.name} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          설명
          <input name="description" defaultValue={str(v, "description", description)} className="input" maxLength={200} placeholder="예: 동아리 활동 공간의 일정 확인" aria-describedby="description-error" />
          <FieldError id="description-error" message={e.description} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-medium">권한</legend>
        {isSuper ? (
          <Notice kind="info">시스템 최고 관리자 등급은 모든 권한을 가집니다. 나중에 새 기능이 생겨도 자동으로 포함됩니다.</Notice>
        ) : (
          groups.map((group) => (
            <div key={group} className="rounded border border-line p-3">
              <p className="mb-2 text-xs font-semibold text-muted">{group}</p>
              <ul className="flex flex-col gap-2">
                {permissionDefs
                  .filter((d) => d.group === group)
                  .map((d) => (
                    <li key={d.key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="permissions" value={d.key} defaultChecked={checked.has(d.key)} className="mt-1" />
                        <span>
                          <span className="font-medium">{d.label}</span>
                          <span className="block text-xs text-muted">
                            {d.description}
                            {"requires" in d && ` · ${d.requires.map((r) => labelOf[r]).join(", ")} 권한이 함께 들어갑니다`}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </fieldset>
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "저장 중…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
