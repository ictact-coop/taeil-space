import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Paragraphs } from "@/components/public/paragraphs";
import { Steps } from "@/components/public/steps";
import { extractAccountNumber } from "@/domain/payments/bank-account";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { fillTemplate } from "@/domain/messages/template";
import { templateVars } from "@/server/notifications/queue";
import { getApplicantView } from "@/server/applicant/current";
import { db } from "@/server/db/client";
import { publicPaymentConfig } from "@/server/payments/gateway";
import { getSettings } from "@/server/settings/service";
import { Countdown } from "./countdown";
import { PayButton } from "./pay-button";

export const metadata: Metadata = { title: "결제·입금 안내" };
export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const found = await getApplicantView(no);
  if (!found) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-lg font-semibold text-navy">신청 내역을 찾을 수 없습니다</p>
        <p className="mt-3 text-sm text-muted">신청한 브라우저에서 다시 열거나, 나의 대관에서 이메일 확인 후 조회해 주세요.</p>
        <Link href="/my" className="btn-primary mt-6">
          나의 대관
        </Link>
      </div>
    );
  }
  const { application: app, spaceName, payment, files } = found;
  const settings = await getSettings(db);
  const expiresAt = found.holdExpiresAt;
  const pending = app.status === "pending_payment" && expiresAt !== null && expiresAt > new Date();
  const bank = payment?.method === "bank_transfer";
  // 지금 설정값(오타 수정 등 반영)을 쓰고, 비어 있으면 신청 당시 안내된 값을 쓴다(알림 메일과 같은 규칙)
  const bankInfo =
    settings["payment.bankAccountInfo"].trim() ||
    (((app.policySnapshot as { settings?: { values?: Record<string, unknown> } } | null)?.settings?.values?.["payment.bankAccountInfo"] as string | undefined) ?? "").trim();
  const accountNo = extractAccountNumber(bankInfo);
  const infoLines = bankInfo.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const accountIdx = accountNo ? infoLines.findIndex((l) => l.includes(accountNo)) : -1;
  const accountLine = infoLines[accountIdx >= 0 ? accountIdx : 0] ?? "";
  const restInfo = infoLines.filter((_, i) => i !== (accountIdx >= 0 ? accountIdx : 0)).join("\n");
  const depositorGuide = fillTemplate(settings["payment.depositorNameGuide"], templateVars(app, spaceName));
  const word = bank ? "입금" : "결제";
  const time = `${formatKst(app.startsAt).slice(0, 13)} ${formatKst(app.startsAt).slice(-5)}–${formatKst(app.endsAt).slice(-5)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <Steps current={app.status === "pending_payment" ? 3 : 4} payLabel={word} />
      </div>
      <div className="rounded-lg border border-line bg-white p-6">
        <p className="text-xs font-semibold text-brick">신청번호 {app.applicationNo}</p>
        {app.status === "submitted" ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">신청이 접수되었습니다</h1>
            <p className="mt-2 text-sm text-muted">
              {payment?.method === "free" ? "결제할 금액이 없어 바로 접수되었습니다." : `${word}이 확인되어 접수되었습니다.`} 담당자 심사에 {settings["operation.reviewPeriodText"]}이 걸리며, 결과는 이메일로 알려드립니다.
            </p>
          </>
        ) : app.status === "payment_expired" || (app.status === "pending_payment" && !pending) ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">{word} 기한이 지났습니다</h1>
            <p className="mt-2 text-sm text-muted">
              기한 안에 {word}이 확인되지 않아 신청이 취소되었고, 일정은 다시 열렸습니다. 다시 신청해 주세요.
              {bank && " 기한이 지난 뒤 입금하셨다면 기념관으로 연락해 주세요."}
            </p>
            <Link href="/apply" className="btn-primary mt-4">
              다시 신청하기
            </Link>
          </>
        ) : app.status === "pending_payment" && bank ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">신청을 받았습니다. 입금해 주세요</h1>
            <p className="mt-2 text-sm text-muted">
              입금 기한까지 이 일정을 다른 신청자가 고를 수 없도록 잡아 두었습니다. 담당자가 입금을 확인하면 신청이 접수되고 심사를 시작합니다. 기한 안에 입금이 확인되지
              않으면 신청이 자동 취소됩니다. 입금 안내는 이메일({app.contactEmail})로도 보냈습니다.
            </p>
          </>
        ) : app.status === "pending_payment" ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">결제하면 신청이 접수됩니다</h1>
            <p className="mt-2 text-sm text-muted">결제 기한까지 이 일정을 다른 신청자가 고를 수 없도록 잡아 두었습니다. 기한 안에 결제하지 않으면 신청이 자동 취소됩니다.</p>
          </>
        ) : (
          <h1 className="mt-2 font-serif text-2xl text-navy">신청 상태를 확인하세요</h1>
        )}

        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
          <dt className="text-muted">공간</dt>
          <dd>{spaceName}</dd>
          <dt className="text-muted">일시</dt>
          <dd>{time}</dd>
          <dt className="text-muted">행사명</dt>
          <dd>{app.eventTitle}</dd>
          <dt className="text-muted">{word} 금액</dt>
          <dd className="font-serif text-2xl text-brick">
            {formatWon(app.totalAmount ?? 0)}
            <span className="ml-1 text-xs font-normal text-muted">(부가세 포함)</span>
          </dd>
          {pending && expiresAt && (
            <>
              <dt className="text-muted">{word} 기한</dt>
              <dd>
                {formatKst(expiresAt)}까지 · <Countdown until={expiresAt.toISOString()} />
              </dd>
            </>
          )}
          {files.length > 0 && (
            <>
              <dt className="text-muted">첨부</dt>
              <dd>{files.map((f) => f.name).join(", ")}</dd>
            </>
          )}
        </dl>

        {pending && payment?.method === "bank_transfer" && (
          <div className="mt-6 rounded bg-cream p-4 text-sm">
            <p className="font-semibold text-navy">입금 계좌</p>
            {bankInfo ? (
              <>
                {/* 계좌번호가 든 줄(은행·계좌번호·예금주)을 크게, 나머지 줄(문의처 등)은 그 아래에 */}
                <p className="mt-2 text-lg font-bold tracking-wide break-keep text-ink">{accountLine}</p>
                {restInfo && <Paragraphs text={restInfo} className="mt-2" />}
              </>
            ) : (
              <p className="mt-2">입금 계좌는 기념관에서 따로 안내해 드립니다. 문의 02-318-0903~4</p>
            )}
            <p className="mt-3 text-sm font-medium text-ink">{depositorGuide}</p>
            <p className="mt-1 text-xs text-muted">입금 후 따로 연락하지 않으셔도 담당자가 확인합니다.</p>
            {bankInfo && (
              <div className="mt-3">
                <CopyButton value={accountNo ?? bankInfo} label={accountNo ? "계좌번호 복사" : "계좌 정보 복사"} />
              </div>
            )}
          </div>
        )}
        {pending && payment?.method === "pg" && (
          <div className="mt-6 rounded bg-cream p-4 text-sm">
            <p className="font-semibold text-navy">카드로 결제해 주세요</p>
            <p className="mt-1 text-xs text-muted">결제가 확인되면 신청이 접수되고 담당자 심사가 시작됩니다.</p>
            <PayButton applicationNo={app.applicationNo} mode={publicPaymentConfig().mode} />
          </div>
        )}
        {(app.status !== "pending_payment" || bank) && (
          <Link href={`/my/${app.applicationNo}`} className="btn-secondary mt-6">
            신청 내역 보기
          </Link>
        )}
      </div>
    </div>
  );
}
