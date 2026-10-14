import { z } from "zod";
import {
  boolean,
  date,
  enumeration,
  integer,
  list,
  monthDay,
  percent,
  refundTiers,
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
  "operation.nightOnWeekends": boolean({
    group: "operation",
    label: "토·일요일 야간 대관",
    description: "받지 않음이면 토·일요일은 주간 대관 종료 시각까지만 신청할 수 있습니다.",
    defaultValue: false,
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

  // ─── C. 교육실 접수기간 ───
  "schedule.bookingWindowMode": enumeration({
    group: "schedule",
    label: "접수기간 공개 방식",
    description: "신청기한 대신 접수기간으로 받는 공간(교육실)에 적용합니다.",
    refs: ["P-08", "AT-04"],
    requiredBeforeOpen: true,
    editPermission: "schedule.manage",
    defaultValue: "manual",
    options: [
      { value: "manual", label: "담당자가 직접 공개" },
      { value: "auto", label: "자동(오늘부터 N일)" },
    ],
  }),
  "schedule.bookingWindowAutoDays": integer({
    group: "schedule",
    label: "자동 공개 기간",
    description: "자동 방식일 때 오늘부터 며칠 뒤까지 신청을 받을지 정합니다.",
    refs: ["P-08"],
    editPermission: "schedule.manage",
    defaultValue: 14,
    min: 1,
    max: 90,
    unit: "일",
  }),
  "schedule.bookingWindowExtendDays": integer({
    group: "schedule",
    label: "연장 버튼 단위",
    description: "접수기간 화면의 연장 버튼을 누를 때 늘어나는 일수입니다.",
    editPermission: "schedule.manage",
    defaultValue: 7,
    min: 1,
    max: 30,
    unit: "일",
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
    requiredBeforeOpen: true,
    group: "payment",
    label: "결제 방식",
    description: "PG 연동 전에는 계좌이체로 운영합니다(신청 → 입금 → 담당자 입금 확인 → 심사·승인). PG는 PortOne 키를 설정한 뒤 선택할 수 있습니다.",
    refs: ["P-09"],
    defaultValue: "bankTransfer",
    options: [
      { value: "pg", label: "온라인 결제(PG)" },
      { value: "bankTransfer", label: "계좌이체(담당자 입금 확인)" },
    ],
  }),
  "payment.pgHoldMinutes": integer({
    // PG는 나중에 붙이므로 오픈 필수 항목에서 뺀다(PG 전환 때 확인)
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
    requiredBeforeOpen: true,
    group: "payment",
    label: "입금 기한(계좌이체)",
    refs: ["P-05"],
    defaultValue: 24,
    min: 1,
    max: 168,
    unit: "시간",
  }),
  "payment.bankAccountInfo": text({
    // 계좌이체가 기본이므로 오픈 전에 꼭 채운다(비어 있으면 이용자에게 "따로 안내"로 보인다)
    requiredBeforeOpen: true,
    group: "payment",
    label: "입금 계좌 안내",
    description: "계좌이체 방식일 때 신청자에게 보여줍니다. 예: ○○은행 000-000000-00 (예금주 전태일재단)",
    defaultValue: "",
    multiline: true,
    maxLength: 300,
  }),
  "payment.depositorNameGuide": text({
    group: "payment",
    label: "입금자명 안내 문구",
    description: "계좌이체 입금 화면·입금 안내 메일·나의 대관에 보여줍니다. {신청번호} {담당자} {단체명}은 신청 내용으로 바뀝니다.",
    defaultValue: "입금자명에 신청하신 분 이름을 적어주세요. (입금자명과 신청하신 분 이름이 다르면 확인이 어렵습니다.)",
    multiline: true,
    maxLength: 300,
  }),
  "payment.withdrawRefundPercent": percent({
    requiredBeforeOpen: true,
    group: "payment",
    label: "승인 전 철회 환불률",
    description: "결제 후 승인 전에 신청자가 철회할 때 돌려주는 비율입니다.",
    refs: ["P-15"],
    defaultValue: 100,
  }),
  "payment.refundTiers": refundTiers({
    group: "payment",
    label: "확정 후 취소 시점별 환불률",
    description: "예약확정 후 신청자가 취소할 때, 이용일까지 남은 기간에 따라 돌려주는 비율입니다. 어느 구간에도 들지 않으면 환불하지 않습니다. 이용자가 결제 전에 동의하는 규정입니다.",
    refs: ["P-06", "AT-09"],
    requiredBeforeOpen: true,
    defaultValue: [],
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
  "notification.submitted": notificationChannel("신청 접수(입금 안내·입금 확인)", "both"),
  "notification.revisionRequested": notificationChannel("보완 요청", "both"),
  "notification.rejected": notificationChannel("반려·환불", "email"),
  "notification.approved": notificationChannel("승인·예약확정", "both"),
  "notification.cancelled": notificationChannel("취소·환불 결과", "both"),
  "notification.paymentDeadline": notificationChannel("입금 기한 임박(계좌이체)", "both"),
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

  // ─── 안내·규정 문구 ([요구] 11·12장) ───
  "content.heroHtml": text({
    group: "content",
    label: "첫 페이지 상단 안내 상자(HTML)",
    description:
      "첫 페이지 그림 위 흰 상자에 들어가는 내용입니다. 태그(<p> <h1> <span> <br> 등)와 class는 그대로 두고 글자만 고치면 됩니다. 허용하지 않는 태그·속성(script, style, onclick 등)은 화면에 넣을 때 자동으로 지워집니다. 비우면 상자를 숨깁니다.",
    defaultValue: "<p class=\"text-xs font-semibold tracking-[0.2em] text-brick\">SPACE RENTAL · 2026</p>\n<h1 class=\"mt-3 font-serif text-4xl leading-tight text-navy-deep sm:text-5xl\">모임의 뜻이<br><span class=\"text-brick-dark\">이어지는 공간</span></h1>\n<p class=\"mt-4 text-ink\">전태일기념관의 공간과 일정을 확인하고 온라인으로 대관을 신청하세요. 신청은 입금 후 담당자 심사를 거쳐 확정됩니다.</p>",
    multiline: true,
    maxLength: 3000,
  }),
  "content.guideNotice": text({
    group: "content",
    label: "대관 안내 추가 문구",
    description: "대관 안내 화면 상단에 표시합니다. 빈 줄로 문단을 나눕니다.",
    defaultValue: "귀중품과 물품의 분실·파손 책임은 이용 단체에 있습니다.",
    multiline: true,
    maxLength: 2000,
  }),
  "content.reviewMessageTemplates": text({
    group: "content",
    label: "반려·보완 요청 문구 모음",
    description:
      "신청 상세의 반려 사유·보완 요청 칸에서 골라 넣는 문구입니다. 문구 사이는 ---만 있는 줄로 나누고, 각 문구의 첫 줄은 목록에 보일 이름입니다. {일자} {공간} {신청번호} {단체명} {담당자}는 신청 내용으로 바뀝니다.",
    defaultValue: [
      "일정 중복",
      "안녕하세요, 전태일기념관입니다.",
      "",
      "먼저 저희 기념관에 관심을 갖고 신청해 주셔서 감사드립니다.",
      "안타깝게도 신청하신 일자({일자})는 다른 예약 일정과 중복되어 이용이 어려움을 안내해 드립니다.",
      "---",
      "운영 기준 변경(유료 대관 전환)",
      "안녕하세요, 전태일기념관입니다.",
      "신청하신 대관 건은 운영 기준 변경으로 인해 반려되었음을 안내해 드립니다.",
      "현재 기념관은 10월 15일 이용 건까지만 무료 대관 승인을 진행하고 있으며, 10월 15일부터는 '유료 대관'으로 전환되어 운영될 예정입니다.",
      "10월 15일 이후 대관은 결제시스템 구축 이후 신청 가능합니다.",
      "홈페이지를 통해 안내드리겠습니다.",
      "---",
      "회신 요청",
      "신청하신 {일자} {공간} 대관 신청 건으로 연락드렸으니 회신 부탁드립니다.",
      "회신이 늦어질 시 대관 신청이 취소될 수 있습니다.",
      "---",
      "신청 기한(7일 전) 미준수",
      "본 시설은 원활한 일정 조율과 행정 처리를 위해 이용일 기준 최소 7일 전까지 대관 신청을 완료해 주셔야 합니다.",
      "7일 이내에 임박하여 신청하실 경우, 담당자 확인 및 승인 처리가 불가하여 공간 이용이 어려울 수 있으니 이 점 양해 부탁드립니다.",
      "이용에 불이익이 없도록 반드시 일정을 확인하시어 기한 내에 신청해 주시기를 바랍니다. 감사합니다.",
    ].join("\n"),
    multiline: true,
    maxLength: 10000,
  }),
  "content.submitNotices": text({
    group: "content",
    label: "신청 전 확인 안내(팝업)",
    description: "신청서에서 '신청하기'를 누르면 뜨는 팝업의 안내 문구입니다. 한 줄에 한 항목씩 쓰고, 신청자가 확인 체크를 해야 신청됩니다. {입금기한}은 정책 설정의 입금 기한(예: 24시간)으로 바뀝니다. 비우면 팝업 없이 바로 신청됩니다.",
    defaultValue: [
      "1. 24시간 안에 입금하시면 담당자가 확인한 뒤 심사합니다. 반려되면 입금액 전액을 돌려드립니다.",
      "2. 신청하신 분과 입금자가 다른 경우, 입금자명을 신청하신 분 이름으로 입금해주세요.",
      "3. 담당자의 심사 후 반려될 수 있습니다.",
    ].join("\n"),
    multiline: true,
    maxLength: 2000,
  }),
  "content.smsConsent": text({
    group: "content",
    label: "문자 수신 동의 안내",
    description: "신청서의 '문자(SMS) 수신 동의(선택)' 항목을 펼치면 보이는 설명입니다.",
    defaultValue: "대관 신청 접수, 입금 안내, 심사 결과, 이용 안내를 신청서에 적은 휴대전화로 문자(SMS·LMS)로 보내 드립니다.\n동의하지 않아도 신청할 수 있으며, 안내는 이메일로 받습니다.",
    multiline: true,
    maxLength: 2000,
  }),
  "content.privacyPolicy": text({
    group: "content",
    label: "개인정보 수집·이용 동의 전문",
    refs: ["[요구] 12·24장"],
    defaultValue:
      "수집 항목: 단체명, 고유번호·사업자등록번호, 담당자 이름·휴대전화·이메일, 행사 정보, 첨부파일\n이용 목적: 대관 신청 접수·심사, 결제·환불, 이용 안내\n보유 기간: 대관 종료 후 설정된 보존기간(법정 보존 자료는 관련 법령에 따름)\n동의를 거부할 수 있으나, 거부하면 대관 신청을 할 수 없습니다.",
    multiline: true,
    maxLength: 5000,
    required: true,
  }),
  "content.operationRules": text({
    group: "content",
    label: "대관 운영규정 전문",
    refs: ["[요구] 12장"],
    defaultValue:
      "1. 귀중품 및 물품의 분실·파손 책임은 이용 단체에 있습니다.\n2. PC·HDMI 등 장비를 임의로 변경하지 않습니다.\n3. 허가받지 않은 장비를 반입·변경하지 않습니다.\n4. 음식물(식사류)은 먹을 수 없습니다.\n5. 신청 내용과 다르게 사용하면 이용이 제한될 수 있습니다.",
    multiline: true,
    maxLength: 5000,
    required: true,
  }),
  "content.nightRules": text({
    group: "content",
    label: "야간 출입문 관리 규정 전문",
    refs: ["[요구] 11·12장"],
    defaultValue:
      "1. 야간 대관은 출입문 관리 담당자를 지정해야 합니다.\n2. 18:00 이전에 사용·철수 방법을 인계받아야 합니다.\n3. 종료 후 다른 이용자가 없으면 해당 층 전체 조명을 끕니다.",
    multiline: true,
    maxLength: 5000,
    required: true,
  }),
  "content.hallRules": text({
    group: "content",
    label: "공연장 이용 규정 전문",
    refs: ["[요구] 9·12장"],
    defaultValue: "1. 공연장 이용 전·후에 대표번호(02-318-0903~4)로 연락합니다.\n2. 무대 조명·음향 장비는 안내받은 방법으로만 사용합니다.\n3. 현수막은 500×90cm 규격만 걸 수 있습니다.",
    multiline: true,
    maxLength: 5000,
    required: true,
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
