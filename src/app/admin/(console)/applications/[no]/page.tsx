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
import { hasPermission } from "@/domain/auth/permissions";
import { db } from "@/server/db/client";
import { listNotifications } from "@/server/notifications/queue";
import { refundBasisLabels } from "@/server/payments/refunds";
import {
  addNoteAction,
  approveAction,
  cancelConfirmedAction,
  applicantPasswordAction,
  changeDiscountAction,
  confirmDepositAction,
  deleteApplicationAction,
  manualRefundAction,
  rejectAction,
  requestRevisionAction,
  retryRefundAction,
  setCompletedAction,
  startReviewAction,
} from "./actions";
import { DISCOUNT_EDITABLE_STATUSES } from "@/server/applications/discount-adjust";
import { describeReceipt } from "@/domain/booking/receipt";
import { listDiscountRules } from "@/server/pricing/discount-service";
import { TemplateTextarea } from "./template-textarea";
import { getSettings } from "@/server/settings/service";
import { parseMessageTemplates } from "@/domain/messages/template";
import { templateVars } from "@/server/notifications/queue";

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
  const admin = await requireAdmin("applications.view");
  const data = await getApplicationForAdmin(db, no);
  if (!data) notFound();
  const { app, space, org } = data;
  // 개인정보 조회 이력 ([요구] 24장)
  await writeAudit(db, { actorType: "admin", actorId: admin.id, action: "pii.view", targetType: "application", targetId: app.id, ip: admin.ip });
  const [checks, orgHistory, notes, notifications] = await Promise.all([reviewChecks(db, app), organizationHistory(db, app), listNotes(db, app.id), listNotifications(db, app.id)]);
  const canReview = hasPermission(admin, "applications.review");
  const canRefund = hasPermission(admin, "refunds.manage");
  const price = app.priceSnapshot as { items?: { label: string; amount: number }[] } | null;
  const policy = app.policySnapshot as { discount?: { name: string } | null; discountChangedBy?: string } | null;
  const reviewable = ["submitted", "reviewing", "revision_requested"].includes(app.status);
  const pendingBank = app.status === "pending_payment" && data.payments.some((p) => p.method === "bank_transfer" && p.status === "ready");
  const messageTemplates = canReview ? parseMessageTemplates((await getSettings(db))["content.reviewMessageTemplates"]) : [];
  const vars = templateVars(app, space.name);
  const discountEditable = (DISCOUNT_EDITABLE_STATUSES as readonly string[]).includes(app.status) && Boolean(price?.items?.length);
  const discountOptions = discountEditable && canReview ? (await listDiscountRules(db)).filter((d) => d.isActive || d.id === app.discountRuleId) : [];
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
              {app.importRef && (
                <span className="badge bg-cream-dark text-muted" title="자동 취소·입금 기한 알림을 하지 않습니다. 입금을 확인하거나 반려로 처리하세요.">
                  노션에서 가져옴
                </span>
              )}
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
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${app.consents.smsReceive ? "bg-status-green/10 text-status-green" : "bg-cream text-muted"}`}>
                  문자 수신 {app.consents.smsReceive ? "동의" : "미동의"}
                </span>
                {canReview && (
                  <details className="mt-2 rounded border border-line p-2 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-navy">나의 대관 비밀번호 다시 정하기</summary>
                    <form action={b(applicantPasswordAction, app.applicationNo, app.id)} className="mt-2 flex flex-col gap-2">
                      <p className="text-xs text-muted">
                        신청자가 비밀번호를 잊었고 이메일로 확인 코드를 받을 수 없을 때, 전화 등으로 본인을 확인한 뒤 새 비밀번호를 정해 알려 줍니다. 이 신청에만 적용됩니다.
                      </p>
                      <input name="password" required minLength={4} maxLength={50} autoComplete="off" placeholder="새 비밀번호(4자 이상)" className="input" aria-label="새 비밀번호" />
                      <input name="reason" required minLength={2} placeholder="사유 (예: 전화로 본인 확인 후 요청)" className="input" aria-label="사유" />
                      <button type="submit" className="btn-secondary self-start">
                        비밀번호 정하기
                      </button>
                    </form>
                  </details>
                )}
              </Row>
              <Row label="행사">
                {app.eventTitle}
              </Row>
              <Row label="목적·내용">
                <p className="whitespace-pre-line">{app.eventPurpose}</p>
              </Row>
              <Row label="예상 인원">
                {app.expectedHeadcount}명 (정원 {space.capacity}명{space.minHeadcount ? `, 최소 ${space.minHeadcount}명` : ""})
                {app.expectedHeadcount > space.capacity && <span className="badge ml-2 bg-warning/10 text-warning">정원 초과 — 운영 가능 여부 확인</span>}
              </Row>
              {app.nightManagerName && (
                <Row label="야간 출입문">
                  {app.nightManagerName} · {app.nightManagerPhone}
                </Row>
              )}
              {app.receiptRequest && (
                <Row label="증빙 발행">
                  <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">발행 희망</span> {describeReceipt(app.receiptRequest)}
                </Row>
              )}
              {policy?.discount &&
                (policy.discountChangedBy ? (
                  <Row label="감면">{policy.discount.name} — 담당자가 적용(처리 이력 참고)</Row>
                ) : (
                  <Row label="감면 신청">{policy.discount.name} — 증빙을 확인하고 인정되지 않으면 반려하세요(P-16).</Row>
                ))}
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
              <p className="text-sm text-status-green">✓ 일정 중복·휴관일·최소 인원·단체 제한 등 자동검증을 통과했습니다.</p>
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
            {canReview && discountEditable && (
              <details className="mt-3 rounded border border-line p-3 text-sm" open={false}>
                <summary className="cursor-pointer font-medium text-navy">감면 적용·변경</summary>
                <form action={b(changeDiscountAction, app.applicationNo, app.id)} className="mt-3 flex flex-col gap-2">
                  <p className="text-xs text-muted">
                    기본·추가·옵션 금액은 신청 당시 그대로 두고 감면만 다시 계산합니다.
                    {app.status === "pending_payment" ? " 입금 전이라 받을 금액이 바로 바뀝니다." : " 이미 받은 금액에서 줄어든 만큼 환불 요청을 만듭니다(계좌이체는 환불 처리에서 이체 후 완료)."}
                  </p>
                  <select name="discountRuleId" defaultValue={app.discountRuleId ?? ""} className="input" aria-label="감면 항목">
                    <option value="">감면 없음</option>
                    {discountOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.kind === "percent" ? `${d.value}%` : formatWon(d.value)}){d.isActive ? "" : " - 사용 중지"}
                      </option>
                    ))}
                  </select>
                  <input name="reason" required minLength={2} placeholder="변경 사유 (예: 고유번호증 확인)" className="input" aria-label="변경 사유" />
                  <button type="submit" className="btn-secondary">
                    감면 바꾸기
                  </button>
                </form>
              </details>
            )}
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
                        {refundBasisLabels[r.basis]}{r.basis === "discount" ? "" : ` · ${r.ratePercent}%`} · {formatWon(r.amount)} · <strong>{refundStatusLabels[r.status]}</strong>
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
                    <p className="text-sm font-medium">입금 확인 (계좌이체)</p>
                    <p className="text-xs text-muted">
                      통장에서 {formatWon(app.totalAmount ?? 0)} 입금(입금자명은 보통 신청자 {app.contactName})을 확인한 뒤 누르세요.
                      {data.holdExpiresAt && ` 입금 기한: ${formatKst(data.holdExpiresAt)}`}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        입금자명 (선택)
                        <input name="depositorName" maxLength={50} placeholder="예: 홍길동" className="input text-sm" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        입금일시 (선택)
                        <input name="depositedAt" type="datetime-local" className="input text-sm" />
                      </label>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="approve" value="yes" defaultChecked className="mt-1" />
                      <span>
                        입금 확인과 함께 승인(예약확정)
                        <span className="block text-xs text-muted">기본으로 체크되어 있습니다. 신청 내용을 따로 검토하려면 체크를 풀고 누르세요(신청접수 상태가 되고, 검토 후 승인합니다).</span>
                      </span>
                    </label>
                    <button type="submit" className="btn-primary">
                      입금 확인
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
                    <TemplateTextarea name="message" label="보완 요청 내용" templates={messageTemplates} vars={vars} rows={3} />
                    <button type="submit" className="btn-secondary">
                      보완 요청
                    </button>
                  </form>
                )}
                {reviewable && (
                  <form action={b(rejectAction, app.applicationNo, app.id)} className="flex flex-col gap-2 border-t border-line pt-3">
                    <TemplateTextarea name="reason" label="반려 사유" templates={messageTemplates} vars={vars} rows={4} />
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
          {canReview && ["confirmed", "cancel_requested", "completed"].includes(app.status) && (
            <Card>
              <h2 className="mb-3 font-semibold text-navy">예약 관리</h2>
              <div className="flex flex-col gap-4">
                {app.status !== "completed" && (
                  <form action={b(cancelConfirmedAction, app.applicationNo, app.id)} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">예약 취소</p>
                    <p className="text-xs text-muted">확정된 예약을 취소하고 일정을 다시 엽니다. 환불할 금액이 있으면 환불 처리 목록에 올라갑니다(계좌이체는 이체 후 완료 처리).</p>
                    <label className="text-sm">
                      <span className="sr-only">취소 사유</span>
                      <textarea name="reason" rows={2} required placeholder="취소 사유 (처리 이력에 남습니다)" className="input" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        구분
                        <select name="basis" defaultValue="cancelled" className="input text-sm">
                          <option value="cancelled">신청자 요청</option>
                          <option value="venue_fault">기념관 사정</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        환불 비율(%)
                        <input name="refundPercent" type="number" min={0} max={100} step={1} defaultValue={100} className="input text-sm" />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="notify" value="yes" defaultChecked />
                      신청자에게 취소 메일 보내기
                    </label>
                    <button type="submit" className="btn-secondary border-danger text-danger">
                      예약 취소
                    </button>
                  </form>
                )}
                <form action={setCompletedAction.bind(null, app.applicationNo, app.id, app.status !== "completed")} className="border-t border-line pt-3">
                  <button type="submit" className="btn-ghost w-full">
                    {app.status === "completed" ? "예약확정으로 되돌리기" : "이용완료로 표시"}
                  </button>
                </form>
              </div>
            </Card>
          )}
          {admin.isSuper && (
            <Card>
              <h2 className="mb-1 font-semibold text-danger">영구 삭제</h2>
              <p className="mb-3 text-xs text-muted">
                테스트 데이터나 잘못 만든 신청을 지웁니다. 결제·환불·첨부·알림 기록까지 모두 지워지고 되돌릴 수 없습니다(감사 로그에는 요약이 남습니다). 실제 신청은 반려·취소로 처리하세요.
              </p>
              <form action={b(deleteApplicationAction, app.applicationNo, app.id)} className="flex flex-col gap-2">
                <label className="text-sm">
                  <span className="sr-only">삭제 사유</span>
                  <input name="reason" required placeholder="삭제 사유 (예: 테스트 데이터)" className="input" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  확인: 신청번호 {app.applicationNo}를 입력하세요
                  <input name="confirmNo" required autoComplete="off" className="input text-sm" />
                </label>
                <button type="submit" className="btn-secondary border-danger text-danger">
                  영구 삭제
                </button>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
