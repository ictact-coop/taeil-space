import { hasPermission, type Permission, type PermissionHolder } from "@/domain/auth/permissions";

export class PermissionError extends Error {
  constructor() {
    super("이 작업을 할 권한이 없습니다.");
  }
}

/** 서비스 함수의 권한 검사. 등급에 권한이 없으면 PermissionError (서버 액션의 guard가 폼 오류로 바꾼다). */
export function assertPermission(actor: PermissionHolder, permission: Permission): void {
  if (!hasPermission(actor, permission)) throw new PermissionError();
}
