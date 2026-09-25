import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { applicationInputSchema, type ApplicationInput } from "@/domain/booking/application-input";
import { checkBooking, halfYearRange, type Violation } from "@/domain/booking/rules";
import { calculatePrice } from "@/domain/pricing/calculate";
import { kstDateTime, toMinutes } from "@/domain/booking/time";
import { validateRegNo } from "@/domain/organization/reg-no";
import { baseConsents, extraConsentCatalog, isExtraConsentKey, nightConsent } from "@/domain/spaces/consents";
import { kstDateOf } from "@/lib/time";
import { writeAudit } from "@/server/audit/log";
import { fieldErrorsFrom, pgErrorCode } from "@/server/actor";
import { ACTIVE_APPLICATION_STATUSES } from "@/server/calendar/closure-service";
import {
  applicationCounters,
  applications,
  applicationStatusHistory,
  attachments,
  organizations,
  payments,
  slotOccupancies,
} from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { getSettingsSnapshot } from "@/server/settings/service";
import { tstzRange } from "@/server/calendar/block-service";
import { hashToken } from "./attachments";
import { occupancyRange } from "./availability";
import { findSpace, listActiveDiscounts, loadBookingContext, loadBusyIntervals } from "./context";
import { releaseExpiredOverlapping } from "./expire";

export type SubmitResult =
  | {
      ok: true;
      applicationNo: string;
      accessToken: string;
      status: "pending_payment" | "submitted";
      total: number;
      expiresAt: Date | null;
    }
  | { ok: false; formError?: string; fieldErrors?: Partial<Record<string, string>>; violations?: Violation[] };

/** 이 신청에 필요한 동의 항목 (계획서 G-3: 항목별 분리 동의) */
export function requiredConsentsFor(space: { extraConsents: string[] }, night: boolean): Record<string, string> {
  const required: Record<string, string> = { ...baseConsents };
  if (night) Object.assign(required, nightConsent);
  for (const key of space.extraConsents.filter(isExtraConsentKey)) required[key] = extraConsentCatalog[key];
  return required;
}

function missingConsents(required: Record<string, string>, given: readonly string[]): string | null {
  const missing = Object.entries(required).filter(([k]) => !given.includes(k));
  return missing.length > 0 ? `다음 항목에 동의해야 합니다: ${missing.map(([, label]) => label).join(", ")}` : null;
}

/** 신청번호: R + 연월 + 월별 일련번호 (R202610-00125) */
async function nextApplicationNo(tx: DbOrTx, now: Date): Promise<string> {
  const month = kstDateOf(now).slice(0, 7).replace("-", "");
  const [row] = await tx
    .insert(applicationCounters)
    .values({ month, last: 1 })
    .onConflictDoUpdate({ target: applicationCounters.month, set: { last: sql`${applicationCounters.last} + 1` } })
    .returning({ last: applicationCounters.last });
  return `R${month}-${String(row!.last).padStart(5, "0")}`;
}

function violationErrors(violations: Violation[]): Partial<Record<string, string>> {
  const map: Record<Violation["field"], string> = {
    date: "date",
    time: "time",
    headcount: "expectedHeadcount",
    organization: "regNo",
    space: "spaceId",
  };
  const errors: Partial<Record<string, string>> = {};
  for (const v of violations) errors[map[v.field]] ??= v.message;
  return errors;
}

/**
 * 신청 제출 (계획서 2.3): 결제대기 신청 생성 + 결제 유효시간 동안 일정 임시 확보.
 * 금액이 0원이면(전액 감면) 결제 없이 바로 신청접수가 된다.
 */
export async function submitApplication(db: Db, raw: Record<string, unknown>, meta: { ip?: string | null } = {}, now: Date = new Date()): Promise<SubmitResult> {
  const parsed = applicationInputSchema.safeParse(raw);
  if (!parsed.success) {
    // 기본 입력 오류와 함께 동의 누락도 한 번에 알려 준다
    const fieldErrors = fieldErrorsFrom(parsed.error.issues);
    const spaceId = typeof raw.spaceId === "string" ? raw.spaceId : "";
    const end = typeof raw.end === "string" && /^\d{2}:\d{2}$/.test(raw.end) ? toMinutes(raw.end) : null;
    const space = /^[0-9a-f-]{36}$/.test(spaceId) ? await findSpace(db, spaceId) : null;
    if (space && end !== null) {
      const dayEnd = toMinutes((await loadBookingContext(db, space, now)).settings["operation.dayEnd"]);
      const consents = Array.isArray(raw.consents) ? raw.consents.map(String) : [];
      const missing = missingConsents(requiredConsentsFor(space, end > dayEnd), consents);
      if (missing) fieldErrors.consents ??= missing;
    }
    return { ok: false, formError: "입력값을 확인하세요.", fieldErrors };
  }
  const input: ApplicationInput = parsed.data;

  const space = await findSpace(db, input.spaceId);
  if (!space) return { ok: false, formError: "공간을 찾을 수 없습니다." };
  const ctx = await loadBookingContext(db, space, now);
  const s = ctx.settings;
  const fieldErrors: Partial<Record<string, string>> = {};

  // 설정에 따라 달라지는 입력 검사
  let regNo: string | null = null;
  if (input.regNo !== "" || s["application.orgRegNoRequired"]) {
    if (input.regType === "") fieldErrors.regType = "번호 종류를 고르세요.";
    else {
      const r = validateRegNo(input.regType, input.regNo);
      if (r.ok) regNo = r.digits;
      else fieldErrors.regNo = r.message;
    }
  }
  const minLen = s["application.minPurposeLength"];
  if (input.eventPurpose.length < minLen) fieldErrors.eventPurpose = `행사 목적과 내용을 ${minLen}자 이상 적어 주세요.`;
  const night = input.endMinutes > ctx.hours.dayEnd;
  if (night) {
    if (!input.nightManagerName) fieldErrors.nightManagerName = "야간 대관은 출입문 관리 담당자를 입력해야 합니다.";
    if (!/^0\d{8,10}$/.test(input.nightManagerPhone.replace(/[\s-]/g, ""))) fieldErrors.nightManagerPhone = "출입문 관리 담당자 연락처를 확인하세요.";
  }
  const requiredConsents = requiredConsentsFor(space, night);
  const missing = missingConsents(requiredConsents, input.consents);
  if (missing) fieldErrors.consents = missing;

  const discount = input.discountRuleId ? (await listActiveDiscounts(db)).find((d) => d.id === input.discountRuleId) ?? null : null;
  if (input.discountRuleId && !discount) fieldErrors.discountRuleId = "선택한 감면을 지금은 쓸 수 없습니다.";

  const tokenHash = hashToken(input.uploadToken);
  const files = await db
    .select({ id: attachments.id, kind: attachments.kind })
    .from(attachments)
    .where(and(eq(attachments.uploadTokenHash, tokenHash), isNull(attachments.applicationId)));
  if (discount?.proofRequired && !files.some((f) => f.kind === "discount_proof")) {
    fieldErrors.attachments = `감면 증빙(${discount.proofGuide})을 첨부해야 합니다.`;
  }
  const fee = ctx.fee?.items.spaces[space.id];
  if (!fee) return { ok: false, formError: "요금표가 준비되지 않아 지금은 신청할 수 없습니다. 기념관에 문의해 주세요." };
  const validOptionKeys = new Set(ctx.fee!.items.options.map((o) => o.key));
  if (input.optionKeys.some((k) => !validOptionKeys.has(k))) fieldErrors.optionKeys = "선택한 옵션을 지금은 쓸 수 없습니다.";
  if (Object.keys(fieldErrors).length > 0) return { ok: false, formError: "입력값을 확인하세요.", fieldErrors };

  const range = occupancyRange(space, input.date, input.startMinutes, input.endMinutes);

  try {
    return await db.transaction(async (tx) => {
      // 같은 단체가 동시에 제출해 BR-03·04를 우회하지 못하게 단체 단위로 직렬화
      if (regNo) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org:${regNo}`}))`);
      await releaseExpiredOverlapping(tx, space.id, range.from, range.to, now);

      let organization: { sameDayCount: number; periodCount: number } | null = null;
      let orgId: string | null = null;
      if (regNo) {
        const [org] = await tx.select().from(organizations).where(eq(organizations.regNo, regNo));
        orgId = org?.id ?? null;
        if (orgId) {
          const period = halfYearRange(input.date, s["application.halfYearLimitMethod"]);
          const statuses =
            s["application.halfYearLimitTarget"] === "confirmed"
              ? (["confirmed", "completed"] as const)
              : (["submitted", "reviewing", "revision_requested", "confirmed", "completed"] as const);
          const orgApps = await tx
            .select({ startsAt: applications.startsAt, status: applications.status })
            .from(applications)
            .where(
              and(
                eq(applications.organizationId, orgId),
                inArray(applications.status, [...ACTIVE_APPLICATION_STATUSES, "completed"]),
                gte(applications.startsAt, new Date(`${period.from < input.date ? period.from : input.date}T00:00:00+09:00`)),
                lte(applications.startsAt, new Date(`${period.to > input.date ? period.to : input.date}T23:59:59+09:00`)),
              ),
            );
          organization = {
            sameDayCount: orgApps.filter((a) => kstDateOf(a.startsAt) === input.date).length,
            periodCount: orgApps.filter((a) => {
              const d = kstDateOf(a.startsAt);
              return d >= period.from && d <= period.to && (statuses as readonly string[]).includes(a.status);
            }).length,
          };
        }
      }

      const busy = await loadBusyIntervals(tx, space.id, range.from, range.to, now);
      const violations = checkBooking(
        { date: input.date, startMinutes: input.startMinutes, endMinutes: input.endMinutes, headcount: input.expectedHeadcount },
        {
          today: ctx.today,
          nowMinutes: ctx.nowMinutes,
          paidRentalStartDate: s["operation.paidRentalStartDate"],
          hours: ctx.hours,
          space: ctx.bookingSpace,
          closureRules: ctx.closureRules,
          bookingWindow: ctx.bookingWindow,
          overlaps: busy.map((b) => b.kind),
          organization,
          rules: {
            onePerOrgPerDay: s["application.onePerOrgPerDay"],
            halfYearLimitEnabled: s["application.halfYearLimitEnabled"],
            halfYearLimitCount: s["application.halfYearLimitCount"],
          },
        },
      );
      if (violations.length > 0) {
        return { ok: false, formError: violations[0]!.message, fieldErrors: violationErrors(violations), violations } as const;
      }

      if (regNo) {
        const [org] = await tx
          .insert(organizations)
          .values({ regType: input.regType as "unique_no" | "business_no", regNo, latestName: input.orgName })
          .onConflictDoUpdate({ target: organizations.regNo, set: { latestName: input.orgName } })
          .returning({ id: organizations.id });
        orgId = org!.id;
      }

      const price = calculatePrice({
        fee,
        startMinutes: input.startMinutes,
        endMinutes: input.endMinutes,
        dayEndMinutes: ctx.hours.dayEnd,
        options: ctx.fee!.items.options,
        selectedOptionKeys: input.optionKeys,
        discount: discount ? { name: discount.name, kind: discount.kind, value: discount.value } : null,
      });
      const free = price.total === 0;
      const method = s["payment.method"];
      const expiresAt = free
        ? null
        : new Date(now.getTime() + (method === "pg" ? s["payment.pgHoldMinutes"] * 60_000 : s["payment.bankTransferHoldHours"] * 3_600_000));
      const status = free ? ("submitted" as const) : ("pending_payment" as const);
      const accessToken = randomBytes(24).toString("base64url");
      const applicationNo = await nextApplicationNo(tx, now);
      const consentAt = now.toISOString();
      const snapshot = await getSettingsSnapshot(tx, now);

      const [app] = await tx
        .insert(applications)
        .values({
          applicationNo,
          status,
          spaceId: space.id,
          organizationId: orgId,
          orgName: input.orgName,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          eventTitle: input.eventTitle,
          eventPurpose: input.eventPurpose,
          eventPublic: input.eventPublic,
          expectedHeadcount: input.expectedHeadcount,
          startsAt: kstDateTime(input.date, input.startMinutes),
          endsAt: kstDateTime(input.date, input.endMinutes),
          nightManagerName: night ? input.nightManagerName : null,
          nightManagerPhone: night ? input.nightManagerPhone : null,
          discountRuleId: discount?.id ?? null,
          optionKeys: input.optionKeys,
          priceSnapshot: price,
          policySnapshot: {
            settings: snapshot,
            feeScheduleId: ctx.fee!.id,
            discount: discount ? { id: discount.id, name: discount.name, kind: discount.kind, value: discount.value, proofRequired: discount.proofRequired } : null,
          },
          totalAmount: price.total,
          consents: Object.fromEntries(Object.keys(requiredConsents).map((k) => [k, consentAt])),
          submittedAt: now,
          paidAt: free ? now : null,
          accessTokenHash: hashToken(accessToken),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: applications.id });

      await tx.insert(slotOccupancies).values({
        spaceId: space.id,
        during: tstzRange(range.from, range.to),
        kind: free ? "held" : "pending_payment",
        applicationId: app!.id,
        expiresAt,
      });
      await tx.insert(payments).values({
        applicationId: app!.id,
        orderId: `${applicationNo}-${randomBytes(4).toString("hex")}`,
        method: free ? "free" : method === "pg" ? "pg" : "bank_transfer",
        amount: price.total,
        status: free ? "paid" : "ready",
        paidAt: free ? now : null,
        createdAt: now,
        updatedAt: now,
      });
      if (files.length > 0) {
        await tx.update(attachments).set({ applicationId: app!.id }).where(and(eq(attachments.uploadTokenHash, tokenHash), isNull(attachments.applicationId)));
      }
      await tx.insert(applicationStatusHistory).values([
        { applicationId: app!.id, fromStatus: null, toStatus: "pending_payment", actorType: "applicant", reason: "신청서 제출" },
        ...(free ? [{ applicationId: app!.id, fromStatus: "pending_payment" as const, toStatus: "submitted" as const, actorType: "system" as const, reason: "결제금액 0원(전액 감면)" }] : []),
      ]);
      await writeAudit(tx, {
        actorType: "applicant",
        action: "application.submit",
        targetType: "application",
        targetId: app!.id,
        after: { applicationNo, status, total: price.total, date: input.date, start: input.start, end: input.end, spaceId: space.id },
        ip: meta.ip,
      });
      return { ok: true, applicationNo, accessToken, status, total: price.total, expiresAt } as const;
    });
  } catch (e) {
    if (pgErrorCode(e) === "23P01") {
      return { ok: false, formError: "방금 다른 신청이 먼저 이 시간을 선택했습니다. 다른 시간을 골라 주세요.", fieldErrors: { time: "이미 선택된 시간입니다." } };
    }
    throw e;
  }
}
