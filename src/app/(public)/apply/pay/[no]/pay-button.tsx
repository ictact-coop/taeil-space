"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { completePaymentAction, fakePayAction, startCheckoutAction } from "./actions";

export function PayButton({ applicationNo, mode }: { applicationNo: string; mode: "portone" | "fake" | "none" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const start = await startCheckoutAction(applicationNo);
      if (!start.ok) return setError(start.error);
      const { checkout, config } = start;
      let result;
      if (config.mode === "fake") {
        result = await fakePayAction(applicationNo, checkout.paymentId, checkout.amount);
      } else {
        if (!config.storeId || !config.channelKey) return setError("결제 설정(상점 ID·채널 키)이 없습니다. 기념관에 문의해 주세요.");
        const PortOne = await import("@portone/browser-sdk/v2");
        const response = await PortOne.requestPayment({
          storeId: config.storeId,
          channelKey: config.channelKey,
          paymentId: checkout.paymentId,
          orderName: checkout.orderName,
          totalAmount: checkout.amount,
          currency: "KRW",
          payMethod: "CARD",
          customer: { fullName: checkout.customer.fullName, phoneNumber: checkout.customer.phoneNumber, email: checkout.customer.email },
          // 모바일은 결제 뒤 이 주소로 돌아온다
          redirectUrl: `${window.location.origin}/apply/pay/${applicationNo}/complete`,
        });
        if (!response) return setError("결제창을 열지 못했습니다.");
        if (response.code) return setError(response.message ?? "결제가 취소되었거나 실패했습니다.");
        result = await completePaymentAction(applicationNo, response.paymentId);
      }
      if (!result.ok) return setError(result.error);
      router.push(`/my/${applicationNo}?paid=${result.outcome}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={pay} disabled={busy || mode === "none"} className="btn-primary px-6 py-3">
        {busy ? "결제 진행 중…" : mode === "fake" ? "테스트 결제하기(개발용)" : "카드로 결제하기"}
      </button>
      {mode === "fake" && <p className="mt-2 text-xs text-muted">PortOne 키가 설정되지 않은 개발 환경입니다. 실제 결제 없이 결제 완료를 흉내 냅니다.</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
