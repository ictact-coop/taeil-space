"use client";

import { useState } from "react";

/** 클립보드 복사 버튼. HTTPS가 아닌 환경(일부 내부망)도 고려해 예전 방식으로 한 번 더 시도한다. */
export function CopyButton({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" onClick={copy} className={`btn-secondary px-3 py-1 text-xs ${className}`} aria-live="polite">
      {state === "done" ? "복사했습니다" : state === "failed" ? "복사하지 못했습니다" : label}
    </button>
  );
}
