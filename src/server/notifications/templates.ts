import { formatWon } from "@/domain/pricing/fee-schedule";

/** 알림 사건 ([요구] 21장, v0.2 흐름) */
export type NotificationEvent =
  | "submitted"
  | "revision_requested"
  | "revision_submitted"
  | "rejected"
  | "approved"
  | "withdrawn"
  | "refunded"
  | "payment_expired";

export interface MessageContext {
  applicationNo: string;
  orgName: string;
  contactName: string;
  spaceName: string;
  when: string;
  total: number;
  myUrl: string;
  reviewPeriod: string;
  reason?: string | null;
  revisionMessage?: string | null;
  revisionDeadline?: string | null;
  refundAmount?: number | null;
}

const footer = "\n\n전태일기념관 대관 담당 · 02-318-0903~4\n이 메일은 발신 전용입니다.";

export function applicantMessage(event: NotificationEvent, c: MessageContext): { subject: string; body: string } {
  const head = `${c.contactName}님, 안녕하세요.\n\n신청번호: ${c.applicationNo}\n공간: ${c.spaceName}\n일시: ${c.when}`;
  switch (event) {
    case "submitted":
      return {
        subject: `[전태일기념관] 대관 신청이 접수되었습니다 (${c.applicationNo})`,
        body: `${head}\n결제 금액: ${formatWon(c.total)}\n\n결제가 확인되어 신청이 접수되었습니다. 담당자 심사에 ${c.reviewPeriod}이 걸리며, 결과를 다시 알려 드립니다.\n심사에서 반려되면 결제 금액 전액을 환불합니다.\n\n신청 내역 보기: ${c.myUrl}${footer}`,
      };
    case "revision_requested":
      return {
        subject: `[전태일기념관] 신청 내용 보완을 요청드립니다 (${c.applicationNo})`,
        body: `${head}\n\n담당자가 아래 내용의 보완을 요청했습니다.\n\n${c.revisionMessage ?? ""}\n\n제출 기한: ${c.revisionDeadline}\n기한까지 보완하지 않으면 신청이 종료되고 결제 금액은 전액 환불됩니다.\n\n보완하기: ${c.myUrl}${footer}`,
      };
    case "rejected":
      return {
        subject: `[전태일기념관] 대관 신청 심사 결과 안내 (${c.applicationNo})`,
        body: `${head}\n\n아쉽게도 이번 신청은 승인되지 않았습니다.\n사유: ${c.reason ?? ""}\n\n결제 금액 ${formatWon(c.total)}은 전액 환불 처리됩니다. 카드 결제는 카드사 사정에 따라 환불 확인까지 며칠이 걸릴 수 있습니다.\n\n신청 내역 보기: ${c.myUrl}${footer}`,
      };
    case "approved":
      return {
        subject: `[전태일기념관] 대관 예약이 확정되었습니다 (${c.applicationNo})`,
        body: `${head}\n\n신청이 승인되어 예약이 확정되었습니다.\n이용 당일에는 대관 운영규정을 지켜 주시고, 18:00 이전에 사용·철수 방법을 담당자에게 인계받아 주세요.\n\n예약 내역 보기: ${c.myUrl}${footer}`,
      };
    case "withdrawn":
      return {
        subject: `[전태일기념관] 대관 신청이 철회되었습니다 (${c.applicationNo})`,
        body: `${head}\n\n요청하신 대로 신청을 철회했습니다.${c.refundAmount ? `\n환불 예정 금액: ${formatWon(c.refundAmount)}` : ""}\n\n신청 내역 보기: ${c.myUrl}${footer}`,
      };
    case "refunded":
      return {
        subject: `[전태일기념관] 환불이 완료되었습니다 (${c.applicationNo})`,
        body: `${head}\n\n환불 금액 ${formatWon(c.refundAmount ?? 0)}의 환불 처리가 완료되었습니다.\n\n신청 내역 보기: ${c.myUrl}${footer}`,
      };
    case "payment_expired":
      return {
        subject: `[전태일기념관] 결제 기한이 지나 신청이 취소되었습니다 (${c.applicationNo})`,
        body: `${head}\n\n결제 기한 안에 결제가 확인되지 않아 신청이 자동 취소되었습니다. 필요하면 다시 신청해 주세요.${footer}`,
      };
    case "revision_submitted":
      return { subject: `[전태일기념관] 보완 내용이 제출되었습니다 (${c.applicationNo})`, body: `${head}\n\n보완 내용이 제출되어 다시 심사합니다.${footer}` };
  }
}

export function staffMessage(event: NotificationEvent, c: MessageContext): { subject: string; body: string } | null {
  const label = { submitted: "새 대관 신청 접수", withdrawn: "신청 철회", revision_submitted: "보완 제출" } as Partial<Record<NotificationEvent, string>>;
  const title = label[event];
  if (!title) return null;
  return {
    subject: `[대관관리] ${title}: ${c.applicationNo} ${c.orgName}`,
    body: `${title}\n\n신청번호: ${c.applicationNo}\n단체: ${c.orgName}\n공간: ${c.spaceName}\n일시: ${c.when}\n금액: ${formatWon(c.total)}\n\n관리자 화면에서 확인하세요.`,
  };
}
