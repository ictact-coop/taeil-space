import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { isValidDateString } from "@/domain/calendar/closures";
import { describeReceipt, parseReceiptRequest, type ReceiptField, type ReceiptRequest } from "@/domain/booking/receipt";
import { fromMinutes, kstDateTime, toMinutes } from "@/domain/booking/time";
import { regTypeLabels, validateRegNo } from "@/domain/organization/reg-no";
import { calculatePrice, type DiscountForPrice } from "@/domain/pricing/calculate";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { kstDateOf } from "@/lib/time";
import { toMinutesOfDay } from "@/lib/time-of-day";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode } from "@/server/actor";
import { writeAudit } from "@/server/audit/log";
import { assertPermission } from "@/server/auth/permissions";
import { occupancyRange } from "@/server/booking/availability";
import { releaseExpiredOverlapping } from "@/server/booking/expire";
import { tstzRange } from "@/server/calendar/block-service";
import { ACTIVE_APPLICATION_STATUSES } from "@/server/calendar/closure-service";
import { applicationStatusHistory, applications, organizations, payments, refunds, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { enqueueApplicationNotification, flushNotifications } from "@/server/notifications/queue";
import type { PaymentGateway } from "@/server/payments/gateway";
import { createRefund, processRefund } from "@/server/payments/refunds";
import { getFeeScheduleAt } from "@/server/pricing/fee-service";
import { getSettings } from "@/server/settings/service";
import { lockApplication, TransitionError } from "./transition";

/**
 * 관리자가 신청 정보를 고친다(전화·메일로 받은 변경 요청, 오타 등).
 * - 공간·일시: 일정을 잡고 있는 상태(입금 대기~예약확정)에서만. 다른 일정과 겹치면 막는다(휴관일·접수 규칙은 담당자 판단에 맡김).
 * - 요금 다시 계산(선택): 지금 요금표로 계산하고 감면·옵션은 그대로 둔다.
 *   입금 전이면 받을 금액을 바꾸고, 입금 후 줄어들면 차액 환불 요청을 만든다. 늘어나면 막는다(차액은 따로 받기).
 * - 바뀐 항목은 처리 이력·감사 로그에 남기고, 고르면 신청자에게 변경 안내 메일을 보낸다.
 */

const time = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, "시각 형식이 올바르지 않습니다.");
const trimmed = (label: string, max: number) => z.string().trim().min(1, `${label}을(를) 입력하세요.`).max(max, `${label}은(는) ${max}자 이하로 입력하세요.`);

export const adminEditSchema = z.object({
  spaceId: z.string().uuid("공간을 선택하세요."),
  date: z.string().refine(isValidDateString, "날짜를 확인하세요."),
  start: time,
  end: time,
  orgName: trimmed("단체명", 100),
  regType: z.enum(["unique_no", "business_no", ""]),
  regNo: z.string().trim().max(20),
  contactName: trimmed("담당자 이름", 50),
  contactPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^0\d{8,10}$/, "전화번호를 확인하세요(예: 010-1234-5678).")),
  contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아닙니다."))]),
  eventTitle: trimmed("행사명", 100),
  eventPurpose: trimmed("행사 목적과 내용", 3000),
  expectedHeadcount: z.coerce.number({ error: "예상 인원을 숫자로 입력하세요." }).int("예상 인원은 정수여야 합니다.").min(1, "예상 인원을 입력하세요.").max(10000),
});

export type AdminEditRaw = Record<keyof z.input<typeof adminEditSchema>, string> & Partial<Record<ReceiptField, string>>;

export interface AdminEditResult {
  changes: string[];
  total: number;
  refundAmount: number;
}

const whenLabel = (date: string, start: number, end: number) => `${date} ${fromMinutes(start)}~${fromMinutes(end)}`;

export async function updateApplicationByAdmin(
  db: Db,
  gateway: PaymentGateway | null,
  p: { actor: Actor; applicationId: string; raw: AdminEditRaw; reason: string; recalculate: boolean; notify: boolean; now?: Date },
): Promise<MutationResult<AdminEditResult>> {
  assertPermission(p.actor, "applications.review");
  const now = p.now ?? new Date();
  const reason = p.reason.trim();
  if (reason.length < 2) return { ok: false, formError: "수정 사유를 입력하세요(예: 전화로 일시 변경 요청)." };
  const parsed = adminEditSchema.safeParse(p.raw);
  const receipt = parseReceiptRequest(p.raw);
  const fieldErrors: Partial<Record<string, string>> = parsed.success ? {} : fieldErrorsFrom(parsed.error.issues);
  if (!receipt.ok) Object.assign(fieldErrors, receipt.errors);
  if (!parsed.success || !receipt.ok) return { ok: false, formError: "입력값을 확인하세요.", fieldErrors };
  const v = parsed.data;
  const startMinutes = toMinutes(v.start);
  const endMinutes = toMinutes(v.end);
  if (endMinutes <= startMinutes) return { ok: false, formError: "입력값을 확인하세요.", fieldErrors: { end: "종료 시각은 시작 시각보다 늦어야 합니다." } };
  let regNo: string | null = null;
  if (v.regType) {
    const r = validateRegNo(v.regType, v.regNo);
    if (!r.ok) return { ok: false, formError: "입력값을 확인하세요.", fieldErrors: { regNo: r.message } };
    regNo = r.digits;
  }

  let refundId: string | null = null;
  let result: AdminEditResult = { changes: [], total: 0, refundAmount: 0 };
  try {
    await db.transaction(async (tx) => {
      const app = await lockApplication(tx, { id: p.applicationId });
      if (!app) throw new TransitionError("신청을 찾을 수 없습니다.");
      const [space] = await tx.select().from(spaces).where(eq(spaces.id, v.spaceId));
      if (!space) throw new TransitionError("공간을 찾을 수 없습니다.");
      const [oldSpace] = app.spaceId ? await tx.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, app.spaceId)) : [];

      const oldDate = kstDateOf(app.startsAt);
      const oldStart = toMinutesOfDay(app.startsAt);
      const oldEnd = toMinutesOfDay(app.endsAt) || 24 * 60;
      const startsAt = kstDateTime(v.date, startMinutes);
      const endsAt = kstDateTime(v.date, endMinutes);
      const scheduleChanged = app.spaceId !== space.id || startsAt.getTime() !== app.startsAt.getTime() || endsAt.getTime() !== app.endsAt.getTime();

      const changes: string[] = [];
      if (scheduleChanged) {
        if (!(ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(app.status)) throw new TransitionError("끝난 신청(철회·반려·취소·이용완료 등)은 공간·일시를 바꿀 수 없습니다.");
        if (app.spaceId !== space.id) changes.push(`공간: ${oldSpace?.name ?? "-"} → ${space.name}`);
        if (startsAt.getTime() !== app.startsAt.getTime() || endsAt.getTime() !== app.endsAt.getTime()) {
          changes.push(`일시: ${whenLabel(oldDate, oldStart, oldEnd)} → ${whenLabel(v.date, startMinutes, endMinutes)}`);
        }
        const range = occupancyRange(space, v.date, startMinutes, endMinutes);
        await releaseExpiredOverlapping(tx, space.id, range.from, range.to, now);
        const moved = await tx
          .update(slotOccupancies)
          .set({ spaceId: space.id, during: tstzRange(range.from, range.to) })
          .where(eq(slotOccupancies.applicationId, app.id))
          .returning({ id: slotOccupancies.id });
        if (moved.length === 0) throw new TransitionError("이 신청이 잡고 있는 일정이 없습니다. 상태를 확인하세요.");
      }

      let organizationId: string | null = null;
      if (v.regType && regNo) {
        const [org] = await tx
          .insert(organizations)
          .values({ regType: v.regType, regNo, latestName: v.orgName })
          .onConflictDoUpdate({ target: organizations.regNo, set: { latestName: v.orgName } })
          .returning({ id: organizations.id });
        organizationId = org!.id;
      }
      const [oldOrg] = app.organizationId ? await tx.select().from(organizations).where(eq(organizations.id, app.organizationId)) : [];
      const label = (t: string, a: string | number, b: string | number) => (String(a) !== String(b) ? changes.push(`${t}: ${a || "-"} → ${b || "-"}`) : 0);
      label("단체명", app.orgName, v.orgName);
      label("단체번호", oldOrg ? `${regTypeLabels[oldOrg.regType]} ${oldOrg.regNo}` : "", regNo && v.regType ? `${regTypeLabels[v.regType]} ${regNo}` : "");
      label("담당자", app.contactName, v.contactName);
      label("연락처", app.contactPhone, v.contactPhone);
      label("이메일", app.contactEmail, v.contactEmail);
      label("행사명", app.eventTitle, v.eventTitle);
      if (app.eventPurpose !== v.eventPurpose) changes.push("행사 목적·내용 수정");
      label("예상 인원", app.expectedHeadcount, v.expectedHeadcount);
      const oldReceipt = describeReceipt(app.receiptRequest as ReceiptRequest | null);
      const newReceipt = describeReceipt(receipt.value);
      if (oldReceipt !== newReceipt) changes.push(`증빙: ${oldReceipt || "없음"} → ${newReceipt || "없음"}`);

      // 요금 다시 계산
      const before = app.totalAmount ?? 0;
      let price = app.priceSnapshot;
      let total = before;
      let policy = (app.policySnapshot as Record<string, unknown> | null) ?? {};
      if (p.recalculate) {
        const fee = await getFeeScheduleAt(tx, now);
        const spaceFee = fee?.items.spaces[space.id];
        if (!fee || !spaceFee) throw new TransitionError("지금 요금표에 이 공간 요금이 없어 다시 계산할 수 없습니다. '요금 다시 계산'을 끄고 저장하세요.");
        const dayEnd = toMinutes((await getSettings(tx, now))["operation.dayEnd"]);
        const discount = (policy.discount as DiscountForPrice | null | undefined) ?? null;
        const next = calculatePrice({
          fee: spaceFee,
          startMinutes,
          endMinutes,
          dayEndMinutes: dayEnd,
          options: fee.items.options,
          selectedOptionKeys: app.optionKeys,
          discount: discount ? { name: discount.name, kind: discount.kind, value: discount.value } : null,
        });
        price = next;
        total = next.total;
        policy = { ...policy, feeScheduleId: fee.id };
        if (total !== before) {
          if (app.status === "pending_payment") {
            if (total <= 0) throw new TransitionError("다시 계산한 금액이 0원입니다. 입금 대기 신청은 0원으로 바꿀 수 없습니다.");
            await tx.update(payments).set({ amount: total, updatedAt: now }).where(and(eq(payments.applicationId, app.id), eq(payments.status, "ready")));
          } else {
            const paid = await tx.select({ amount: payments.amount }).from(payments).where(and(eq(payments.applicationId, app.id), eq(payments.status, "paid")));
            const refunded = await tx
              .select({ amount: refunds.amount })
              .from(refunds)
              .where(and(eq(refunds.applicationId, app.id), inArray(refunds.status, ["requested", "succeeded"])));
            const received = paid.reduce((s, x) => s + x.amount, 0) - refunded.reduce((s, x) => s + x.amount, 0);
            if (total > received) throw new TransitionError(`다시 계산한 금액(${formatWon(total)})이 받은 금액(${formatWon(received)})보다 큽니다. '요금 다시 계산'을 끄고 저장한 뒤 차액은 따로 받으세요.`);
            if (total < received && paid.length > 0) {
              refundId = await createRefund(tx, {
                applicationId: app.id,
                basis: "discount",
                ratePercent: 0,
                amount: received - total,
                reason: `신청 정보 수정 차액: ${reason}`,
                requestedBy: p.actor.id,
              });
              result.refundAmount = received - total;
            }
          }
          changes.push(`금액: ${formatWon(before)} → ${formatWon(total)}`);
        }
      }

      if (changes.length === 0) throw new TransitionError("바뀐 내용이 없습니다.");

      await tx
        .update(applications)
        .set({
          spaceId: space.id,
          startsAt,
          endsAt,
          orgName: v.orgName,
          organizationId,
          contactName: v.contactName,
          contactPhone: v.contactPhone,
          contactEmail: v.contactEmail,
          eventTitle: v.eventTitle,
          eventPurpose: v.eventPurpose,
          expectedHeadcount: v.expectedHeadcount,
          receiptRequest: receipt.value,
          priceSnapshot: price,
          totalAmount: total,
          policySnapshot: policy,
          updatedAt: now,
        })
        .where(eq(applications.id, app.id));
      await tx.insert(applicationStatusHistory).values({
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: app.status,
        actorType: "admin",
        actorId: p.actor.id,
        reason: `신청 정보 수정(${reason}): ${changes.join(" / ")}`,
      });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.actor.id,
        action: "application.edited",
        targetType: "application",
        targetId: app.id,
        before: { spaceId: app.spaceId, startsAt: app.startsAt.toISOString(), endsAt: app.endsAt.toISOString(), totalAmount: before },
        after: { spaceId: space.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), totalAmount: total, changes },
        reason,
        ip: p.actor.ip,
      });
      if (p.notify && v.contactEmail) await enqueueApplicationNotification(tx, "updated", app.id, { reason: changes.join("\n") });
      result = { ...result, changes, total };
    });
  } catch (e) {
    if (e instanceof TransitionError) return { ok: false, formError: e.message };
    if (pgErrorCode(e) === "23P01") return { ok: false, formError: "바꾸려는 일시가 다른 신청·일정 차단과 겹칩니다(준비·철수 시간 포함).", fieldErrors: { start: "다른 일정과 겹칩니다." } };
    throw e;
  }
  if (refundId) await processRefund(db, gateway, refundId);
  if (p.notify) await flushNotifications(db).catch(() => undefined);
  return { ok: true, value: result };
}
