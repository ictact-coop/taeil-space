"use client";

import { useId, useRef, useState } from "react";

/**
 * 신청하기 전 확인 팝업. 안내 문구(정책 설정)를 보여 주고, 확인 체크를 해야 제출 버튼이 켜진다.
 * 반드시 <form> 안에 둔다(팝업의 버튼이 그 폼을 제출한다). 안내 문구가 비어 있으면 바로 제출한다.
 */
export function SubmitConfirm({ notices, label, disabled }: { notices: string[]; label: string; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);
  const titleId = useId();

  /** 필수 항목(동의 체크 포함)이 비어 있으면 팝업을 열거나 제출하지 않고 그 칸을 알려 준다 */
  const formIsReady = (button: HTMLButtonElement) => {
    const form = button.form;
    if (!form || form.checkValidity()) return true;
    form.reportValidity();
    return false;
  };

  if (notices.length === 0) {
    return (
      <button type="submit" className="btn-primary mt-4 w-full" disabled={disabled} onClick={(e) => !formIsReady(e.currentTarget) && e.preventDefault()}>
        {label}
      </button>
    );
  }
  const close = () => {
    dialog.current?.close();
    setChecked(false);
  };
  return (
    <>
      <button type="button" className="btn-primary mt-4 w-full" disabled={disabled} onClick={(e) => formIsReady(e.currentTarget) && dialog.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(92vw,30rem)] rounded-lg border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-black/50"
        onClose={() => setChecked(false)}
      >
        <div className="p-6">
          <h2 id={titleId} className="font-serif text-xl text-navy">
            신청 전에 확인해 주세요
          </h2>
          <ol className="mt-4 flex flex-col gap-2 text-sm leading-relaxed">
            {notices.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-brick">{i + 1}.</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
          <label className="mt-5 flex items-start gap-2 rounded bg-cream p-3 text-sm font-medium">
            <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            위 내용을 확인했습니다.
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={!checked || disabled} onClick={() => setTimeout(close, 0)}>
              확인하고 신청하기
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
