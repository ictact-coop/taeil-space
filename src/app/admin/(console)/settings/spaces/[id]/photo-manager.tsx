"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PhotoUploader({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        setError(null);
        const r = await fetch(`/admin/api/spaces/${spaceId}/photos`, { method: "POST", body: new FormData(form) });
        setBusy(false);
        if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "올리지 못했습니다.");
        else {
          form.reset();
          router.refresh();
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        사진 (jpg·png·webp, 5MB 이하)
        <input type="file" name="file" accept=".jpg,.jpeg,.png,.webp" required className="text-sm" />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        사진 설명 (대체 텍스트)
        <input name="alt" required minLength={2} placeholder="세미나실 전경, 긴 책상과 의자 15석" className="input" />
      </label>
      <button type="submit" className="btn-secondary" disabled={busy}>
        {busy ? "올리는 중…" : "사진 올리기"}
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
