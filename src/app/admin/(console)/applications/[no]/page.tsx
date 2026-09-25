import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, ResultNotice } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatRegNo, regTypeLabels } from "@/domain/organization/reg-no";
import { formatWon } from "@/domain/pricing/fee-schedule";
import { formatKst } from "@/lib/time";
import { getApplicationForAdmin } from "@/server/applications/admin-queries";
import { listNotes, organizationHistory, reviewChecks } from "@/server/applications/review";
import { statusLabels } from "@/server/applications/transition";
import { writeAudit } from "@/server/audit/log";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { listNotifications } from "@/server/notifications/queue";
import { refundBasisLabels } from "@/server/payments/refunds";
import {
  addNoteAction,
  approveAction,
  confirmDepositAction,
  manualRefundAction,
  rejectAction,
  requestRevisionAction,
  retryRefundAction,
  startReviewAction,
} from "./actions";

export const metadata: Metadata = { title: "신청 상세" };

const scanLabels = { clean: "검사 완료", infected: "악성코드", unscanned: "검사 안 됨", error: "검사 오류" } as const;
const paymentStatusLabels = { ready: "결제 전", paid: "결제 완료", failed: "실패", cancelled: "취소·환불" } as const;
const paymentMethodLabels = { pg: "카드(PG)", bank_transfer: "계좌이체", free: "0원(전액 감면)" } as const;
const refundStatusLabels = { requested: "처리 중", succeeded: "환불 완료", failed: "실패(재처리 필요)" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default async function ApplicationDetailPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const { no } = await params;
  const { done, error } = await searchParams;
  const admin = await requireAdmin();
  const data = await getApplicationForAdmin(db, no);
  if (!data) notFound();
  const { app, space, org } = data;
  // 개인정보 조회 이력 ([요구] 24장)
  await writeAudit(db, { actorType: "admin", actorId: admin.id, action: "pii.view", targetType: "application", targetId: app.id, ip: admin.ip });
  const [checks, orgHistory, notes, notifications] = await Promise.all([reviewChecks(db, app), organizationHistory(db, app), listNotes(db, app.id), listNotifications(db, app.id)]);
  const canReview = canManage(admin.role, "review");
  const canRefund = canManage(admin.role, "refunds");
  const price = app.priceSnapshot as { items?: { label: string; amount: number }[] } | null;
  const policy = app.policySnapshot as { discount?: { name: string } | null } | null;
  const reviewable = ["submitted", "reviewing", "revision_requested"].includes(app.status);
  const pendingBank = app.status === "pending_payment" && data.payments.some((p) => p.method === "bank_transfer" && p.status === "ready");
  const b = (fn: (...a: never[]) => unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown).bind(null, ...args) as (f: FormData) => Promise<void>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`${app.applicationNo} ${app.orgName}`} crumbs={[{ href: "/admin/applications", label: "신청 관리" }]} />
      <ResultNotice done={done} error={error} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={app.status} />
              <span className="text-sm text-muted">
                {space.name} · {formatKst(app.startsAt)}–{formatKst(app.endsAt).slice(-5)}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <Row label="단체">
                {app.orgName}
                {org && (
                  <span className="ml-2 text-xs text-muted">
                    {regTypeLabels[org.regType]} {formatRegNo(org.regNo)}
                  </span>
                )}
                {!org && <span className="ml-2 badge bg-warning/10 text-warning">단체번호 없음 — 중복 여부 수동 확인</span>}
              </Row>
              <Row label="담당자">
                {app.contactName} · {app.contactPhone} · {app.contactEmail}
              </Row>
              <Row label="행사">
                {app.eventTitle} <span className="text-xs text-muted">({app.eventPublic ? "공개" : "비공개"} 행사)</span>
              </Row>
              <Row label="목적·내용">
                <p className="whitespace-pre-line">{app.eventPurpose}</p>
              </Row>
              <Row label="예상 인원">
                {app.expectedHeadcount}명 (정원 {space.capacity}명{space.minHeadcount ? `, 최소 ${space.minHeadcount}명` : ""})
              </Row>
              {app.nightManagerName && (
                <Row label="야간 출입문">
                  {app.nightManagerName} · {app.nightManagerPhone}
                </Row>
              )}
              {policy?.discount && <Row label="감면 신청">{policy.discount.name} — 증빙을 확인하고 인정되지 않으면 반려하세요(P-16).</Row>}
              {app.revisionMessage && (
                <Row label="보완 요청">
                  {app.revisionMessage}
                  {app.revisionDeadline && <span className="text-xs text-muted"> (기한 {formatKst(app.revisionDeadline)})</span>}
                </Row>
              )}
              {app.decisionReason && <Row label="처리 사유">{app.decisionReason}</Row>}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold text-navy">자동검증</h2>
            {checks.length === 0 ? (
              <p className="text-sm text-status-green">✓ 정원·일정 중복·휴관일·단체 제한 등 자동검증을 통과했습니다.</p>
            ) : (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-danger">
                {checks.map((c) => (
                  <li key={c.code}>
                    [{c.code}] {c.message}
                  </li>
                ))}
              </ul>
            )}
            {orgHistory.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium">같은 단체번호의 다른 신청</h3>
                <ul className="mt-1 text-xs">
                  {orgHistory.map((h) => (
                    <li key={h.applicationNo}>
                      <Link href={`/admin/applications/${h.applicationNo}`} className="text-navy underline">
                        {h.applicationNo}
                      </Link>{" "}
                      {formatKst(h.startsAt)} · {statusLabels[h.status]} · {h.orgName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold text-navy">금액·결제·환불</h2>
            <ul className="text-sm">
              {(price?.items ?? []).map((i) => (
                <li key={i.label} className="flex justify-between border-b border-line/60 py-1">
                  <span>{i.label}</span>
                  <span>{formatWon(i.amount)}</span>
                </li>
              ))}
              <li className="flex justify-between py-1 font-semibold">
                <span>결제 금액</span>
                <span>{formatWon(app.totalAmount ?? 0)}</span>
              </li>
            </ul>
            <h3 className="mt-4 text-sm font-medium">결제 시도</h3>
            <ul className="mt-1 text-xs">
              {data.payments.map((p) => (
                <li key={p.id} className="py-0.5">
                  {p.orderId} · {paymentMethodLabels[p.method]} · {formatWon(p.amount)} · {paymentStatusLabels[p.status]}
                  {p.paidAt && ` · ${formatKst(p.paidAt)}`}
                  {p.failureReason && <span className="text-muted"> ({p.failureReason})</span>}
                </li>
              ))}
            </ul>
            {data.refunds.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-medium">환불</h3>
                <ul className="mt-1 flex flex-col gap-2 text-xs">
                  {data.refunds.map((r) => {
                    const pay = data.payments.find((p) => p.id === r.paymentId);
                    return (
                      <li key={r.id} className="rounded border border-line p-2">
                        {refundBasisLabels[r.basis]} · {r.ratePercent}% · {formatWon(r.amount)} · <strong>{refundStatusLabels[r.status]}</strong>
                        {r.failureReason && r.status !== "succeeded" && <span className="text-danger"> — {r.failureReason}</span>}
                        {r.manualNote && <span className="text-muted"> — {r.manualNote}</span>}
                        {canRefund && r.status !== "succeeded" && pay?.method === "bank_transfer" && (
                          <form action={b(manualRefundAction, app.applicationNo, r.id)} className="mt-2 flex gap-2">
                            <input name="note" required placeholder="환불 계좌·이체일 등" aria-label="환불 처리 내용" className="input py-1" />
                            <button type="submit" className="btn-secondary px-2 py-1 text-xs">
                              계좌 환불 완료
                            </button>
                          </form>
                        )}
                        {canRefund && r.status === "failed" && pay?.method === "pg" && (
                          <form action={b(retryRefundAction, app.applicationNo, r.id)} className="mt-2">
                            <button type="submit" className="btn-secondary px-2 py-1 text-xs">
                              PG 환불 다시 시도
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold text-navy">첨부파일</h2>
            {data.files.length === 0 ? (
              <p className="text-sm text-muted">첨부파일이 없습니다.</p>
            ) : (
              <ul className="text-sm">
                {data.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 py-1">
                    <span className="text-xs text-muted">{f.kind === "discount_proof" ? "감면 증빙" : f.kind === "event_plan" ? "행사계획서" : "기타"}</span>
                    <a href={`/admin/api/attachments/${f.id}`} className="text-navy underline">
                      {f.originalName}
                    </a>
                    <span className="text-xs text-muted">({Math.ceil(f.size / 1024)}KB)</span>
                    <span className={`badge ${f.scanStatus === "clean" ? "bg-status-green/10 text-status-green" : "bg-warning/10 text-warning"}`}>{scanLabels[f.scanStatus]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold text-navy">처리 이력</h2>
            <ol className="flex flex-col gap-1 text-xs">
              {data.history.map(({ h, actorName }) => (
                <li key={h.id}>
                  {formatKst(h.createdAt)} · {h.fromStatus ? `${statusLabels[h.fromStatus]} → ` : ""}
                  <strong>{statusLabels[h.toStatus]}</strong> · {actorName ?? (h.actorType === "applicant" ? "신청자" : "시스템")}
                  {h.reason && <span className="text-muted"> — {h.reason}</span>}
                </li>
              ))}
            </ol>
            {notifications.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-medium">알림</h3>
                <ul className="text-xs">
                  {notifications.map((n) => (
                    <li key={n.id}>
                      {formatKst(n.createdAt)} · {n.channel === "email" ? "이메일" : "문자"} · {n.recipient} · {n.subject} ·{" "}
                      {{ pending: "대기", sent: "발송", failed: "실패", skipped: "건너뜀" }[n.status]}
                      {n.error && <span className="text-muted"> ({n.error})</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          {canReview && (reviewable || pendingBank) && (
            <Card>
              <h2 className="mb-3 font-semibold text-navy">심사</h2>
              <div className="flex flex-col gap-4">
                {pendingBank && (
                  <form action={b(confirmDepositAction, app.applicationNo, app.id)} className="flex flex-col gap-2">
                    <label className="text-sm font-medium">
                      입금 확인 (계좌이체)
                      <input name="note" required placeholder="입금자명·입금일시" className="input mt-1" />
                    </label>
                    <button type="submit" className="btn-primary">
                      입금 확인 → 신청접수
                    </button>
                  </form>
                )}
                {app.status === "submitted" && (
                  <form action={startReviewAction.bind(null, app.applicationNo, app.id)}>
                    <button type="submit" className="btn-secondary w-full">
                      검토 시작
                    </button>
                  </form>
                )}
                {(app.status === "submitted" || app.status === "reviewing") && (
                  <form action={b(approveAction, app.applicationNo, app.id)} className="flex flex-col gap-2 border-t border-line pt-3">
                    <label className="text-sm font-medium">
                      승인 메모 (선택)
                      <input name="note" className="input mt-1" />
                    </label>
                    <button type="submit" className="btn-primary" disabled={checks.some((c) => c.code === "BR-06" || c.code === "BR-02")}>
                      승인 → 예약확정
                    </button>
                  </form>
                )}
                {(app.status === "submitted" || app.status === "reviewing") && (
                  <form action={b(requestRevisionAction, app.applicationNo, app.id)} className="flex flex-col gap-2 border-t border-line pt-3">
                    <label className="text-sm font-medium">
                      보완 요청 내용
                      <textarea name="message" required rows={3} className="input mt-1" placeholder="신청자에게 전달됩니다." />
                    </label>
                    <button type="submit" className="btn-secondary">
                      보완 요청
                    </button>
                  </form>
                )}
                {reviewable && (
                  <form action={b(rejectAction, app.applicationNo, app.id)} className="flex flex-col gap-2 border-t border-line pt-3">
                    <label className="text-sm font-medium">
                      반려 사유
                      <textarea name="reason" required rows={2} className="input mt-1" placeholder="신청자에게 전달됩니다." />
                    </label>
                    <button type="submit" className="btn border border-danger text-danger hover:bg-danger hover:text-white">
                      반려 (전액 환불)
                    </button>
                  </form>
                )}
              </div>
            </Card>
          )}
          <Card>
            <h2 className="mb-2 font-semibold text-navy">내부 메모</h2>
            <p className="mb-2 text-xs text-muted">담당자만 볼 수 있습니다.</p>
            <ul className="mb-3 flex flex-col gap-2 text-sm">
              {notes.map(({ note, authorName }) => (
                <li key={note.id} className="rounded bg-cream p-2">
                  <p className="whitespace-pre-line">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {authorName} · {formatKst(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
            {canReview && (
              <form action={b(addNoteAction, app.applicationNo, app.id)} className="flex flex-col gap-2">
                <textarea name="body" rows={2} required className="input" aria-label="메모" />
                <button type="submit" className="btn-ghost self-end">
                  메모 남기기
                </button>
              </form>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
