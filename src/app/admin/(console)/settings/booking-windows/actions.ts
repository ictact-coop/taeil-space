"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { PermissionError } from "@/server/auth/permissions";
import { extendBookingWindow, setBookingWindow } from "@/server/calendar/booking-window-service";
import { db } from "@/server/db/client";
import type { MutationResult } from "@/server/actor";

function back(r: MutationResult, done: string): never {
  revalidatePath("/admin/settings", "layout");
  const error = r.ok ? null : (r.formError ?? Object.values(r.fieldErrors ?? {})[0] ?? "처리하지 못했습니다.");
  redirect(`/admin/settings/booking-windows?${new URLSearchParams(error ? { error } : { done }).toString()}`);
}

async function run(fn: () => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, formError: e.message };
    throw e;
  }
}

export async function extendWindowAction(spaceId: string, form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await run(() =>
    extendBookingWindow(db, { actor: { id: admin.id, role: admin.role, ip: admin.ip }, spaceId, reason: String(form.get("reason") ?? "") }),
  );
  back(r, "접수기간을 연장했습니다.");
}

export async function setWindowAction(spaceId: string, form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await run(() =>
    setBookingWindow(db, {
      actor: { id: admin.id, role: admin.role, ip: admin.ip },
      spaceId,
      opensFrom: String(form.get("opensFrom") ?? ""),
      opensUntil: String(form.get("opensUntil") ?? ""),
      reason: String(form.get("reason") ?? ""),
    }),
  );
  back(r, "접수기간을 저장했습니다.");
}
