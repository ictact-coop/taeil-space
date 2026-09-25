/**
 * 결제 게이트웨이 어댑터 (계획서 2.1: PortOne V2).
 * - PortOne: PORTONE_API_SECRET이 있으면 실제 PortOne API를 쓴다(테스트/라이브는 PortOne 채널 설정에 따름).
 * - Fake: 키가 없는 개발·테스트 환경용. 운영(NODE_ENV=production)에서는 PAYMENT_FAKE=1일 때만 켜진다.
 * 결제완료 판정은 항상 서버가 게이트웨이에 조회해서 한다([요구] 17장: 브라우저 결과만으로 완료 처리하지 않음).
 */
export type GatewayPaymentStatus = "PAID" | "READY" | "PENDING" | "FAILED" | "CANCELLED" | "PARTIAL_CANCELLED" | "OTHER";

export interface GatewayPayment {
  status: GatewayPaymentStatus;
  amountTotal: number;
  transactionId: string | null;
  paidAt: Date | null;
  method: string | null;
  receiptUrl: string | null;
  failureReason: string | null;
  raw: unknown;
}

export interface GatewayCancelResult {
  status: "SUCCEEDED" | "REQUESTED" | "FAILED";
  failureReason: string | null;
  raw: unknown;
}

export interface WebhookEvent {
  type: string;
  paymentId: string | null;
}

export interface PaymentGateway {
  mode: "portone" | "fake";
  getPayment(paymentId: string): Promise<GatewayPayment | null>;
  cancel(paymentId: string, amount: number, reason: string): Promise<GatewayCancelResult>;
  verifyWebhook(body: string, headers: Record<string, string>): Promise<WebhookEvent>;
}

export class WebhookSignatureError extends Error {}

// ─── 가짜 게이트웨이 ────────────────────────────────────────────

interface FakeRecord {
  status: GatewayPaymentStatus;
  amount: number;
  cancelled: number;
  paidAt: Date | null;
}

export class FakeGateway implements PaymentGateway {
  mode = "fake" as const;
  readonly records = new Map<string, FakeRecord>();
  /** 테스트에서 취소 실패를 흉내 낼 때 */
  failNextCancel = false;

  markPaid(paymentId: string, amount: number, at: Date = new Date()): void {
    this.records.set(paymentId, { status: "PAID", amount, cancelled: 0, paidAt: at });
  }

  markFailed(paymentId: string, amount: number): void {
    this.records.set(paymentId, { status: "FAILED", amount, cancelled: 0, paidAt: null });
  }

  async getPayment(paymentId: string): Promise<GatewayPayment | null> {
    const r = this.records.get(paymentId);
    if (!r) return null;
    return {
      status: r.status,
      amountTotal: r.amount,
      transactionId: `fake-tx-${paymentId}`,
      paidAt: r.paidAt,
      method: "CARD(테스트)",
      receiptUrl: null,
      failureReason: r.status === "FAILED" ? "테스트 실패" : null,
      raw: { fake: true, ...r },
    };
  }

  async cancel(paymentId: string, amount: number, reason: string): Promise<GatewayCancelResult> {
    if (this.failNextCancel) {
      this.failNextCancel = false;
      return { status: "FAILED", failureReason: "테스트 취소 실패", raw: { fake: true } };
    }
    const r = this.records.get(paymentId);
    if (!r || (r.status !== "PAID" && r.status !== "PARTIAL_CANCELLED")) {
      return { status: "FAILED", failureReason: "취소할 수 있는 결제가 아닙니다.", raw: { fake: true } };
    }
    if (r.cancelled + amount > r.amount) return { status: "FAILED", failureReason: "취소 가능 금액을 넘었습니다.", raw: { fake: true } };
    r.cancelled += amount;
    r.status = r.cancelled === r.amount ? "CANCELLED" : "PARTIAL_CANCELLED";
    return { status: "SUCCEEDED", failureReason: null, raw: { fake: true, reason, amount } };
  }

  async verifyWebhook(body: string): Promise<WebhookEvent> {
    const parsed = JSON.parse(body) as { type?: string; data?: { paymentId?: string } };
    return { type: parsed.type ?? "", paymentId: parsed.data?.paymentId ?? null };
  }
}

// ─── PortOne ────────────────────────────────────────────────────

export class PortOneGateway implements PaymentGateway {
  mode = "portone" as const;
  constructor(
    private readonly secret: string,
    private readonly webhookSecret: string | undefined,
  ) {}

  private async client() {
    const { PortOneClient } = await import("@portone/server-sdk");
    return PortOneClient({ secret: this.secret });
  }

  async getPayment(paymentId: string): Promise<GatewayPayment | null> {
    try {
      const p = await (await this.client()).payment.getPayment({ paymentId });
      const status = (["PAID", "READY", "FAILED", "CANCELLED", "PARTIAL_CANCELLED"] as const).find((s) => s === p.status) ?? (p.status === "PAY_PENDING" ? "PENDING" : "OTHER");
      const any = p as Record<string, unknown>;
      const amount = any.amount as { total?: number } | undefined;
      const method = any.method as { type?: string } | undefined;
      return {
        status,
        amountTotal: amount?.total ?? 0,
        transactionId: typeof any.transactionId === "string" ? any.transactionId : null,
        paidAt: typeof any.paidAt === "string" ? new Date(any.paidAt) : null,
        method: method?.type ?? null,
        receiptUrl: typeof any.receiptUrl === "string" ? any.receiptUrl : null,
        failureReason: (any.failure as { reason?: string } | undefined)?.reason ?? null,
        raw: p,
      };
    } catch (e) {
      // SDK 오류는 data.type으로 종류를 알려 준다
      if ((e as { data?: { type?: string } }).data?.type === "PAYMENT_NOT_FOUND") return null;
      throw e;
    }
  }

  async cancel(paymentId: string, amount: number, reason: string): Promise<GatewayCancelResult> {
    try {
      const r = await (await this.client()).payment.cancelPayment({ paymentId, amount, reason });
      const c = r.cancellation as { status: string; reason?: string };
      if (c.status === "SUCCEEDED") return { status: "SUCCEEDED", failureReason: null, raw: r };
      if (c.status === "REQUESTED") return { status: "REQUESTED", failureReason: null, raw: r };
      return { status: "FAILED", failureReason: `PG 취소 실패(${c.status})`, raw: r };
    } catch (e) {
      return { status: "FAILED", failureReason: e instanceof Error ? e.message : String(e), raw: null };
    }
  }

  async verifyWebhook(body: string, headers: Record<string, string>): Promise<WebhookEvent> {
    if (!this.webhookSecret) throw new WebhookSignatureError("PORTONE_WEBHOOK_SECRET이 설정되지 않았습니다.");
    const { Webhook } = await import("@portone/server-sdk");
    try {
      const event = (await Webhook.verify(this.webhookSecret, body, headers)) as { type: string; data?: { paymentId?: string } };
      return { type: event.type, paymentId: event.data?.paymentId ?? null };
    } catch (e) {
      throw new WebhookSignatureError(e instanceof Error ? e.message : "웹훅 서명 검증 실패");
    }
  }
}

// ─── 선택 ───────────────────────────────────────────────────────

const g = globalThis as unknown as { taeilGateway?: PaymentGateway | null };

export function getGateway(): PaymentGateway | null {
  if (g.taeilGateway !== undefined) return g.taeilGateway;
  const secret = process.env.PORTONE_API_SECRET;
  if (secret) g.taeilGateway = new PortOneGateway(secret, process.env.PORTONE_WEBHOOK_SECRET);
  else if (process.env.NODE_ENV !== "production" || process.env.PAYMENT_FAKE === "1") g.taeilGateway = new FakeGateway();
  else g.taeilGateway = null;
  return g.taeilGateway;
}

export function setGatewayForTest(gateway: PaymentGateway | null | undefined): void {
  g.taeilGateway = gateway;
}

/** 브라우저 결제창에 넘기는 공개 설정 (비밀값 아님) */
export function publicPaymentConfig(): { mode: "portone" | "fake" | "none"; storeId: string | null; channelKey: string | null } {
  const gateway = getGateway();
  return {
    mode: gateway?.mode ?? "none",
    storeId: process.env.PORTONE_STORE_ID ?? null,
    channelKey: process.env.PORTONE_CHANNEL_KEY ?? null,
  };
}
