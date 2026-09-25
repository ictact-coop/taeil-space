"use client";

import { useActionState, useState } from "react";
import type { RevisionState } from "../actions";

type Action = (prev: RevisionState, form: FormData) => Promise<RevisionState>;

export interface RevisionInitial {
  contactName: string;
  contactPhone: string;
  eventTitle: string;
  eventPurpose: string;
  eventPublic: boolean;
  expectedHeadcount: number;
  nightManagerName: string;
  nightManagerPhone: string;
  night: boolean;
  uploadToken: string;
  extensions: string[];
}

/** 보완 제출: 금액에 영향이 없는 항목만 고칠 수 있다 (P-14) */
export function RevisionForm({ action, initial }: { action: Action; initial: RevisionInitial }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const e = state.fieldErrors ?? {};

  async function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    body.set("kind", "other");
    body.set("uploadToken", initial.uploadToken);
    const r = await fetch("/api/attachments", { method: "POST", body });
    const data = await r.json();
    if (!r.ok) setUploadError(data.error ?? "파일을 올리지 못했습니다.");
    else {
      setUploadError(null);
      setFiles((f) => [...f, data]);
    }
  }

  const field = (name: keyof RevisionInitial, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input name={name} defaultValue={String(initial[name] ?? "")} aria-invalid={Boolean(e[name]) || undefined} className="input" {...props} />
      {e[name] && <span className="text-xs font-normal text-danger">{e[name]}</span>}
    </label>
  );

  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="uploadToken" value={initial.uploadToken} />
      {state.error && (
        <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("contactName", "담당자")}
        {field("contactPhone", "휴대전화", { type: "tel", inputMode: "tel" })}
        <div className="sm:col-span-2">{field("eventTitle", "행사명")}</div>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          행사 목적과 내용
          <textarea name="eventPurpose" rows={4} defaultValue={initial.eventPurpose} className="input" />
          {e.eventPurpose && <span className="text-xs font-normal text-danger">{e.eventPurpose}</span>}
        </label>
        {field("expectedHeadcount", "예상 인원", { type: "number", min: 1 })}
        <div className="flex flex-col gap-1 text-sm font-medium">
          행사 공개 여부
          <div className="flex gap-4 py-2 font-normal">
            <label className="flex items-center gap-2">
              <input type="radio" name="eventPublic" value="true" defaultChecked={initial.eventPublic} /> 공개
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="eventPublic" value="false" defaultChecked={!initial.eventPublic} /> 비공개
            </label>
          </div>
        </div>
        {initial.night && (
          <>
            {field("nightManagerName", "야간 출입문 관리 담당자")}
            {field("nightManagerPhone", "담당자 연락처", { type: "tel" })}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <label className="btn-secondary cursor-pointer self-start">
          보완 자료 올리기
          <input type="file" className="sr-only" accept={initial.extensions.map((x) => `.${x}`).join(",")} onChange={(ev) => upload(ev.currentTarget)} />
        </label>
        {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
        {files.map((f) => (
          <span key={f.id} className="text-xs">
            📎 {f.name}
          </span>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        담당자에게 남길 말 (선택)
        <textarea name="note" rows={2} className="input" />
      </label>
      <p className="text-xs text-muted">공간·일시·금액을 바꾸려면 신청을 철회하고 다시 신청해야 합니다.</p>
      <button type="submit" className="btn-primary self-start" disabled={pending}>
        {pending ? "제출 중…" : "보완 내용 제출"}
      </button>
    </form>
  );
}
