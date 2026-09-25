import Link from "next/link";
import { Paragraphs } from "@/components/public/paragraphs";
import { formatMinutes, formatWon } from "@/domain/pricing/fee-schedule";
import { describeDiscount } from "@/domain/pricing/discount-input";
import { describeRefundTiers } from "@/domain/refund/tiers";
import { getPublicInfo } from "@/server/booking/public-data";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const { settings: s, spaces, fee, discounts } = await getPublicInfo(db);
  const steps = [
    { title: "공간·일정 선택", body: "공간과 날짜·시간을 고르면 신청 조건을 바로 확인하고 예상 금액을 보여 드립니다." },
    { title: "신청정보 입력·결제", body: "단체·행사 정보를 입력하고 규정에 동의한 뒤 결제하면 신청이 접수됩니다." },
    { title: "관리자 심사", body: `담당자가 ${s["operation.reviewPeriodText"]} 안에 심사합니다. 보완이 필요하면 연락드립니다.` },
    { title: "예약확정", body: "승인되면 예약이 확정됩니다. 반려되면 결제 금액 전액을 자동으로 환불합니다." },
  ];

  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1fr_auto] md:py-20">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-[#e98b6f]">SPACE RENTAL · 2026</p>
            <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
              모임의 뜻이
              <br />
              <span className="text-[#e98b6f]">이어지는 공간</span>
            </h1>
            <p className="mt-5 max-w-xl text-white/85">
              전태일기념관의 공간과 일정을 확인하고 온라인으로 대관을 신청하세요. 신청은 결제 후 담당자 심사를 거쳐 확정됩니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/apply" className="btn-primary px-6 py-3 text-base">
                일정 확인 및 신청
              </Link>
              <a href="#rules" className="btn border border-white/60 px-6 py-3 text-base text-white hover:bg-white/10">
                이용규정 보기
              </a>
            </div>
          </div>
          <ol className="flex flex-col gap-3 border-white/20 md:w-72 md:border-l md:pl-8" aria-label="예약 절차">
            <li className="text-xs font-semibold text-white/60">예약 절차</li>
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-center gap-3">
                <span className={`flex size-8 items-center justify-center text-sm ${i === 0 ? "bg-brick" : "border border-white/40"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step.title}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6">
        <section aria-labelledby="h-steps">
          <h2 id="h-steps" className="font-serif text-2xl text-navy">
            대관 절차
          </h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-lg border border-line bg-white p-5">
                <p className="text-xs font-semibold text-brick">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-1 font-semibold text-navy">{step.title}</p>
                <p className="mt-2 text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 rounded-lg bg-cream p-4 text-sm">
            <Paragraphs text={s["content.guideNotice"]} />
          </div>
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
                    {s["operation.dayEnd"]} ~ {s["operation.nightEnd"]} (출입문 관리 담당자 지정 필요)
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
              <li>심사에서 반려되면 결제 금액 전액을 환불합니다.</li>
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
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-cream text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">공간</th>
                  <th scope="col" className="px-4 py-2">정원</th>
                  <th scope="col" className="px-4 py-2">기본 대관료</th>
                  <th scope="col" className="px-4 py-2">추가 요금</th>
                  <th scope="col" className="px-4 py-2">야간 요금</th>
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
                          <td className="px-4 py-2">시간당 {formatWon(f.nightFeePerHour)}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-4 py-2 text-muted">
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
