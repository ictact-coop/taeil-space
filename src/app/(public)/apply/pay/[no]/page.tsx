import type { Metadata } from "next";
import Link from "next/link";
import { Paragraphs } from "@/components/public/paragraphs";
import { Steps } from "@/components/public/steps";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { getApplicantView } from "@/server/applicant/current";
import { db } from "@/server/db/client";
import { publicPaymentConfig } from "@/server/payments/gateway";
import { getSettings } from "@/server/settings/service";
import { Countdown } from "./countdown";
import { PayButton } from "./pay-button";

export const metadata: Metadata = { title: "결제" };
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
  const time = `${formatKst(app.startsAt).slice(0, 13)} ${formatKst(app.startsAt).slice(-5)}–${formatKst(app.endsAt).slice(-5)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <Steps current={app.status === "pending_payment" ? 3 : 4} />
      </div>
      <div className="rounded-lg border border-line bg-white p-6">
        <p className="text-xs font-semibold text-brick">신청번호 {app.applicationNo}</p>
        {app.status === "submitted" ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">신청이 접수되었습니다</h1>
            <p className="mt-2 text-sm text-muted">
              결제할 금액이 없어 바로 접수되었습니다. 담당자 심사에 {settings["operation.reviewPeriodText"]}이 걸리며, 결과는 이메일과 문자로 알려드립니다.
            </p>
          </>
        ) : app.status === "payment_expired" || (app.status === "pending_payment" && !pending) ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-navy">결제 기한이 지났습니다</h1>
            <p className="mt-2 text-sm text-muted">기한 안에 결제되지 않아 신청이 취소되었고, 일정은 다시 열렸습니다. 다시 신청해 주세요.</p>
            <Link href="/apply" className="btn-primary mt-4">
              다시 신청하기
            </Link>
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
          <dt className="text-muted">결제 금액</dt>
          <dd className="font-serif text-2xl text-brick">{formatWon(app.totalAmount ?? 0)}</dd>
          {pending && expiresAt && (
            <>
              <dt className="text-muted">결제 기한</dt>
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
            <p className="font-semibold text-navy">계좌이체로 결제해 주세요</p>
            <Paragraphs text={settings["payment.bankAccountInfo"]} className="mt-2" />
            <p className="mt-2 text-xs text-muted">입금자명에 신청번호 {app.applicationNo}를 적어 주세요. 담당자가 입금을 확인하면 신청이 접수됩니다.</p>
          </div>
        )}
        {pending && payment?.method === "pg" && (
          <div className="mt-6 rounded bg-cream p-4 text-sm">
            <p className="font-semibold text-navy">카드로 결제해 주세요</p>
            <p className="mt-1 text-xs text-muted">결제가 확인되면 신청이 접수되고 담당자 심사가 시작됩니다.</p>
            <PayButton applicationNo={app.applicationNo} mode={publicPaymentConfig().mode} />
          </div>
        )}
        {app.status !== "pending_payment" && (
          <Link href={`/my/${app.applicationNo}`} className="btn-secondary mt-6">
            신청 내역 보기
          </Link>
        )}
      </div>
    </div>
  );
}
