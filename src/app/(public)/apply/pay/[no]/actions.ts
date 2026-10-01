"use server";

import { getApplicantView } from "@/server/applicant/current";
import { db } from "@/server/db/client";
import { FakeGateway, getGateway, publicPaymentConfig } from "@/server/payments/gateway";
import { confirmPayment, prepareCheckout, type CheckoutInfo } from "@/server/payments/service";

export type CheckoutResult =
  | { ok: true; checkout: Omit<CheckoutInfo, "expiresAt"> & { expiresAt: string }; config: ReturnType<typeof publicPaymentConfig> }
  | { ok: false; error: string };

export async function startCheckoutAction(applicationNo: string): Promise<CheckoutResult> {
  const view = await getApplicantView(applicationNo);
  if (!view) return { ok: false, error: "신청 내역을 확인할 수 없습니다." };
  const config = publicPaymentConfig();
  if (config.mode === "none") return { ok: false, error: "온라인 결제가 아직 설정되지 않았습니다. 기념관에 문의해 주세요." };
  const r = await prepareCheckout(db, view.application.id);
  if (!r.ok) return r;
  return { ok: true, checkout: { ...r.checkout, expiresAt: r.checkout.expiresAt.toISOString() }, config };
}

export type CompleteResult = { ok: true; outcome: string; message: string } | { ok: false; error: string };

const messages: Record<string, string> = {
  paid: "결제가 완료되어 신청이 접수되었습니다.",
  already: "이미 결제가 완료된 신청입니다.",
  late_refunded: "결제 기한이 지나 신청이 취소된 뒤 결제되어, 결제 금액을 전액 환불합니다.",
  amount_mismatch: "결제 금액이 신청 금액과 달라 결제를 취소하고 환불합니다. 기념관에 문의해 주세요.",
};

/** 결제창이 닫힌 뒤 호출. 브라우저가 알려 준 결과는 믿지 않고 서버가 PortOne에 조회해 확정한다. */
export async function completePaymentAction(applicationNo: string, paymentId: string): Promise<CompleteResult> {
  const view = await getApplicantView(applicationNo);
  const gateway = getGateway();
  if (!view || !gateway) return { ok: false, error: "신청 내역을 확인할 수 없습니다." };
  if (!paymentId.startsWith(`${applicationNo}-`)) return { ok: false, error: "결제 정보가 올바르지 않습니다." };
  const out = await confirmPayment(db, gateway, paymentId);
  if (out.outcome === "not_paid") return { ok: false, error: out.reason ? `결제가 완료되지 않았습니다: ${out.reason}` : "결제가 완료되지 않았습니다. 다시 시도해 주세요." };
  if (out.outcome === "unknown") return { ok: false, error: "결제 정보를 찾을 수 없습니다." };
  return { ok: true, outcome: out.outcome, message: messages[out.outcome] ?? "처리되었습니다." };
}

/** 개발·시연 환경의 가짜 결제 (PortOne 키가 없을 때만) */
export async function fakePayAction(applicationNo: string, paymentId: string, amount: number): Promise<CompleteResult> {
  const gateway = getGateway();
  if (!(gateway instanceof FakeGateway)) return { ok: false, error: "테스트 결제를 쓸 수 없는 환경입니다." };
  const view = await getApplicantView(applicationNo);
  if (!view) return { ok: false, error: "신청 내역을 확인할 수 없습니다." };
  gateway.markPaid(paymentId, amount);
  return completePaymentAction(applicationNo, paymentId);
}
