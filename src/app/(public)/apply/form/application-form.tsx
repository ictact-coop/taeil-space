"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { list, str, type FormState } from "@/components/admin/form-state";

export interface FormProps {
  space: { id: string; name: string; capacity: number; minHeadcount: number | null };
  date: string;
  start: string;
  end: string;
  night: boolean;
  options: { key: string; name: string; label: string }[];
  discounts: { id: string; name: string; label: string; proofRequired: boolean; proofGuide: string; description: string }[];
  consents: { key: string; label: string; text: string }[];
  minPurposeLength: number;
  regNoRequired: boolean;
  attachment: { extensions: string[]; maxMb: number; maxCount: number };
  uploadToken: string;
  initialPrice: Price | null;
}

interface Price {
  items: { label: string; amount: number }[];
  total: number;
}
interface Uploaded {
  id: string;
  name: string;
  size: number;
  kind: "event_plan" | "discount_proof" | "other";
}
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function ApplicationForm({ action, props }: { action: Action; props: FormProps }) {
  const [state, formAction, pending] = useActionState(action, { version: 0 });
  // 첨부 목록은 제출 실패 뒤에도 유지되어야 하므로 폼 바깥에서 관리한다
  const [files, setFiles] = useState<Uploaded[]>([]);
  return <Body key={state.version} state={state} formAction={formAction} pending={pending} props={props} files={files} setFiles={setFiles} />;
}

function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium">
      <label htmlFor={`f-${name}`}>{label}</label>
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      {error && (
        <span id={`err-${name}`} className="text-xs font-normal text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

function Body({
  state,
  formAction,
  pending,
  props,
  files,
  setFiles,
}: {
  state: FormState;
  formAction: (form: FormData) => void;
  pending: boolean;
  props: FormProps;
  files: Uploaded[];
  setFiles: React.Dispatch<React.SetStateAction<Uploaded[]>>;
}) {
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const [discountId, setDiscountId] = useState(str(v, "discountRuleId", ""));
  const [optionKeys, setOptionKeys] = useState<string[]>(list(v, "optionKeys", []));
  const [headcount, setHeadcount] = useState(str(v, "expectedHeadcount", ""));
  const [price, setPrice] = useState<Price | null>(props.initialPrice);
  const [liveErrors, setLiveErrors] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const discount = props.discounts.find((d) => d.id === discountId) ?? null;
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.formError) errorRef.current?.focus();
  }, [state.formError]);

  useEffect(() => {
    const n = Number(headcount);
    const t = setTimeout(() => {
      fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId: props.space.id,
          date: props.date,
          start: props.start,
          end: props.end,
          headcount: Number.isInteger(n) && n > 0 ? n : null,
          discountRuleId: discountId || null,
          optionKeys,
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((q: { price: Price | null; violations: { message: string }[] }) => {
          setPrice(q.price);
          setLiveErrors(q.violations.map((x) => x.message));
        })
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [headcount, discountId, optionKeys, props.space.id, props.date, props.start, props.end]);

  async function upload(kind: Uploaded["kind"], input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > props.attachment.maxMb * 1024 * 1024) return setUploadError(`파일은 ${props.attachment.maxMb}MB 이하만 올릴 수 있습니다.`);
    setUploading(true);
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    body.set("uploadToken", props.uploadToken);
    try {
      const r = await fetch("/api/attachments", { method: "POST", body });
      const data = await r.json();
      if (!r.ok) setUploadError(data.error ?? "파일을 올리지 못했습니다.");
      else setFiles((fs) => [...fs, data as Uploaded]);
    } catch {
      setUploadError("파일을 올리지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/attachments/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadToken: props.uploadToken }) });
    setFiles((fs) => fs.filter((f) => f.id !== id));
  }

  const input = (name: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`f-${name}`}
      name={name}
      defaultValue={str(v, name, "")}
      aria-invalid={Boolean(e[name]) || undefined}
      aria-describedby={e[name] ? `err-${name}` : undefined}
      className="input"
      {...extra}
    />
  );
  const consents = list(v, "consents", []);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_300px]" noValidate>
      <input type="hidden" name="spaceId" value={props.space.id} />
      <input type="hidden" name="date" value={props.date} />
      <input type="hidden" name="start" value={props.start} />
      <input type="hidden" name="end" value={props.end} />
      <input type="hidden" name="uploadToken" value={props.uploadToken} />

      <div className="flex flex-col gap-6">
        {state.formError && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="rounded border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {state.formError}
          </div>
        )}

        <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
          <legend className="px-1 font-semibold text-navy">신청자 정보</legend>
          <Field label="단체명 *" name="orgName" error={e.orgName}>
            {input("orgName", { autoComplete: "organization", placeholder: "단체명을 입력하세요" })}
          </Field>
          <Field label="담당자 *" name="contactName" error={e.contactName}>
            {input("contactName", { autoComplete: "name", placeholder: "이름" })}
          </Field>
          <Field label="휴대전화 *" name="contactPhone" error={e.contactPhone}>
            {input("contactPhone", { type: "tel", autoComplete: "tel", placeholder: "010-0000-0000", inputMode: "tel" })}
          </Field>
          <Field label="이메일 *" name="contactEmail" error={e.contactEmail}>
            {input("contactEmail", { type: "email", autoComplete: "email", placeholder: "name@example.org" })}
          </Field>
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[180px_1fr]">
            <Field label={`번호 종류${props.regNoRequired ? " *" : ""}`} name="regType" error={e.regType}>
              <select id="f-regType" name="regType" defaultValue={str(v, "regType", "")} className="input">
                <option value="">{props.regNoRequired ? "선택" : "없음"}</option>
                <option value="unique_no">고유번호</option>
                <option value="business_no">사업자등록번호</option>
              </select>
            </Field>
            <Field
              label={`고유번호 또는 사업자등록번호${props.regNoRequired ? " *" : " (선택)"}`}
              name="regNo"
              error={e.regNo}
              hint="같은 단체의 하루 1건·6개월 이용 횟수 확인에 씁니다."
            >
              {input("regNo", { placeholder: "123-45-67890", inputMode: "numeric" })}
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
          <legend className="px-1 font-semibold text-navy">행사 정보</legend>
          <div className="sm:col-span-2">
            <Field label="행사명 *" name="eventTitle" error={e.eventTitle}>
              {input("eventTitle", { placeholder: "행사명을 입력하세요" })}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="행사 목적과 내용 *" name="eventPurpose" error={e.eventPurpose} hint={`심사에 쓰입니다. ${props.minPurposeLength}자 이상 구체적으로 적어 주세요.`}>
              <textarea
                id="f-eventPurpose"
                name="eventPurpose"
                rows={4}
                defaultValue={str(v, "eventPurpose", "")}
                aria-invalid={Boolean(e.eventPurpose) || undefined}
                placeholder="대관 목적과 진행 내용을 구체적으로 작성해 주세요"
                className="input"
              />
            </Field>
          </div>
          <Field
            label="예상 인원 *"
            name="expectedHeadcount"
            error={e.expectedHeadcount}
            hint={`정원 ${props.space.capacity}명${props.space.minHeadcount ? ` · ${props.space.minHeadcount}명 이상` : ""}`}
          >
            <input
              id="f-expectedHeadcount"
              name="expectedHeadcount"
              type="number"
              min={1}
              inputMode="numeric"
              value={headcount}
              onChange={(ev) => setHeadcount(ev.target.value)}
              aria-invalid={Boolean(e.expectedHeadcount) || undefined}
              className="input"
            />
          </Field>
          <div className="flex flex-col gap-1 text-sm font-medium">
            행사 공개 여부
            <div className="flex gap-4 py-2 font-normal">
              {[
                { value: "true", label: "공개 행사" },
                { value: "false", label: "비공개(내부) 행사" },
              ].map((o) => (
                <label key={o.value} className="flex items-center gap-2">
                  <input type="radio" name="eventPublic" value={o.value} defaultChecked={str(v, "eventPublic", "false") === o.value} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {props.night && (
          <fieldset className="grid gap-4 rounded-lg border border-navy/30 bg-white p-5 sm:grid-cols-2">
            <legend className="px-1 font-semibold text-navy">야간 출입문 관리 (필수)</legend>
            <p className="text-xs text-muted sm:col-span-2">야간을 포함한 대관은 출입문을 관리할 담당자가 필요합니다. 18:00 이전에 사용·철수 방법을 인계받아야 합니다.</p>
            <Field label="출입문 관리 담당자 *" name="nightManagerName" error={e.nightManagerName}>
              {input("nightManagerName")}
            </Field>
            <Field label="담당자 연락처 *" name="nightManagerPhone" error={e.nightManagerPhone}>
              {input("nightManagerPhone", { type: "tel", inputMode: "tel", placeholder: "010-0000-0000" })}
            </Field>
          </fieldset>
        )}

        {(props.options.length > 0 || props.discounts.length > 0) && (
          <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
            <legend className="px-1 font-semibold text-navy">옵션·감면</legend>
            {props.options.length > 0 && (
              <div className="flex flex-col gap-2 text-sm">
                <span className="font-medium">부대시설·옵션</span>
                {props.options.map((o) => (
                  <label key={o.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="optionKeys"
                      value={o.key}
                      checked={optionKeys.includes(o.key)}
                      onChange={(ev) => setOptionKeys((ks) => (ev.target.checked ? [...ks, o.key] : ks.filter((k) => k !== o.key)))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            )}
            {props.discounts.length > 0 && (
              <Field label="감면 신청" name="discountRuleId" error={e.discountRuleId} hint="감면은 심사에서 증빙을 확인한 뒤 인정됩니다.">
                <select id="f-discountRuleId" name="discountRuleId" value={discountId} onChange={(ev) => setDiscountId(ev.target.value)} className="input">
                  <option value="">감면 없음</option>
                  {props.discounts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.label})
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
          <legend className="px-1 font-semibold text-navy">첨부파일</legend>
          <p className="text-xs text-muted">
            {props.attachment.extensions.join(", ")} · 파일당 {props.attachment.maxMb}MB · 최대 {props.attachment.maxCount}개
          </p>
          <div className="flex flex-wrap gap-3">
            <label className={`btn-secondary cursor-pointer ${uploading ? "opacity-60" : ""}`}>
              행사계획서 올리기
              <input type="file" className="sr-only" accept={props.attachment.extensions.map((x) => `.${x}`).join(",")} disabled={uploading} onChange={(ev) => upload("event_plan", ev.currentTarget)} />
            </label>
            {discount?.proofRequired && (
              <label className={`btn-secondary cursor-pointer ${uploading ? "opacity-60" : ""}`}>
                감면 증빙 올리기 ({discount.proofGuide})
                <input type="file" className="sr-only" accept={props.attachment.extensions.map((x) => `.${x}`).join(",")} disabled={uploading} onChange={(ev) => upload("discount_proof", ev.currentTarget)} />
              </label>
            )}
          </div>
          {uploading && <p className="text-xs text-muted">올리는 중…</p>}
          {uploadError && <p role="alert" className="text-xs text-danger">{uploadError}</p>}
          {e.attachments && <p className="text-xs text-danger">{e.attachments}</p>}
          {files.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded bg-cream px-3 py-1.5">
                  <span>
                    <span className="mr-2 text-xs text-muted">{f.kind === "discount_proof" ? "감면 증빙" : "행사계획서"}</span>
                    {f.name} <span className="text-xs text-muted">({Math.ceil(f.size / 1024)}KB)</span>
                  </span>
                  <button type="button" className="text-xs text-danger underline" onClick={() => remove(f.id)}>
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
          <legend className="px-1 font-semibold text-navy">규정 동의 (항목별 필수)</legend>
          {e.consents && <p className="text-xs text-danger">{e.consents}</p>}
          {props.consents.map((c) => (
            <div key={c.key} className="rounded border border-line">
              <label className="flex items-center gap-3 px-3 py-2 text-sm font-medium">
                <input type="checkbox" name="consents" value={c.key} defaultChecked={consents.includes(c.key)} className="size-4" />
                {c.label}에 동의합니다.
              </label>
              <details className="border-t border-line px-3 py-2 text-xs">
                <summary className="cursor-pointer text-navy">전문 보기</summary>
                <p className="mt-2 whitespace-pre-line text-muted">{c.text}</p>
              </details>
            </div>
          ))}
        </fieldset>
      </div>

      <aside className="h-fit rounded-lg bg-cream p-5 lg:sticky lg:top-4" aria-labelledby="h-app-summary">
        <p id="h-app-summary" className="text-xs font-semibold text-brick">
          신청 요약
        </p>
        <p className="mt-2 font-serif text-2xl text-navy">{props.space.name}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">이용일</dt>
          <dd className="text-right font-medium">{props.date}</dd>
          <dt className="text-muted">시간</dt>
          <dd className="text-right font-medium">
            {props.start}–{props.end}
          </dd>
        </dl>
        <div className="mt-4 border-t border-brick/30 pt-4" aria-live="polite">
          {price ? (
            <>
              <ul className="flex flex-col gap-1 text-xs">
                {price.items.map((i) => (
                  <li key={i.label} className="flex justify-between gap-2">
                    <span>{i.label}</span>
                    <span>{won(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">결제 금액</p>
              <p className="font-serif text-3xl text-brick">{won(price.total)}</p>
            </>
          ) : (
            <p className="text-sm text-muted">요금 확정 후 표시됩니다.</p>
          )}
          {liveErrors.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-danger">
              {liveErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">결제하면 신청이 접수되고, 담당자가 심사합니다. 반려되면 결제 금액 전액을 환불합니다.</p>
        <button type="submit" className="btn-primary mt-4 w-full" disabled={pending || uploading}>
          {pending ? "제출 중…" : "신청하고 결제하기 →"}
        </button>
      </aside>
    </form>
  );
}
