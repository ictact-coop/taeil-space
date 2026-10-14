import Link from "next/link";
import { Paragraphs } from "@/components/public/paragraphs";
import { RentalSteps } from "@/components/public/rental-steps";
import { formatMinutes, formatWon } from "@/domain/pricing/fee-schedule";
import { describeDiscount } from "@/domain/pricing/discount-input";
import { describeRefundTiers } from "@/domain/refund/tiers";
import { getPublicInfo } from "@/server/booking/public-data";
import { effectivePaymentMethod } from "@/server/payments/gateway";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const { settings: s, spaces, fee, discounts } = await getPublicInfo(db);
  const bank = effectivePaymentMethod(s["payment.method"]) === "bankTransfer";
  const word = bank ? "입금" : "결제";

  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1fr_auto] md:items-center md:py-20">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[#e98b6f]">SPACE RENTAL · 2026</p>
            <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
              모임의 뜻이
              <br />
              <span className="text-[#e98b6f]">이어지는 공간</span>
            </h1>
            <p className="mt-5 max-w-xl text-white/85">
              전태일기념관의 공간과 일정을 확인하고 온라인으로 대관을 신청하세요. 신청은 {word} 후 담당자 심사를 거쳐 확정됩니다.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 border-white/20 md:w-80 md:border-l md:pl-10">
            <Link
              href="/apply"
              className="flex items-center justify-center gap-3 rounded-lg bg-brick px-8 py-7 text-2xl font-bold text-white shadow-lg ring-1 ring-white/10 transition hover:bg-brick-dark focus-visible:outline-offset-4 sm:text-3xl"
            >
              대관 신청
              <span aria-hidden>→</span>
            </Link>
            <a href="#rules" className="btn self-center border border-white/50 px-4 py-2 text-sm text-white hover:bg-white/10 md:self-stretch">
              이용규정 보기
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6">
        <section aria-labelledby="h-steps">
          <h2 id="h-steps" className="font-serif text-2xl text-navy">
            대관 절차
          </h2>
          <div className="mt-8">
            <RentalSteps />
          </div>
          {s["content.guideNotice"].trim() && (
            <div className="mt-8 rounded-lg bg-cream p-4 text-sm">
              <Paragraphs text={s["content.guideNotice"]} />
            </div>
          )}
        </section>

        <section aria-labelledby="h-time" className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-white p-5">
            <h2 id="h-time" className="font-serif text-xl text-navy">
              이용 시간
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted">주간</dt>
              <dd>
                {s["operation.dayStart"]} ~ {s["operation.dayEnd"]}
              </dd>
              {s["operation.nightEnabled"] && (
                <>
                  <dt className="text-muted">야간</dt>
                  <dd>
                    {s["operation.dayEnd"]} ~ {s["operation.nightEnd"]}
                    {s["operation.nightOnWeekends"] ? "" : " (평일만, 토·일요일은 야간 대관 불가)"}
                  </dd>
                </>
              )}
              <dt className="text-muted">신청 기한</dt>
              <dd>공간별로 다릅니다(보통 이용일 2주 전까지). 교육실은 공개된 접수기간 안에서만 신청합니다.</dd>
              <dt className="text-muted">휴관일</dt>
              <dd>달력에서 선택할 수 없는 날로 표시됩니다.</dd>
            </dl>
          </div>
          <div className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-serif text-xl text-navy">취소·환불 기준</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
              <li>심사에서 반려되면 {word} 금액 전액을 환불합니다.</li>
              <li>승인 전에 신청을 철회하면 {s["payment.withdrawRefundPercent"]}%를 환불합니다.</li>
              <li>예약확정 후 취소: {describeRefundTiers(s["payment.refundTiers"])}</li>
              <li>기념관 사정으로 취소되면 전액 환불합니다.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="h-fee">
          <h2 id="h-fee" className="font-serif text-2xl text-navy">
            공간과 요금
          </h2>
          <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-cream text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">공간</th>
                  <th scope="col" className="px-4 py-2">정원</th>
                  <th scope="col" className="px-4 py-2">기본 대관료</th>
                  <th scope="col" className="px-4 py-2">추가 요금</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {spaces.map((space) => {
                  const f = fee?.items.spaces[space.id];
                  return (
                    <tr key={space.id}>
                      <th scope="row" className="px-4 py-2 font-medium">
                        <Link href={`/spaces/${space.code}`} className="text-navy underline">
                          {space.name}
                        </Link>
                      </th>
                      <td className="px-4 py-2">
                        {space.capacity}명{space.minHeadcount ? ` (${space.minHeadcount}명 이상)` : ""}
                      </td>
                      {f ? (
                        <>
                          <td className="px-4 py-2">
                            {formatMinutes(f.baseMinutes)} {formatWon(f.baseFee)}
                          </td>
                          <td className="px-4 py-2">
                            {formatMinutes(f.extraUnitMinutes)}당 {formatWon(f.extraFee)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className="px-4 py-2 text-muted">
                          요금 확정 후 안내
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {discounts.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              감면: {discounts.map((d) => `${d.name}(${describeDiscount(d)}${d.proofRequired ? `, 증빙: ${d.proofGuide}` : ""})`).join(" · ")}
            </p>
          )}
        </section>

        <section id="rules" aria-labelledby="h-rules" className="rounded-lg border border-line bg-white p-5">
          <h2 id="h-rules" className="font-serif text-2xl text-navy">
            대관 운영규정
          </h2>
          <Paragraphs text={s["content.operationRules"]} className="mt-3 text-sm" />
        </section>

        <div className="text-center">
          <Link href="/apply" className="btn-primary px-8 py-3 text-base">
            일정 확인 및 신청
          </Link>
        </div>
      </div>
    </>
  );
}
