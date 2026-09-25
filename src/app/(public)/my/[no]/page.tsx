import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Steps } from "@/components/public/steps";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { toMinutes } from "@/domain/booking/time";
import { formatKst } from "@/lib/time";
import { toMinutesOfDay } from "@/lib/time-of-day";
import { getApplicantView } from "@/server/applicant/current";
import { statusLabels } from "@/server/applications/transition";
import { newUploadToken } from "@/server/booking/attachments";
import { db } from "@/server/db/client";
import { refundBasisLabels } from "@/server/payments/refunds";
import { getSettings } from "@/server/settings/service";
import { submitRevisionAction, withdrawAction } from "../actions";
import { RevisionForm } from "./revision-form";

export const metadata: Metadata = { title: "신청 상세" };
export const dynamic = "force-dynamic";

const paidMessages: Record<string, string> = {
  paid: "결제가 완료되어 신청이 접수되었습니다. 심사 결과를 이메일로 알려 드립니다.",
  already: "이미 결제가 완료된 신청입니다.",
  late_refunded: "결제 기한이 지난 뒤 결제되어 신청을 진행할 수 없습니다. 결제 금액은 전액 환불됩니다.",
  amount_mismatch: "결제 금액이 신청 금액과 달라 결제를 취소하고 환불합니다. 기념관에 문의해 주세요.",
};

export default async function MyApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ paid?: string; done?: string; error?: string }>;
}) {
  const { no } = await params;
  const q = await searchParams;
  const view = await getApplicantView(no);
  if (!view) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-lg font-semibold text-navy">신청 내역을 볼 수 없습니다</p>
        <p className="mt-3 text-sm text-muted">이메일 확인 후 다시 열어 주세요.</p>
        <Link href="/my" className="btn-primary mt-6">
          나의 대관
        </Link>
      </div>
    );
  }
  const { application: a, spaceName } = view;
  const settings = await getSettings(db);
  const step = a.status === "pending_payment" ? 3 : 4;
  const canWithdraw = ["pending_payment", "submitted", "reviewing", "revision_requested"].includes(a.status);
  const snapshotRate = (a.policySnapshot as { settings?: { values?: Record<string, number> } } | null)?.settings?.values?.["payment.withdrawRefundPercent"];
  const withdrawRate = snapshotRate ?? settings["payment.withdrawRefundPercent"];
  const night = toMinutesOfDay(a.endsAt) > toMinutes(settings["operation.dayEnd"]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/my" className="text-sm text-navy underline">
        ‹ 나의 대관
      </Link>
      <div className="my-4">
        <Steps current={step} />
      </div>
      <div className="flex flex-col gap-3">
        {q.paid && paidMessages[q.paid] && <Notice kind={q.paid === "paid" || q.paid === "already" ? "success" : "warning"}>{paidMessages[q.paid]}</Notice>}
        {q.done && <Notice kind="success">{q.done}</Notice>}
        {q.error && <Notice kind="error">{q.error}</Notice>}
      </div>

      <section className="mt-4 rounded-lg border border-line bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-brick">신청번호 {a.applicationNo}</p>
          <StatusBadge status={a.status} />
        </div>
        <h1 className="mt-2 font-serif text-2xl text-navy">
          {spaceName} · {a.eventTitle}
        </h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">일시</dt>
          <dd>
            {formatKst(a.startsAt)}–{formatKst(a.endsAt).slice(-5)}
          </dd>
          <dt className="text-muted">인원</dt>
          <dd>{a.expectedHeadcount}명</dd>
          <dt className="text-muted">결제 금액</dt>
          <dd>{formatWon(a.totalAmount ?? 0)}</dd>
          {a.status === "confirmed" && (
            <>
              <dt className="text-muted">안내</dt>
              <dd>예약이 확정되었습니다. 18:00 이전에 담당자에게 사용·철수 방법을 인계받아 주세요.</dd>
            </>
          )}
          {a.decisionReason && a.status === "rejected" && (
            <>
              <dt className="text-muted">반려 사유</dt>
              <dd>{a.decisionReason}</dd>
            </>
          )}
        </dl>
        {a.status === "pending_payment" && (
          <Link href={`/apply/pay/${a.applicationNo}`} className="btn-primary mt-4">
            결제하러 가기
          </Link>
        )}
      </section>

      {a.status === "revision_requested" && (
        <section className="mt-4 rounded-lg border border-warning/40 bg-white p-6">
          <h2 className="font-semibold text-navy">보완 요청</h2>
          <p className="mt-2 whitespace-pre-line rounded bg-cream p-3 text-sm">{a.revisionMessage}</p>
          {a.revisionDeadline && <p className="mt-2 text-xs text-warning">제출 기한: {formatKst(a.revisionDeadline)}까지 (기한이 지나면 신청이 종료되고 전액 환불됩니다)</p>}
          <div className="mt-4">
            <RevisionForm
              action={submitRevisionAction.bind(null, a.applicationNo)}
              initial={{
                contactName: a.contactName,
                contactPhone: a.contactPhone,
                eventTitle: a.eventTitle,
                eventPurpose: a.eventPurpose,
                eventPublic: a.eventPublic,
                expectedHeadcount: a.expectedHeadcount,
                nightManagerName: a.nightManagerName ?? "",
                nightManagerPhone: a.nightManagerPhone ?? "",
                night,
                uploadToken: newUploadToken(),
                extensions: settings["application.attachmentExtensions"],
              }}
            />
          </div>
        </section>
      )}

      <section className="mt-4 rounded-lg border border-line bg-white p-6">
        <h2 className="font-semibold text-navy">처리 이력</h2>
        <ol className="mt-3 flex flex-col gap-2 border-l-2 border-line pl-4 text-sm">
          {view.history.map((h) => (
            <li key={h.id}>
              <span className="font-medium">{statusLabels[h.toStatus]}</span> <span className="text-xs text-muted">{formatKst(h.createdAt)}</span>
              {h.reason && h.actorType !== "system" && h.toStatus !== "pending_payment" && <p className="text-xs text-muted">{h.reason}</p>}
            </li>
          ))}
        </ol>
        {view.refunds.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">환불</h3>
            <ul className="mt-1 text-sm">
              {view.refunds.map((r) => (
                <li key={r.id}>
                  {refundBasisLabels[r.basis]} · {formatWon(r.amount)} · {r.status === "succeeded" ? "환불 완료" : "처리 중"}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {canWithdraw && (
        <details className="mt-4 rounded-lg border border-line bg-white p-6">
          <summary className="cursor-pointer font-semibold text-navy">신청 철회</summary>
          <form action={withdrawAction.bind(null, a.applicationNo)} className="mt-3 flex flex-col gap-3">
            <p className="text-sm">
              {a.status === "pending_payment"
                ? "결제 전이므로 환불할 금액이 없습니다. 철회하면 잡아 둔 일정이 풀립니다."
                : `승인 전에 철회하면 결제 금액의 ${withdrawRate}%(${formatWon(Math.floor(((a.totalAmount ?? 0) * withdrawRate) / 100))})를 환불합니다.`}
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              철회 사유 (선택)
              <input name="reason" className="input" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" value="yes" /> 위 내용을 확인했으며 신청을 철회합니다.
            </label>
            <button type="submit" className="btn border border-danger text-danger hover:bg-danger hover:text-white self-start">
              신청 철회
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
