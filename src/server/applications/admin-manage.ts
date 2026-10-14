import { eq } from "drizzle-orm";
import type { Actor, MutationResult } from "@/server/actor";
import { validateApplicantPassword } from "@/server/applicant/auth";
import { writeAudit } from "@/server/audit/log";
import { hashPassword } from "@/server/auth/password";
import { PermissionError, assertPermission } from "@/server/auth/permissions";
import { applications, attachments, notificationLogs, payments, refunds, slotOccupancies } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import type { PaymentGateway } from "@/server/payments/gateway";
import { createRefund, processRefund } from "@/server/payments/refunds";
import { getStorage } from "@/server/storage/storage";
import { lockApplication, transition, TransitionError } from "./transition";

/**
 * 확정된(최종 승인) 신청의 관리: 예약 취소, 이용완료 표시, 영구 삭제.
 * - 취소·이용완료는 '신청 심사' 권한, 영구 삭제는 시스템 최고 관리자만 한다.
 */

export type CancelBasis = "cancelled" | "venue_fault";

/** 예약 취소: 일정을 다시 열고, 정한 비율만큼 환불 요청을 만든다(계좌이체는 담당자가 이체 후 완료 처리). */
export async function cancelConfirmedApplication(
  db: Db,
  gateway: PaymentGateway | null,
  p: { actor: Actor; applicationId: string; reason: string; refundPercent: number; basis: CancelBasis; notify: boolean },
): Promise<MutationResult<{ refundAmount: number }>> {
  assertPermission(p.actor, "applications.review");
  const reason = p.reason.trim();
  if (reason.length < 2) return { ok: false, formError: "취소 사유를 입력하세요." };
  if (!Number.isInteger(p.refundPercent) || p.refundPercent < 0 || p.refundPercent > 100) return { ok: false, formError: "환불 비율은 0~100 사이 정수입니다." };
  let refundId: string | null = null;
  let refundAmount = 0;
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      if (app.status !== "confirmed" && app.status !== "cancel_requested") throw new TransitionError("예약확정·취소요청 상태인 신청만 여기서 취소할 수 있습니다.");
      await transition(tx, app, "cancelled", {
        actorType: "admin",
        actorId: p.actor.id,
        reason: `예약 취소(${p.basis === "venue_fault" ? "기념관 사정" : "확정 후 취소"}, 환불 ${p.refundPercent}%): ${reason}`,
        patch: { decidedAt: new Date(), decidedBy: p.actor.id, decisionReason: reason },
        ip: p.actor.ip,
      });
      await tx.delete(slotOccupancies).where(eq(slotOccupancies.applicationId, app.id));
      if (p.refundPercent > 0) {
        refundId = await createRefund(tx, { applicationId: app.id, basis: p.basis, ratePercent: p.refundPercent, reason: `예약 취소: ${reason}`, requestedBy: p.actor.id });
        if (refundId) {
          const [r] = await tx.select({ amount: refunds.amount }).from(refunds).where(eq(refunds.id, refundId));
          refundAmount = r?.amount ?? 0;
        }
      }
      if (p.notify) await enqueueApplicationNotification(tx, "cancelled", app.id, { reason, refundAmount });
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  if (refundId) await processRefund(db, gateway, refundId);
  await flushNotifications(db).catch(() => undefined);
  return { ok: true, value: { refundAmount } };
}

/** 이용완료로 표시 (잘못 눌렀으면 예약확정으로 되돌릴 수 있다) */
export async function setCompleted(db: Db, p: { actor: Actor; applicationId: string; completed: boolean }): Promise<MutationResult> {
  assertPermission(p.actor, "applications.review");
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      await transition(tx, app, p.completed ? "completed" : "confirmed", {
        actorType: "admin",
        actorId: p.actor.id,
        reason: p.completed ? "이용완료로 표시" : "이용완료 표시 되돌림",
        ip: p.actor.ip,
      });
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  return { ok: true };
}

/**
 * 영구 삭제 (테스트 데이터·잘못 만든 신청 정리용). 시스템 최고 관리자만, 신청번호를 다시 입력해야 한다.
 * 결제·환불·첨부·알림 기록까지 지우고, 감사 로그에는 삭제한 신청의 요약을 남긴다.
 */
export async function deleteApplication(db: Db, p: { actor: Actor; applicationId: string; confirmNo: string; reason: string }): Promise<MutationResult> {
  if (!p.actor.isSuper) throw new PermissionError();
  const reason = p.reason.trim();
  if (reason.length < 2) return { ok: false, formError: "삭제 사유를 입력하세요." };
  let fileKeys: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      if (p.confirmNo.trim() !== app.applicationNo) throw new TransitionError(`확인란에 신청번호(${app.applicationNo})를 정확히 입력하세요.`);
      const pays = await tx.select().from(payments).where(eq(payments.applicationId, app.id));
      const files = await tx.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.applicationId, app.id));
      fileKeys = files.map((f) => f.key);
      await tx.delete(refunds).where(eq(refunds.applicationId, app.id));
      await tx.delete(payments).where(eq(payments.applicationId, app.id));
      await tx.delete(notificationLogs).where(eq(notificationLogs.applicationId, app.id));
      // 처리 이력·메모·첨부 행·일정 점유는 신청을 지우면 함께 지워진다(on delete cascade)
      await tx.delete(applications).where(eq(applications.id, app.id));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.actor.id,
        action: "application.deleted",
        targetType: "application",
        targetId: app.id,
        before: {
          applicationNo: app.applicationNo,
          status: app.status,
          orgName: app.orgName,
          eventTitle: app.eventTitle,
          startsAt: app.startsAt.toISOString(),
          endsAt: app.endsAt.toISOString(),
          totalAmount: app.totalAmount,
          paidAmount: pays.filter((x) => x.status === "paid").reduce((s, x) => s + x.amount, 0),
          importRef: app.importRef,
        },
        reason,
        ip: p.actor.ip,
      });
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    throw e;
  }
  const storage = getStorage();
  for (const key of fileKeys) await storage.remove(key).catch(() => undefined);
  return { ok: true };
}

/**
 * 나의 대관 비밀번호를 관리자가 다시 정한다(이메일로 확인 코드를 받을 수 없는 신청자가 전화로 요청한 경우 등).
 * 이 신청 하나에만 적용한다. 신청자 본인 확인은 담당자가 전화 등으로 한다.
 */
export async function setApplicantPasswordByAdmin(
  db: Db,
  p: { actor: Actor; applicationId: string; password: string; reason: string },
): Promise<MutationResult> {
  assertPermission(p.actor, "applications.review");
  const reason = p.reason.trim();
  if (reason.length < 2) return { ok: false, formError: "사유를 입력하세요(예: 전화로 본인 확인 후 요청)." };
  const error = validateApplicantPassword(p.password, p.password);
  if (error) return { ok: false, formError: error };
  const hash = await hashPassword(p.password);
  return db.transaction(async (tx) => {
    const rows = await tx.update(applications).set({ applicantPasswordHash: hash }).where(eq(applications.id, p.applicationId)).returning({ id: applications.id });
    if (rows.length === 0) return { ok: false, formError: "신청을 찾을 수 없습니다." } as const;
    await writeAudit(tx, {
      actorType: "admin",
      actorId: p.actor.id,
      action: "application.applicant_password_reset",
      targetType: "application",
      targetId: p.applicationId,
      reason,
      ip: p.actor.ip,
    });
    return { ok: true } as const;
  });
}
