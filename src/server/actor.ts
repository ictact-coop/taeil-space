import type { AdminRoleName } from "@/domain/settings/define";

/** 관리 작업을 하는 관리자 (감사 로그용) */
export interface Actor {
  id: string;
  role: AdminRoleName;
  ip?: string | null;
}

export type MutationResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; formError?: string; fieldErrors?: Partial<Record<string, string>> };

export function requireReason(reason: string): string | null {
  return reason.trim().length >= 2 ? null : "변경 사유를 입력하세요.";
}

/** zod 오류를 필드별 첫 메시지로 */
export function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Postgres 오류 코드 (drizzle이 감싼 경우 cause까지) */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}
