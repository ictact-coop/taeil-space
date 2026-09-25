import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { SettingValues } from "@/domain/settings/definitions";
import { formatKst } from "@/lib/time";
import { applications, notificationLogs, spaces } from "@/server/db/schema";
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
  refunded: "notification.cancelled",
  payment_expired: "notification.cancelled",
};

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
    .select({ app: applications, spaceName: spaces.name })
    .from(applications)
    .innerJoin(spaces, eq(spaces.id, applications.spaceId))
    .where(eq(applications.id, applicationId));
  if (!row) return;
  const settings = await getSettings(tx);
  const { app } = row;
  const ctx: MessageContext = {
    applicationNo: app.applicationNo,
    orgName: app.orgName,
    contactName: app.contactName,
    spaceName: row.spaceName,
    when: `${formatKst(app.startsAt)}–${formatKst(app.endsAt).slice(-5)}`,
    total: app.totalAmount ?? 0,
    myUrl: `${appBaseUrl()}/my/${app.applicationNo}`,
    reviewPeriod: settings["operation.reviewPeriodText"],
    ...extra,
  };
  const channel = settings[settingKeyFor[event]] as "both" | "email" | "lms" | "off";
  const rows: (typeof notificationLogs.$inferInsert)[] = [];
  const msg = applicantMessage(event, ctx);
  if (channel === "both" || channel === "email") {
    rows.push({ applicationId, event, channel: "email", recipient: app.contactEmail, subject: msg.subject, body: msg.body });
  }
  if (channel === "both" || channel === "lms") {
    rows.push({ applicationId, event, channel: "lms", recipient: app.contactPhone, subject: msg.subject, body: msg.body, status: "skipped", error: "문자(LMS) 발송은 단계 5에서 연결합니다." });
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
