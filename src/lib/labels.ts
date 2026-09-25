import type { AdminRoleName } from "@/domain/settings/define";

export const roleLabels: Record<AdminRoleName, string> = {
  rental: "대관 담당자",
  accounting: "회계 담당자",
  system: "시스템 관리자",
};

export const auditActionLabels: Record<string, string> = {
  "setting.change": "설정 변경",
  "setting.schedule": "설정 변경 예약",
  "setting.revert": "설정 되돌리기",
  "setting.cancel_scheduled": "설정 예약 취소",
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
  "auth.password_failed": "비밀번호 실패",
  "auth.totp_failed": "인증 코드 실패",
  "auth.locked": "계정 잠김",
  "auth.totp_enrolled": "2단계 인증 등록",
  "admin.created": "관리자 계정 생성",
};
