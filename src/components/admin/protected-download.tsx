"use client";

import { useRef, useState } from "react";

/**
 * 비밀번호를 건 엑셀 내려받기(2026-11 기념관 요청: 개인정보 보호).
 * 버튼을 누르면 비밀번호를 정하는 창이 뜨고, 그 비밀번호로 암호화한 파일을 받는다. 파일을 열 때 같은 비밀번호가 필요하다.
 */
export function ProtectedDownload({ action, fields, label }: { action: string; fields: Record<string, string>; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("password") !== form.get("passwordConfirm")) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(action, { method: "POST", body: form });
      if (!res.ok) {
        setError((await res.text()) || "내려받지 못했습니다.");
        return;
      }
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name ? decodeURIComponent(name) : "download.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      e.currentTarget?.reset();
      dialog.current?.close();
    } catch {
      setError("내려받지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary text-sm" onClick={() => { setError(null); dialog.current?.showModal(); }}>
        {label}
      </button>
      <dialog ref={dialog} className="m-auto w-[min(92vw,24rem)] rounded-lg border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-black/50" aria-labelledby="protected-download-title">
        <form onSubmit={submit} className="flex flex-col gap-3 p-5 text-sm">
          <h2 id="protected-download-title" className="font-semibold text-navy">
            파일 비밀번호 정하기
          </h2>
          <p className="text-xs text-muted">
            개인정보 보호를 위해 엑셀 파일에 비밀번호를 겁니다. 파일을 열 때 이 비밀번호가 필요하니 잊지 않게 따로 전달하세요(메일·메신저에 파일과 함께 보내지 않기).
          </p>
          <label className="flex flex-col gap-1 font-medium">
            비밀번호(6자 이상)
            <input name="password" type="password" required minLength={6} maxLength={100} autoComplete="new-password" className="input" />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            비밀번호 확인
            <input name="passwordConfirm" type="password" required minLength={6} maxLength={100} autoComplete="new-password" className="input" />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => dialog.current?.close()}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "만드는 중…" : "내려받기"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
