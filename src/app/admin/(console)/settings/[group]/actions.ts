"use server";

import { revalidatePath } from "next/cache";
import { settingGroups, type SettingGroup } from "@/domain/settings/define";
import { getDefinition, isSettingKey } from "@/domain/settings/definitions";
import { parseKstLocalInput } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { saveSettingChanges } from "@/server/settings/service";

export interface SettingsFormState {
  version: number;
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** 오류가 났을 때 입력값을 유지하기 위한 제출값 */
  submitted?: Record<string, string>;
  reason?: string;
  effectiveMode?: string;
  effectiveFrom?: string;
}

export async function saveSettingsAction(
  group: SettingGroup,
  prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await requireAdmin();
  if (!Object.hasOwn(settingGroups, group)) return { version: prev.version + 1, formError: "알 수 없는 설정 그룹입니다." };

  const rawValues: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("v:") || typeof value !== "string") continue;
    const key = name.slice(2);
    if (isSettingKey(key) && getDefinition(key).group === group) rawValues[key] = value;
  }
  // 체크 해제된 불리언 등 누락값 대비: 폼에는 라디오로만 두므로 별도 처리 없음
  const reason = String(formData.get("reason") ?? "");
  const effectiveMode = String(formData.get("effectiveMode") ?? "now");
  const effectiveInput = String(formData.get("effectiveFrom") ?? "");
  const keep = { submitted: rawValues, reason, effectiveMode, effectiveFrom: effectiveInput };

  let effectiveFrom = new Date();
  if (effectiveMode === "scheduled") {
    const parsed = parseKstLocalInput(effectiveInput);
    if (!parsed) return { version: prev.version + 1, formError: "적용 시작 시각을 입력하세요.", ...keep };
    effectiveFrom = parsed;
  }

  const result = await saveSettingChanges(db, {
    actor: { id: admin.id, role: admin.role, ip: admin.ip },
    rawValues,
    effectiveFrom,
    reason,
  });
  if (!result.ok) {
    return {
      version: prev.version + 1,
      formError: result.formError ?? "입력값을 확인하세요.",
      fieldErrors: result.fieldErrors,
      ...keep,
    };
  }
  revalidatePath("/admin/settings", "layout");
  const labels = result.savedKeys.map((k) => getDefinition(k).label).join(", ");
  return {
    version: prev.version + 1,
    ok: true,
    message:
      effectiveMode === "scheduled"
        ? `${result.savedKeys.length}개 항목의 변경을 예약했습니다: ${labels}`
        : `${result.savedKeys.length}개 항목을 저장했습니다: ${labels}`,
  };
}
