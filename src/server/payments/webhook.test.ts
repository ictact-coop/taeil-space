import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PortOneGateway, WebhookSignatureError } from "./gateway";

/** Standard Webhooks 서명 (PortOne V2 웹훅 방식) */
function sign(secretBytes: Buffer, id: string, ts: string, body: string): string {
  return `v1,${createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("PortOne 웹훅 서명 검증", () => {
  const secretBytes = randomBytes(32);
  const gateway = new PortOneGateway("api-secret", `whsec_${secretBytes.toString("base64")}`);
  const body = JSON.stringify({
    type: "Transaction.Paid",
    timestamp: new Date().toISOString(),
    data: { paymentId: "R202610-00001-abcd", storeId: "store-1", transactionId: "tx-1" },
  });
  const id = "msg_1";
  const ts = String(Math.floor(Date.now() / 1000));

  it("올바른 서명이면 사건 종류와 결제 ID를 돌려준다", async () => {
    const event = await gateway.verifyWebhook(body, { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sign(secretBytes, id, ts, body) });
    expect(event).toEqual({ type: "Transaction.Paid", paymentId: "R202610-00001-abcd" });
  });

  it("본문이 바뀌었거나 서명이 없으면 거부한다", async () => {
    const tampered = body.replace("abcd", "zzzz");
    await expect(
      gateway.verifyWebhook(tampered, { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sign(secretBytes, id, ts, body) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(gateway.verifyWebhook(body, {})).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("오래된 웹훅(재전송 공격)은 거부한다", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    await expect(
      gateway.verifyWebhook(body, { "webhook-id": id, "webhook-timestamp": old, "webhook-signature": sign(secretBytes, id, old, body) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
