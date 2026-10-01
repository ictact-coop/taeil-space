/** 관리자 폼 공통 상태. 제출마다 version을 올려 폼을 다시 그린다(오류 시 제출값 유지). */
export interface FormState {
  version: number;
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Partial<Record<string, string>>;
  values?: Record<string, string | string[]>;
}

export const initialFormState: FormState = { version: 0 };

export function formValues(form: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key).filter((v): v is string => typeof v === "string");
    values[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return values;
}

export function str(values: FormState["values"], key: string, fallback: string): string {
  const v = values?.[key];
  if (v === undefined) return fallback;
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

export function list(values: FormState["values"], key: string, fallback: string[]): string[] {
  const v = values?.[key];
  if (v === undefined) return fallback;
  return Array.isArray(v) ? v : v === "" ? [] : [v];
}
