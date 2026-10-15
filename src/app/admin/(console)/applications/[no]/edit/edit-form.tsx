"use client";

import { useActionState, useState } from "react";
import { initialFormState, str, type FormState } from "@/components/admin/form-state";
import { FieldError, Notice } from "@/components/admin/ui";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export interface EditInitial {
  [key: string]: string;
}

/** 관리자 신청 정보 수정 폼 */
export function EditApplicationForm({
  action,
  initial,
  spaces,
  scheduleEditable,
  pending: pendingPayment,
  hasEmail,
}: {
  action: Action;
  initial: EditInitial;
  spaces: { id: string; name: string }[];
  scheduleEditable: boolean;
  pending: boolean;
  hasEmail: boolean;
}) {
  const [state, formAction, submitting] = useActionState(action, initialFormState);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const val = (k: string) => str(v, k, initial[k] ?? "");
  const [receiptType, setReceiptType] = useState(val("receiptType") || "none");
  const [cashPurpose, setCashPurpose] = useState(val("cashPurpose") || "income");

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, wide = false) => (
    <label className={`flex flex-col gap-1 text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input name={name} defaultValue={val(name)} className="input" aria-invalid={Boolean(e[name]) || undefined} aria-describedby={e[name] ? `err-${name}` : undefined} {...props} />
      <FieldError id={`err-${name}`} message={e[name]} />
    </label>
  );

  return (
    <form key={state.version} action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <Notice kind="error">{state.formError}</Notice>}

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 font-semibold text-navy">공간·일시</legend>
        {!scheduleEditable && <p className="text-xs text-muted sm:col-span-2">끝난 신청이라 공간·일시는 바꿀 수 없습니다.</p>}
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          공간
          <select name="spaceId" defaultValue={val("spaceId")} className="input" disabled={!scheduleEditable}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {!scheduleEditable && <input type="hidden" name="spaceId" value={val("spaceId")} />}
          <FieldError id="err-spaceId" message={e.spaceId} />
        </label>
        {field("date", "날짜", { type: "date", readOnly: !scheduleEditable })}
        <div className="grid grid-cols-2 gap-3">
          {field("start", "시작", { type: "text", inputMode: "numeric", placeholder: "10:00", pattern: "\\d{2}:\\d{2}", readOnly: !scheduleEditable })}
          {field("end", "종료", { type: "text", inputMode: "numeric", placeholder: "18:00", pattern: "\\d{2}:\\d{2}", readOnly: !scheduleEditable })}
        </div>
        <p className="text-xs text-muted sm:col-span-2">
          다른 신청·일정 차단과 겹치면(준비·철수 시간 포함) 저장되지 않습니다. 휴관일·접수 기간·이용 시간 규칙은 검사하지 않으니 직접 확인하세요. 종료가 자정이면 24:00으로 적습니다.
        </p>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 font-semibold text-navy">단체·담당자</legend>
        {field("orgName", "단체명")}
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            번호 종류
            <select name="regType" defaultValue={val("regType")} className="input">
              <option value="">없음</option>
              <option value="unique_no">고유번호</option>
              <option value="business_no">사업자등록번호</option>
            </select>
          </label>
          {field("regNo", "단체 번호", { inputMode: "numeric", placeholder: "000-00-00000" })}
        </div>
        {field("contactName", "담당자 이름")}
        {field("contactPhone", "휴대전화", { type: "tel", inputMode: "tel" })}
        {field("contactEmail", "이메일", { type: "email" }, true)}
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 font-semibold text-navy">행사</legend>
        {field("eventTitle", "행사명")}
        {field("expectedHeadcount", "예상 인원", { type: "number", min: 1 })}
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          행사 목적과 내용
          <textarea name="eventPurpose" defaultValue={val("eventPurpose")} rows={5} className="input" aria-invalid={Boolean(e.eventPurpose) || undefined} />
          <FieldError id="err-eventPurpose" message={e.eventPurpose} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 font-semibold text-navy">현금영수증·세금계산서</legend>
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          {(
            [
              ["none", "필요 없음"],
              ["cash", "현금영수증"],
              ["tax_invoice", "세금계산서"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="receiptType" value={value} checked={receiptType === value} onChange={() => setReceiptType(value)} />
              {label}
            </label>
          ))}
        </div>
        <FieldError id="err-receiptType" message={e.receiptType} />
        {receiptType === "cash" && (
          <>
            <div className="flex flex-col gap-1 text-sm font-medium">
              용도
              <div className="flex gap-4 font-normal">
                <label className="flex items-center gap-2">
                  <input type="radio" name="cashPurpose" value="income" checked={cashPurpose === "income"} onChange={() => setCashPurpose("income")} />
                  소득공제(개인)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="cashPurpose" value="expense" checked={cashPurpose === "expense"} onChange={() => setCashPurpose("expense")} />
                  지출증빙(사업자)
                </label>
              </div>
            </div>
            {field("cashNumber", cashPurpose === "income" ? "휴대전화 번호" : "사업자등록번호", { inputMode: "numeric" })}
          </>
        )}
        {receiptType === "tax_invoice" && (
          <>
            {field("taxBizNo", "사업자등록번호", { inputMode: "numeric" })}
            {field("taxCompany", "상호(법인명)")}
            {field("taxCeo", "대표자")}
            {field("taxEmail", "받을 이메일", { type: "email" })}
            {field("taxAddress", "사업장 주소", {}, true)}
            {field("taxBizType", "업태")}
            {field("taxBizItem", "종목")}
          </>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
        <legend className="px-1 font-semibold text-navy">저장</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="recalculate" defaultChecked={v ? v.recalculate === "on" : pendingPayment} className="mt-1" />
          <span>
            요금 다시 계산(지금 요금표, 감면·옵션은 그대로)
            <span className="block text-xs text-muted">
              입금 전이면 받을 금액이 바뀝니다. 입금 후 금액이 줄면 차액 환불 요청을 만들고, 늘어나면 저장되지 않습니다(차액은 따로 받기). 끄면 금액은 그대로 둡니다.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="notify" defaultChecked={v ? v.notify === "on" : false} disabled={!hasEmail} className="mt-1" />
          <span>
            신청자에게 변경 안내 메일 보내기
            <span className="block text-xs text-muted">{hasEmail ? "바뀐 항목을 적어 신청자 이메일로 보냅니다." : "신청에 이메일이 없어 보낼 수 없습니다."}</span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          수정 사유
          <input name="reason" defaultValue={val("reason")} required minLength={2} placeholder="예: 전화로 일시 변경 요청" className="input" />
        </label>
        <button type="submit" className="btn-primary self-start" disabled={submitting}>
          저장
        </button>
      </fieldset>
    </form>
  );
}
