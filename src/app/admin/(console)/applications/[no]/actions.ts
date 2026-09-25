"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withNotice } from "@/lib/url";
import type { MutationResult } from "@/server/actor";
import { addNote, approveApplication, confirmDeposit, rejectApplication, requestRevision, startReview } from "@/server/applications/review";
import { requireAdmin, type CurrentAdmin } from "@/server/auth/current";
import { PermissionError } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { getGateway } from "@/server/payments/gateway";
import { completeManualRefund, retryRefund } from "@/server/payments/refunds";

async function run(no: string, done: string, fn: (admin: CurrentAdmin) => Promise<MutationResult>): Promise<never> {
  const admin = await requireAdmin();
  let result: MutationResult;
  try {
    result = await fn(admin);
  } catch (e) {
    if (!(e instanceof PermissionError)) throw e;
    result = { ok: false, formError: e.message };
  }
  revalidatePath(`/admin/applications/${no}`);
  const path = `/admin/applications/${no}`;
  redirect(result.ok ? withNotice(path, { done }) : withNotice(path, { error: result.formError ?? Object.values(result.fieldErrors ?? {})[0] ?? "처리하지 못했습니다." }));
}

const actor = (a: CurrentAdmin) => ({ id: a.id, role: a.role, ip: a.ip });
const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function startReviewAction(no: string, id: string): Promise<void> {
  await run(no, "검토를 시작했습니다.", (a) => startReview(db, { actor: actor(a), applicationId: id }));
}
export async function requestRevisionAction(no: string, id: string, f: FormData): Promise<void> {
  await run(no, "보완을 요청하고 신청자에게 알렸습니다.", (a) => requestRevision(db, { actor: actor(a), applicationId: id, message: s(f, "message") }));
}
export async function rejectAction(no: string, id: string, f: FormData): Promise<void> {
  await run(no, "반려하고 전액 환불을 요청했습니다.", (a) => rejectApplication(db, getGateway(), { actor: actor(a), applicationId: id, reason: s(f, "reason") }));
}
export async function approveAction(no: string, id: string, f: FormData): Promise<void> {
  await run(no, "승인했습니다. 예약이 확정되었습니다.", (a) => approveApplication(db, { actor: actor(a), applicationId: id, note: s(f, "note") }));
}
export async function confirmDepositAction(no: string, id: string, f: FormData): Promise<void> {
  await run(no, "입금을 확인했습니다. 신청이 접수되었습니다.", (a) => confirmDeposit(db, { actor: actor(a), applicationId: id, note: s(f, "note") }));
}
export async function addNoteAction(no: string, id: string, f: FormData): Promise<void> {
  await run(no, "메모를 남겼습니다.", (a) => addNote(db, { actor: actor(a), applicationId: id, body: s(f, "body") }));
}
export async function manualRefundAction(no: string, refundId: string, f: FormData): Promise<void> {
  await run(no, "환불 완료로 기록했습니다.", async (a) => {
    if (!["system", "rental", "accounting"].includes(a.role)) throw new PermissionError();
    return completeManualRefund(db, { actor: actor(a), refundId, note: s(f, "note") });
  });
}
export async function retryRefundAction(no: string, refundId: string): Promise<void> {
  await run(no, "환불을 다시 처리했습니다.", async (a) => {
    if (!["system", "rental", "accounting"].includes(a.role)) throw new PermissionError();
    return retryRefund(db, getGateway(), { actor: actor(a), refundId });
  });
}
