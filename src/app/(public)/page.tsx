import Link from "next/link";
import { sanitizeHtml } from "@/lib/sanitize-html";
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
      <section
        className="relative bg-[#5795c6] bg-[length:auto_360px] bg-right-bottom bg-no-repeat md:bg-cover"
        style={{ backgroundImage: "url(/images/hero.jpg)" }}
        aria-label="전태일기념관 대관 안내"
      >
        {/* 좁은 화면: 글·버튼 아래에 그림(건물)이 보이도록 아래 여백을 둔다. 그림 위쪽 하늘색과 배경색이 같아 이음새가 없다 */}
        <div className="mx-auto grid max-w-6xl gap-6 px-4 pt-8 pb-[280px] sm:px-6 md:min-h-[500px] md:grid-cols-[minmax(0,1fr)_auto] md:gap-8 md:pt-14 md:pb-10">
          {s["content.heroHtml"].trim() ? (
            // 정책 설정의 안내 상자 HTML(허용 목록으로 거른 뒤 넣는다)
            <div
              className="max-w-xl self-start rounded-2xl bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(s["content.heroHtml"]) }}
            />
          ) : (
            <div />
          )}
          {/* 건물 위 하늘에 '대관 신청'(크게)과 '이용규정 보기'(작게, 두 줄로 같은 높이) */}
          <div className="flex items-stretch gap-3 md:self-start md:pt-2">
            <Link
              href="/apply"
              className="flex flex-1 items-center justify-center gap-3 rounded-lg bg-brick px-8 py-6 text-2xl font-bold text-white shadow-lg transition hover:bg-brick-dark focus-visible:outline-offset-4 sm:text-3xl md:flex-none"
            >
              대관 신청
              <svg viewBox="0 0 24 24" className="size-7 sm:size-8" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
                <path d="m9 15.5 2 2 4-4" />
              </svg>
            </Link>
            <a
              href="#rules"
              className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-navy/30 bg-white/85 px-4 text-center text-sm leading-snug font-semibold text-navy shadow-sm transition hover:bg-white"
            >
              <span>이용규정</span>
              <span>보기</span>
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 pt-6 pb-12 sm:px-6">
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
              <dt className="text-muted">휴관일</dt>
              <dd>달력에서 선택할 수 없는 날로 표시됩니다.</dd>
            </dl>
          </div>
          <div className="rounded-lg border border-line bg-white p-5">
            <h2 className="font-serif text-xl text-navy">취소·환불 기준</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
              <li>심사에서 반려되면 {word} 금액 전액을 환불합니다.</li>
              <li>승인 전에 신청을 철회하면 {s["payment.withdrawRefundPercent"]}%를 환불합니다.</li>
              <li>
                예약 확정 후 환불 요청이 정당하다고 인정되는 경우(당일 취소 불가)
                {s["payment.refundTiers"].length > 0 && `: ${describeRefundTiers(s["payment.refundTiers"])}`}
              </li>
              <li>기념관 사정으로 취소되면 전액 환불합니다.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="h-fee">
          <h2 id="h-fee" className="font-serif text-2xl text-navy">
            공간과 요금
          </h2>
          <p className="mt-1 text-sm text-muted">표시된 요금은 모두 부가세 포함 금액입니다.</p>
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
