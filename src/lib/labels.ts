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
  "setting.confirm": "설정 확정",
  "space.create": "공간 추가",
  "space.update": "공간 수정",
  "closure.create": "휴관 규칙 추가",
  "closure.deactivate": "휴관 규칙 끄기",
  "block.create": "일정 차단",
  "block.delete": "일정 차단 해제",
  "booking_window.set": "접수기간 설정",
  "booking_window.extend": "접수기간 연장",
  "fee_schedule.create": "요금표 저장",
  "fee_schedule.schedule": "요금표 예약",
  "fee_schedule.cancel_scheduled": "요금표 예약 취소",
  "discount.create": "감면 규칙 추가",
  "discount.update": "감면 규칙 수정",
};
