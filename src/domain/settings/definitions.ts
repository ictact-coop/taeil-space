import { z } from "zod";
import {
  boolean,
  date,
  enumeration,
  integer,
  list,
  monthDay,
  percent,
  text,
  time,
  type AnySettingDefinition,
  type SettingDefinition,
} from "./define";

/**
 * 설정 항목 목록 (계획서 4장 카탈로그).
 * 공간(B)·휴관 규칙(C)·요금표와 감면(E)·시점별 환불률표(F)는 전용 테이블과 화면으로 단계 1에서 만든다.
 * 여기에는 단일 값으로 표현되는 설정만 둔다.
 */

const notificationChannel = (label: string, defaultValue: "both" | "email" | "lms" | "off", refs?: string[]) =>
  enumeration({
    group: "notification",
    label,
    refs: ["P-13", ...(refs ?? [])],
    defaultValue,
    options: [
      { value: "both", label: "이메일 + 문자(LMS)" },
      { value: "email", label: "이메일만" },
      { value: "lms", label: "문자(LMS)만" },
      { value: "off", label: "보내지 않음" },
    ],
  });

export const settingDefinitions = {
  // ─── A. 운영 기본 ───
  "operation.paidRentalStartDate": date({
    group: "operation",
    label: "유료 대관 전환일",
    description: "이 날짜 이후 이용일부터 유료 대관 규정을 적용합니다.",
    refs: ["[요구] 3장"],
    defaultValue: "2026-10-29",
  }),
  "operation.dayStart": time({
    group: "operation",
    label: "대관 시작 시각",
    refs: ["[요구] 11장"],
    defaultValue: "10:00",
  }),
  "operation.dayEnd": time({
    group: "operation",
    label: "주간 대관 종료 시각",
    description: "이 시각 이후는 야간 대관입니다.",
    refs: ["[요구] 11장"],
    defaultValue: "18:00",
  }),
  "operation.nightEnabled": boolean({
    group: "operation",
    label: "야간 대관",
    defaultValue: true,
    trueLabel: "받음",
    falseLabel: "받지 않음",
  }),
  "operation.nightEnd": time({
    group: "operation",
    label: "야간 대관 종료 시각",
    refs: ["[요구] 11장"],
    defaultValue: "21:00",
  }),
  "operation.winterStart": monthDay({
    group: "operation",
    label: "동절기 시작일",
    refs: ["[요구] 11장", "G-9"],
    defaultValue: "11-01",
  }),
  "operation.winterEnd": monthDay({
    group: "operation",
    label: "동절기 종료일",
    description: "시작일보다 앞선 날짜면 다음 해로 봅니다(예: 11월 1일 ~ 2월 28일).",
    defaultValue: "02-28",
  }),
  "operation.winterViewingClose": time({
    group: "operation",
    label: "동절기 관람 종료 시각",
    description: "대관 시간과 별개로 안내 문구에 사용합니다.",
    defaultValue: "17:30",
  }),
  "operation.reviewPeriodText": text({
    group: "operation",
    label: "예상 심사기간 안내",
    description: "신청 완료 화면과 접수 알림에 표시합니다.",
    refs: ["[요구] 21장"],
    defaultValue: "3~7일",
    maxLength: 30,
    required: true,
  }),

  // ─── D. 신청 규칙 ───
  "application.orgRegNoRequired": boolean({
    group: "application",
    label: "고유번호·사업자등록번호 입력",
    description: "필수가 아니면 번호 없는 신청은 단체 중복 여부를 심사자가 직접 확인합니다.",
    refs: ["P-03", "계획서 2.5"],
    defaultValue: false,
    trueLabel: "필수",
    falseLabel: "선택",
  }),
  "application.onePerOrgPerDay": boolean({
    group: "application",
    label: "같은 단체 같은 날 1건 제한",
    refs: ["BR-03"],
    defaultValue: true,
  }),
  "application.halfYearLimitEnabled": boolean({
    group: "application",
    label: "6개월 이용 횟수 제한",
    refs: ["P-03", "BR-04"],
    defaultValue: false,
  }),
  "application.halfYearLimitCount": integer({
    group: "application",
    label: "6개월 최대 횟수",
    refs: ["P-03", "BR-04"],
    defaultValue: 4,
    min: 1,
    max: 100,
    unit: "회",
  }),
  "application.halfYearLimitMethod": enumeration({
    group: "application",
    label: "6개월 산정 방식",
    refs: ["P-03"],
    defaultValue: "rolling",
    options: [
      { value: "rolling", label: "이용일 기준 최근 6개월" },
      { value: "calendarHalf", label: "반기(1~6월 / 7~12월)" },
    ],
  }),
  "application.halfYearLimitTarget": enumeration({
    group: "application",
    label: "횟수에 세는 대상",
    refs: ["P-03"],
    defaultValue: "confirmed",
    options: [
      { value: "submitted", label: "결제 완료된 신청(심사중 포함)" },
      { value: "confirmed", label: "예약확정·이용완료 건만" },
    ],
  }),
  "application.minPurposeLength": integer({
    group: "application",
    label: "행사 목적·내용 최소 글자수",
    refs: ["[요구] 15장"],
    defaultValue: 30,
    min: 0,
    max: 2000,
    unit: "자",
  }),
  "application.attachmentExtensions": list({
    group: "application",
    label: "첨부 허용 확장자",
    refs: ["[요구] 15장"],
    defaultValue: ["pdf", "hwp", "hwpx", "docx", "jpg", "png"],
    placeholder: "pdf, hwp, docx",
    item: z.string().regex(/^[a-z0-9]{1,10}$/, "확장자는 영문 소문자·숫자로 입력하세요(점 제외)."),
    normalize: (s) => s.replace(/^\./, "").toLowerCase(),
  }),
  "application.attachmentMaxMb": integer({
    group: "application",
    label: "첨부 파일당 최대 크기",
    defaultValue: 10,
    min: 1,
    max: 50,
    unit: "MB",
  }),
  "application.attachmentMaxCount": integer({
    group: "application",
    label: "첨부 최대 개수",
    defaultValue: 3,
    min: 0,
    max: 10,
    unit: "개",
  }),
  "application.revisionDeadlineDays": integer({
    group: "application",
    label: "보완 제출 기한",
    description: "기한이 지나면 신청을 종료하고 전액 환불합니다.",
    refs: ["P-14"],
    defaultValue: 3,
    min: 1,
    max: 30,
    unit: "일",
  }),

  // ─── F. 결제·환불 ───
  "payment.method": enumeration({
    group: "payment",
    label: "결제 방식",
    description: "PG 계약 전에는 계좌이체로 운영하고, 계약 후 PG로 바꿉니다.",
    refs: ["P-09"],
    defaultValue: "pg",
    options: [
      { value: "pg", label: "온라인 결제(PG)" },
      { value: "bankTransfer", label: "계좌이체(담당자 입금 확인)" },
    ],
  }),
  "payment.pgHoldMinutes": integer({
    group: "payment",
    label: "결제 유효시간(PG)",
    description: "이 시간 안에 결제하지 않으면 신청을 취소하고 일정을 다시 엽니다.",
    refs: ["P-05"],
    defaultValue: 30,
    min: 5,
    max: 180,
    unit: "분",
  }),
  "payment.bankTransferHoldHours": integer({
    group: "payment",
    label: "입금 기한(계좌이체)",
    refs: ["P-05"],
    defaultValue: 24,
    min: 1,
    max: 168,
    unit: "시간",
  }),
  "payment.bankAccountInfo": text({
    group: "payment",
    label: "입금 계좌 안내",
    description: "계좌이체 방식일 때 신청자에게 보여줍니다. 예: ○○은행 000-000000-00 (예금주 전태일재단)",
    defaultValue: "",
    multiline: true,
    maxLength: 300,
  }),
  "payment.withdrawRefundPercent": percent({
    group: "payment",
    label: "승인 전 철회 환불률",
    description: "결제 후 승인 전에 신청자가 철회할 때 돌려주는 비율입니다.",
    refs: ["P-15"],
    defaultValue: 100,
  }),
  "payment.postConfirmRefundMode": enumeration({
    group: "payment",
    label: "확정 후 취소 환불 처리",
    description: "반려·보완기한 만료에 따른 환불은 이 설정과 상관없이 항상 자동입니다.",
    refs: ["P-10"],
    defaultValue: "manual",
    options: [
      { value: "manual", label: "담당자 확인 후 환불" },
      { value: "auto", label: "자동 환불" },
    ],
  }),
  "payment.reviewDelayWarningDays": integer({
    group: "payment",
    label: "심사 지연 경고",
    description: "결제 후 이 기간이 지나도록 심사하지 않은 신청을 대시보드에 강조합니다.",
    defaultValue: 5,
    min: 1,
    max: 30,
    unit: "일",
  }),

  // ─── G. 알림 ───
  "notification.submitted": notificationChannel("결제 완료·신청 접수", "both"),
  "notification.revisionRequested": notificationChannel("보완 요청", "both"),
  "notification.rejected": notificationChannel("반려·환불", "email"),
  "notification.approved": notificationChannel("승인·예약확정", "both"),
  "notification.cancelled": notificationChannel("취소·환불 결과", "both"),
  "notification.paymentDeadline": notificationChannel("입금 기한 임박(계좌이체)", "lms"),
  "notification.preUse": notificationChannel("이용 전 안내", "email"),
  "notification.paymentDeadlineHours": integer({
    group: "notification",
    label: "입금 기한 임박 알림 시점",
    description: "입금 기한 몇 시간 전에 알릴지 정합니다.",
    defaultValue: 3,
    min: 1,
    max: 72,
    unit: "시간 전",
  }),
  "notification.preUseDays": integer({
    group: "notification",
    label: "이용 전 안내 시점",
    defaultValue: 2,
    min: 1,
    max: 14,
    unit: "일 전",
  }),
  "notification.staffEmails": list({
    group: "notification",
    label: "담당자 알림 수신 주소",
    description: "신청 접수·취소 알림을 받을 담당자 이메일입니다.",
    defaultValue: [],
    placeholder: "rental@taeil.org, staff@taeil.org",
    item: z.email("이메일 형식이 아닙니다."),
    normalize: (s) => s.toLowerCase(),
  }),

  // ─── H. 개인정보 ───
  "privacy.applicationRetentionYears": integer({
    group: "privacy",
    label: "신청 개인정보 보존기간",
    description: "기간이 지나면 신청자 개인정보를 삭제하거나 비식별화합니다. 법정 보존기간을 확인하고 정하세요.",
    refs: ["P-11"],
    defaultValue: 3,
    min: 1,
    max: 10,
    unit: "년",
  }),
  "privacy.attachmentRetentionYears": integer({
    group: "privacy",
    label: "첨부파일 보존기간",
    refs: ["P-11"],
    defaultValue: 1,
    min: 1,
    max: 10,
    unit: "년",
  }),
  "privacy.paymentRetentionYears": integer({
    group: "privacy",
    label: "결제·환불 기록 보존기간",
    description: "전자상거래 관련 법정 보존기간 이상으로 정하세요.",
    refs: ["P-11"],
    defaultValue: 5,
    min: 1,
    max: 10,
    unit: "년",
  }),
} satisfies Record<string, AnySettingDefinition>;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> =
  (typeof settingDefinitions)[K] extends SettingDefinition<infer T> ? T : never;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingDefinitions, key);
}

export function getDefinition<K extends SettingKey>(key: K): SettingDefinition<SettingValue<K>> {
  return settingDefinitions[key] as unknown as SettingDefinition<SettingValue<K>>;
}
