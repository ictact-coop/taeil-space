/** 신청 동의 항목 ([요구] 12·15장, 계획서 G-3: 항목별 분리 동의) */
export const baseConsents = {
  privacy: "개인정보 수집·이용",
  operationRules: "대관 운영규정",
  refundRules: "취소·환불 규정",
} as const;

/** 야간(주간 종료 시각 이후)을 포함하면 추가로 받는 동의 */
export const nightConsent = { nightRules: "야간 출입문 관리 규정" } as const;

/** 공간별로 켜는 추가 동의 */
export const extraConsentCatalog = {
  hallRules: "공연장 이용 규정",
} as const;

export type ExtraConsentKey = keyof typeof extraConsentCatalog;

export function isExtraConsentKey(value: string): value is ExtraConsentKey {
  return Object.hasOwn(extraConsentCatalog, value);
}
