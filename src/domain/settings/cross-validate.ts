import type { SettingKey, SettingValues } from "./definitions";

/**
 * 여러 설정을 함께 봐야 하는 검증 (계획서 2.7 "저장할 때 검증한다").
 * 변경이 적용될 시점의 전체 설정값을 받아, 문제가 있으면 관련 설정 키와 메시지를 돌려준다.
 */
export interface CrossValidationIssue {
  keys: SettingKey[];
  message: string;
}

type Rule = (v: SettingValues) => CrossValidationIssue | null;

const rules: Rule[] = [
  (v) =>
    v["operation.dayStart"] < v["operation.dayEnd"]
      ? null
      : {
          keys: ["operation.dayStart", "operation.dayEnd"],
          message: "대관 시작 시각은 주간 대관 종료 시각보다 빨라야 합니다.",
        },
  (v) =>
    !v["operation.nightEnabled"] || v["operation.dayEnd"] < v["operation.nightEnd"]
      ? null
      : {
          keys: ["operation.dayEnd", "operation.nightEnd"],
          message: "야간 대관 종료 시각은 주간 대관 종료 시각보다 늦어야 합니다.",
        },
  (v) =>
    v["operation.winterStart"] !== v["operation.winterEnd"]
      ? null
      : {
          keys: ["operation.winterStart", "operation.winterEnd"],
          message: "동절기 시작일과 종료일이 같을 수 없습니다.",
        },
  (v) =>
    v["payment.method"] !== "bankTransfer" || v["payment.bankAccountInfo"].trim() !== ""
      ? null
      : {
          keys: ["payment.method", "payment.bankAccountInfo"],
          message: "계좌이체 방식을 쓰려면 입금 계좌 안내를 입력해야 합니다.",
        },
  (v) =>
    v["notification.paymentDeadlineHours"] < v["payment.bankTransferHoldHours"]
      ? null
      : {
          keys: ["notification.paymentDeadlineHours", "payment.bankTransferHoldHours"],
          message: "입금 기한 임박 알림 시점은 입금 기한보다 짧아야 합니다.",
        },
  (v) =>
    v["privacy.paymentRetentionYears"] >= v["privacy.applicationRetentionYears"]
      ? null
      : {
          keys: ["privacy.paymentRetentionYears", "privacy.applicationRetentionYears"],
          message: "결제·환불 기록은 신청 개인정보보다 짧게 보존할 수 없습니다(결제 기록이 신청을 참조합니다).",
        },
];

export function crossValidate(values: SettingValues): CrossValidationIssue[] {
  return rules.map((rule) => rule(values)).filter((issue): issue is CrossValidationIssue => issue !== null);
}
