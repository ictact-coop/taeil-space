/**
 * 관리자 권한 목록. 등급(admin_grades)은 이 키들의 묶음이다.
 * 키는 DB에 저장되므로 바꾸지 않는다. 새 권한을 더하면 최고 관리자 등급은 자동으로 갖고,
 * 다른 등급에는 등급 관리 화면에서 더한다.
 */
export const permissionDefs = [
  { key: "applications.view", group: "신청", label: "신청 조회", description: "신청 목록·상세, 첨부 내려받기 (신청자 개인정보 열람)" },
  { key: "applications.review", group: "신청", label: "신청 심사", description: "검토 시작·보완 요청·반려·승인, 계좌이체 입금 확인, 내부 메모", requires: ["applications.view"] },
  { key: "refunds.manage", group: "신청", label: "환불 처리", description: "환불 목록, 계좌이체 환불 완료 기록, PG 환불 재시도", requires: ["applications.view"] },
  { key: "calendar.view", group: "일정", label: "대관 일정 조회", description: "대관 캘린더, 대시보드의 오늘·이번 주 일정" },
  { key: "schedule.manage", group: "일정", label: "휴관일·일정 관리", description: "휴관일, 일정 차단, 교육실 접수기간과 그 설정값", requires: ["settings.view"] },
  { key: "stats.view", group: "통계", label: "통계 조회", description: "월별·주별 이용·접수 실적과 수입 (집계값만, 신청자 정보 없음), CSV 내려받기" },
  { key: "settings.view", group: "정책", label: "정책 설정 조회", description: "정책 설정 화면 보기 (수정 불가)" },
  { key: "settings.manage", group: "정책", label: "운영 정책 변경", description: "운영 기본·신청 규칙·결제·환불·알림·개인정보·안내 문구 설정값", requires: ["settings.view"] },
  { key: "spaces.manage", group: "정책", label: "공간 관리", description: "공간 정보·정원·사진·공개 여부", requires: ["settings.view"] },
  { key: "pricing.manage", group: "정책", label: "요금·감면 관리", description: "요금표, 감면 종류", requires: ["settings.view"] },
  { key: "accounts.manage", group: "관리", label: "계정 관리", description: "관리자 계정 생성·등급 지정·초기화·중지 (최고 관리자 계정과 등급 설정은 최고 관리자만)" },
  { key: "audit.view", group: "관리", label: "감사 로그 조회", description: "로그인·설정 변경·개인정보 열람 기록" },
] as const satisfies readonly { key: string; group: string; label: string; description: string; requires?: readonly string[] }[];

export type Permission = (typeof permissionDefs)[number]["key"];

export const allPermissions: readonly Permission[] = permissionDefs.map((d) => d.key);

export function isPermission(value: string): value is Permission {
  return (allPermissions as readonly string[]).includes(value);
}

/** 선택한 권한에 필요한 선행 권한을 더하고, 모르는 키는 버린다(정의 순서로 정렬). */
export function normalizePermissions(values: readonly string[]): Permission[] {
  const set = new Set(values.filter(isPermission));
  for (const def of permissionDefs) {
    if (set.has(def.key) && "requires" in def) for (const r of def.requires) set.add(r);
  }
  return allPermissions.filter((p) => set.has(p));
}

/** 권한 검사 대상 (현재 관리자, 서비스의 actor) */
export interface PermissionHolder {
  isSuper: boolean;
  permissions: readonly Permission[];
}

export function hasPermission(holder: PermissionHolder, permission: Permission): boolean {
  return holder.isSuper || holder.permissions.includes(permission);
}
