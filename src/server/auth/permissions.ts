import type { AdminRoleName } from "@/domain/settings/define";

/** 전용 설정 화면별 수정 권한 (계획서 2.7: 대관 담당자는 휴관·일정 차단·접수기간만 수정) */
export const areaEditors = {
  spaces: ["system"],
  closures: ["system", "rental"],
  blocks: ["system", "rental"],
  bookingWindows: ["system", "rental"],
  fees: ["system"],
  discounts: ["system"],
} as const satisfies Record<string, readonly AdminRoleName[]>;

export type ManagedArea = keyof typeof areaEditors;

export function canManage(role: AdminRoleName, area: ManagedArea): boolean {
  return (areaEditors[area] as readonly AdminRoleName[]).includes(role);
}

export class PermissionError extends Error {
  constructor() {
    super("이 작업을 할 권한이 없습니다.");
  }
}

export function assertCanManage(role: AdminRoleName, area: ManagedArea): void {
  if (!canManage(role, area)) throw new PermissionError();
}
