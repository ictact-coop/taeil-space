import type { Metadata } from "next";
import Link from "next/link";
import { Steps } from "@/components/public/steps";
import { toMinutes } from "@/domain/booking/time";
import { isValidDateString } from "@/domain/calendar/closures";
import { feeOptionUnitLabels, formatWon } from "@/domain/pricing/fee-schedule";
import { describeDiscount } from "@/domain/pricing/discount-input";
import { baseConsents, extraConsentCatalog, isExtraConsentKey, nightConsent } from "@/domain/spaces/consents";
import { describeRefundTiers } from "@/domain/refund/tiers";
import { newUploadToken } from "@/server/booking/attachments";
import { quote } from "@/server/booking/availability";
import { findSpace, listActiveDiscounts, loadBookingContext } from "@/server/booking/context";
import { db } from "@/server/db/client";
import { submitApplicationAction } from "./actions";
import { ApplicationForm } from "./application-form";

export const metadata: Metadata = { title: "신청정보 입력" };
export const dynamic = "force-dynamic";

function Problem({ message, back }: { message: string; back: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-lg font-semibold text-navy">선택한 일정으로 신청할 수 없습니다</p>
      <p className="mt-3 text-sm text-danger">{message}</p>
      <Link href={back} className="btn-primary mt-6">
        일정 다시 고르기
      </Link>
    </div>
  );
}

export default async function ApplicationFormPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const space = q.space ? await findSpace(db, q.space) : null;
  const back = `/apply${space ? `?space=${space.code}` : ""}`;
  if (!space || !space.isPublic || !q.date || !isValidDateString(q.date) || !/^\d{2}:\d{2}$/.test(q.start ?? "") || !/^\d{2}:\d{2}$/.test(q.end ?? "")) {
    return <Problem message="공간과 일정을 먼저 선택하세요." back={back} />;
  }
  const startMinutes = toMinutes(q.start!);
  const endMinutes = toMinutes(q.end!);
  const [ctx, check, discounts] = await Promise.all([
    loadBookingContext(db, space),
    quote(db, space, { date: q.date, startMinutes, endMinutes, headcount: null }),
    listActiveDiscounts(db),
  ]);
  if (check.violations.length > 0) return <Problem message={check.violations[0]!.message} back={back} />;
  if (check.feeMissing) return <Problem message="요금표가 준비되지 않아 지금은 신청할 수 없습니다." back={back} />;

  const s = ctx.settings;
  const night = endMinutes > ctx.hours.dayEnd;
  const refundText = `심사에서 반려되면 전액 환불합니다.\n승인 전 신청을 철회하면 ${s["payment.withdrawRefundPercent"]}%를 환불합니다.\n예약확정 후 취소: ${describeRefundTiers(s["payment.refundTiers"])}\n기념관 사정으로 취소되면 전액 환불합니다.`;
  const texts: Record<string, string> = {
    privacy: s["content.privacyPolicy"],
    operationRules: s["content.operationRules"],
    refundRules: refundText,
    nightRules: s["content.nightRules"],
    hallRules: s["content.hallRules"],
  };
  const consentList: Record<string, string> = { ...baseConsents, ...(night ? nightConsent : {}) };
  for (const key of space.extraConsents.filter(isExtraConsentKey)) consentList[key] = extraConsentCatalog[key];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold text-brick">대관 신청</p>
      <h1 className="mt-1 font-serif text-3xl text-navy">신청정보 입력</h1>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <Steps current={2} />
        <Link href={`/apply?${new URLSearchParams({ space: space.code, date: q.date, start: q.start!, end: q.end! }).toString()}`} className="text-sm text-navy underline">
          ‹ 일정 다시 고르기
        </Link>
      </div>
      <ApplicationForm
        action={submitApplicationAction}
        props={{
          space: { id: space.id, name: space.name, capacity: space.capacity, minHeadcount: space.minHeadcount },
          date: q.date,
          start: q.start!,
          end: q.end!,
          night,
          options: (ctx.fee?.items.options ?? []).map((o) => ({ key: o.key, name: o.name, label: `${o.name} (${feeOptionUnitLabels[o.unit]} ${formatWon(o.fee)})` })),
          discounts: discounts.map((d) => ({ id: d.id, name: d.name, label: describeDiscount(d), proofRequired: d.proofRequired, proofGuide: d.proofGuide, description: d.description })),
          consents: Object.entries(consentList).map(([key, label]) => ({ key, label, text: texts[key] ?? "" })),
          minPurposeLength: s["application.minPurposeLength"],
          regNoRequired: s["application.orgRegNoRequired"],
          attachment: {
            extensions: s["application.attachmentExtensions"],
            maxMb: s["application.attachmentMaxMb"],
            maxCount: s["application.attachmentMaxCount"],
          },
          uploadToken: newUploadToken(),
          initialPrice: check.price,
        }}
      />
    </div>
  );
}
