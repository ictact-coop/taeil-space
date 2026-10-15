import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { SettingValues } from "@/domain/settings/definitions";
import { fillTemplate } from "@/domain/messages/template";
import { formatKst, formatKstRange } from "@/lib/time";
import { applications, notificationLogs, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { getSettings } from "@/server/settings/service";
import { sendEmail } from "./mailer";
import { applicantMessage, staffMessage, type MessageContext, type NotificationEvent } from "./templates";

const settingKeyFor: Record<NotificationEvent, keyof SettingValues> = {
  submitted: "notification.submitted",
  revision_requested: "notification.revisionRequested",
  revision_submitted: "notification.revisionRequested",
  rejected: "notification.rejected",
  approved: "notification.approved",
  withdrawn: "notification.cancelled",
  cancelled: "notification.cancelled",
  refunded: "notification.cancelled",
  payment_expired: "notification.cancelled",
  awaiting_deposit: "notification.submitted",
  deposit_reminder: "notification.paymentDeadline",
  // 관리자가 고를 때만 보낸다. 채널(메일·문자)은 신청 접수 알림 설정을 따른다
  updated: "notification.submitted",
};

/** 안내 문구 자리표시자 값 */
export function templateVars(app: { applicationNo: string; orgName: string; contactName: string; startsAt: Date; endsAt: Date }, spaceName: string) {
  return { 일자: formatKstRange(app.startsAt, app.endsAt), 공간: spaceName, 신청번호: app.applicationNo, 단체명: app.orgName, 담당자: app.contactName };
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * 신청 관련 알림을 대기열에 넣는다. 상태를 바꾸는 트랜잭션 안에서 호출해 상태와 알림이 함께 저장되게 한다.
 * 채널은 설정(P-13)에 따른다. 문자(LMS) 발송은 단계 5에서 붙이므로 지금은 "skipped"로 기록한다.
 */
export async function enqueueApplicationNotification(
  tx: DbOrTx,
  event: NotificationEvent,
  applicationId: string,
  extra: Partial<Pick<MessageContext, "reason" | "revisionMessage" | "revisionDeadline" | "refundAmount">> = {},
): Promise<void> {
  const [row] = await tx
    .select({ app: applications, spaceName: spaces.name, approvalNotice: spaces.approvalNotice })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(eq(applications.id, applicationId));
  if (!row) return;
  const settings = await getSettings(tx);
  const { app } = row;
  const [payment] = await tx.select({ method: payments.method }).from(payments).where(eq(payments.applicationId, applicationId)).orderBy(desc(payments.createdAt)).limit(1);
  const [hold] = await tx
    .select({ expiresAt: slotOccupancies.expiresAt })
    .from(slotOccupancies)
    .where(and(eq(slotOccupancies.applicationId, applicationId), eq(slotOccupancies.kind, "pending_payment")))
    .limit(1);
  const ctx: MessageContext = {
    applicationNo: app.applicationNo,
    orgName: app.orgName,
    contactName: app.contactName,
    spaceName: row.spaceName,
    when: `${formatKst(app.startsAt)}–${formatKst(app.endsAt).slice(-5)}`,
    total: app.totalAmount ?? 0,
    myUrl: `${appBaseUrl()}/my/${app.applicationNo}`,
    reviewPeriod: settings["operation.reviewPeriodText"],
    method: payment?.method ?? null,
    // 지금 설정값(오타 수정 등 반영)을 쓰고, 비어 있으면 신청 당시 안내된 값을 쓴다
    bankAccountInfo:
      settings["payment.bankAccountInfo"].trim() ||
      ((app.policySnapshot as { settings?: { values?: Record<string, unknown> } } | null)?.settings?.values?.["payment.bankAccountInfo"] as string | undefined) ||
      null,
    depositDeadline: hold?.expiresAt ? `${formatKst(hold.expiresAt)}까지` : null,
    depositorGuide: fillTemplate(settings["payment.depositorNameGuide"], templateVars(app, row.spaceName)),
    approvalNotice: event === "approved" && row.approvalNotice.trim() ? fillTemplate(row.approvalNotice, templateVars(app, row.spaceName)) : null,
    ...extra,
  };
  const channel = settings[settingKeyFor[event]] as "both" | "email" | "lms" | "off";
  const rows: (typeof notificationLogs.$inferInsert)[] = [];
  const msg = applicantMessage(event, ctx);
  if (channel === "both" || channel === "email") {
    // 노션에서 가져온 신청 등 이메일이 없으면 보내지 않고 기록만 남긴다
    rows.push(
      app.contactEmail.trim()
        ? { applicationId, event, channel: "email", recipient: app.contactEmail, subject: msg.subject, body: msg.body }
        : { applicationId, event, channel: "email", recipient: "", subject: msg.subject, body: msg.body, status: "skipped", error: "신청자 이메일이 없습니다." },
    );
  }
  if (channel === "both" || channel === "lms") {
    const smsOk = Boolean((app.consents as Record<string, string>).smsReceive);
    rows.push({
      applicationId,
      event,
      channel: "lms",
      recipient: app.contactPhone,
      subject: msg.subject,
      body: msg.body,
      status: "skipped",
      error: smsOk ? "문자(LMS) 발송은 단계 5에서 연결합니다." : "신청자가 문자 수신에 동의하지 않았습니다.",
    });
  }
  const staff = staffMessage(event, ctx);
  if (staff) {
    for (const to of settings["notification.staffEmails"]) {
      rows.push({ applicationId, event: `staff:${event}`, channel: "email", recipient: to, subject: staff.subject, body: staff.body });
    }
  }
  if (rows.length > 0) await tx.insert(notificationLogs).values(rows);
}

/** 신청과 무관한 이메일(본인 확인 코드 등)을 대기열에 넣는다. */
export async function enqueueEmail(tx: DbOrTx, event: string, to: string, subject: string, body: string): Promise<void> {
  await tx.insert(notificationLogs).values({ event, channel: "email", recipient: to, subject, body });
}

const MAX_ATTEMPTS = 5;

/** 대기 중인 알림 발송. 커밋 직후와 작업 프로세스(1분마다)에서 호출한다. */
export async function flushNotifications(db: Db, limit = 50): Promise<number> {
  let sent = 0;
  for (let i = 0; i < limit; i += 1) {
    const done = await db.transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(notificationLogs)
        .where(and(eq(notificationLogs.status, "pending"), eq(notificationLogs.channel, "email"), lt(notificationLogs.attempts, MAX_ATTEMPTS)))
        .orderBy(notificationLogs.id)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      try {
        await sendEmail({ to: next.recipient, subject: next.subject, text: next.body });
        await tx.update(notificationLogs).set({ status: "sent", sentAt: new Date(), attempts: next.attempts + 1, error: null }).where(eq(notificationLogs.id, next.id));
        return true;
      } catch (e) {
        const attempts = next.attempts + 1;
        await tx
          .update(notificationLogs)
          .set({ attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
          .where(eq(notificationLogs.id, next.id));
        return false;
      }
    });
    if (done === null) break;
    if (done) sent += 1;
  }
  return sent;
}

/** 관리자 화면: 신청별 알림 이력 */
export function listNotifications(db: DbOrTx, applicationId: string) {
  return db.select().from(notificationLogs).where(eq(notificationLogs.applicationId, applicationId)).orderBy(notificationLogs.id);
}

/** 실패한 알림 다시 보내기 */
export async function retryNotifications(db: DbOrTx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(notificationLogs).set({ status: "pending", attempts: sql`0` }).where(and(inArray(notificationLogs.id, ids), eq(notificationLogs.status, "failed")));
}
