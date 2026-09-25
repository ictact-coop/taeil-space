import { db } from "@/server/db/client";
import { getGateway, WebhookSignatureError } from "@/server/payments/gateway";
import { confirmPayment } from "@/server/payments/service";

/**
 * PortOne 웹훅 ([요구] 17장: 서명·위변조 검증 후 처리). 결제 관련 사건이면 결제를 다시 조회해 확정한다.
 * 같은 웹훅이 여러 번 와도 결과는 같다(멱등).
 */
export async function POST(req: Request) {
  const gateway = getGateway();
  if (!gateway) return new Response("payment gateway not configured", { status: 503 });
  const body = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  let event;
  try {
    event = await gateway.verifyWebhook(body, headers);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return new Response("invalid signature", { status: 401 });
    return new Response("bad request", { status: 400 });
  }
  if (event.paymentId && event.type.startsWith("Transaction.")) {
    await confirmPayment(db, gateway, event.paymentId);
  }
  return new Response("ok");
}
