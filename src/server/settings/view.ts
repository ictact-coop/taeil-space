import type { AdminRoleName, SettingGroup, SettingInput } from "@/domain/settings/define";
import { getDefinition, settingKeys, type SettingKey } from "@/domain/settings/definitions";
import { resolveSetting, upcomingRows, type PolicyRow } from "@/domain/settings/resolve";
import { formatKst } from "@/lib/time";
import { canEditSetting } from "./service";

/** 설정 페이지 폼에 넘기는 항목 (직렬화 가능한 값만) */
export interface SettingFieldView {
  key: SettingKey;
  label: string;
  description?: string;
  refs: string[];
  input: SettingInput;
  inputValue: string;
  displayValue: string;
  defaultDisplay: string;
  source: "default" | "stored";
  invalidStored: boolean;
  editable: boolean;
  requiredBeforeOpen: boolean;
  since: string | null;
  upcoming: { id: number; displayValue: string; effectiveFrom: string }[];
}

export function buildFieldViews(
  group: SettingGroup,
  rows: readonly PolicyRow[],
  role: AdminRoleName,
  now: Date,
): SettingFieldView[] {
  return settingKeys
    .filter((key) => getDefinition(key).group === group)
    .map((key) => {
      const def = getDefinition(key);
      const resolved = resolveSetting(key, rows, now);
      return {
        key,
        label: def.label,
        description: def.description,
        refs: [...(def.refs ?? [])],
        input: def.input,
        inputValue: def.toInput(resolved.value),
        displayValue: def.format(resolved.value),
        defaultDisplay: def.format(def.defaultValue),
        source: resolved.source,
        invalidStored: resolved.invalidStored,
        editable: canEditSetting(role, key),
        requiredBeforeOpen: def.requiredBeforeOpen,
        since: resolved.row ? formatKst(resolved.row.effectiveFrom) : null,
        upcoming: upcomingRows(rows, key, now, def.defaultValue).map((row) => {
          const parsed = def.schema.safeParse(row.value);
          return {
            id: row.id,
            displayValue: parsed.success ? def.format(parsed.data) : "(올바르지 않은 값)",
            effectiveFrom: formatKst(row.effectiveFrom),
          };
        }),
      };
    });
}
