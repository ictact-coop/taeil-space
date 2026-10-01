import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getApplicantView } from "@/server/applicant/current";
import { db } from "@/server/db/client";
import { getGateway } from "@/server/payments/gateway";
import { confirmPayment } from "@/server/payments/service";

export const metadata: Metadata = { title: "결제 확인" };
export const dynamic = "force-dynamic";

/** 모바일 결제 뒤 돌아오는 화면 (PortOne redirectUrl) */
export default async function PaymentCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ paymentId?: string; code?: string; message?: string }>;
}) {
  const { no } = await params;
  const q = await searchParams;
  const view = await getApplicantView(no);
  const gateway = getGateway();
  let error: string | null = null;
  if (!view || !gateway) error = "신청 내역을 확인할 수 없습니다.";
  else if (q.code) error = q.message ?? "결제가 취소되었거나 실패했습니다.";
  else if (!q.paymentId || !q.paymentId.startsWith(`${no}-`)) error = "결제 정보가 올바르지 않습니다.";
  else {
    const out = await confirmPayment(db, gateway, q.paymentId);
    if (out.outcome === "paid" || out.outcome === "already" || out.outcome === "late_refunded" || out.outcome === "amount_mismatch") {
      redirect(`/my/${no}?paid=${out.outcome}`);
    }
    error = "결제가 완료되지 않았습니다. 다시 시도해 주세요.";
  }
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-lg font-semibold text-navy">결제를 확인하지 못했습니다</p>
      <p className="mt-3 text-sm text-danger">{error}</p>
      <Link href={`/apply/pay/${no}`} className="btn-primary mt-6">
        결제 화면으로
      </Link>
    </div>
  );
}
