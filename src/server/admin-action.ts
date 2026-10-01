import "server-only";
import type { FormState } from "@/components/admin/form-state";
import { PermissionError } from "@/server/auth/permissions";

/** 서버 액션에서 권한 오류를 폼 오류로 바꾼다. */
export async function guard(prev: FormState, fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return { version: prev.version + 1, formError: e.message };
    throw e;
  }
}
