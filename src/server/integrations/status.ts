/**
 * 외부 연동 상태 (계획서 4장 I 그룹). 키 자체는 서버 환경변수·비밀 저장소에만 두고 화면에는 설정 여부만 보인다.
 * 실제 연결 확인은 각 연동을 구현하는 단계(PG: 단계 3, 이메일: 단계 3, LMS: 단계 5)에서 추가한다.
 */
export interface IntegrationStatus {
  id: "pg" | "email" | "lms" | "storage";
  label: string;
  configured: boolean;
  mode: string;
  detail: string;
  stage: string;
}

const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]));

export function getIntegrationStatuses(): IntegrationStatus[] {
  const pgLive = process.env.PORTONE_MODE === "live";
  return [
    {
      id: "pg",
      label: "온라인 결제(PortOne)",
      configured: has("PORTONE_STORE_ID", "PORTONE_CHANNEL_KEY", "PORTONE_API_SECRET", "PORTONE_WEBHOOK_SECRET"),
      mode: pgLive ? "라이브" : "테스트",
      detail: "PortOne 가입 후 상점 ID·채널 키·API 시크릿·웹훅 시크릿을 서버 환경변수로 설정합니다.",
      stage: "단계 3",
    },
    {
      id: "email",
      label: "이메일 발송",
      configured: has("EMAIL_PROVIDER", "EMAIL_FROM"),
      mode: process.env.EMAIL_PROVIDER ?? "-",
      detail: "발신 도메인 인증(SPF·DKIM) 후 발송 서비스 키를 설정합니다.",
      stage: "단계 3",
    },
    {
      id: "lms",
      label: "문자(LMS) 발송",
      configured: has("SMS_PROVIDER", "SMS_SENDER"),
      mode: process.env.SMS_PROVIDER ?? "-",
      detail: "발신번호 사전 등록 후 발송 서비스 키를 설정합니다.",
      stage: "단계 5",
    },
    {
      id: "storage",
      label: "첨부파일 저장소",
      configured: has("STORAGE_BUCKET"),
      mode: process.env.STORAGE_BUCKET ? "S3 호환" : "-",
      detail: "신청 첨부·공간 사진을 저장할 버킷을 설정합니다.",
      stage: "단계 2",
    },
  ];
}
