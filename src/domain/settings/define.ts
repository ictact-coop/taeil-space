import { z } from "zod";
import { describeRefundTiers, refundTiersSchema, type RefundTier } from "@/domain/refund/tiers";

/**
 * 설정 정의 빌더 (계획서 2.7).
 * 설정의 키·자료형·기본값·허용 범위·설명은 코드에 두고, 값만 DB(policy_values)에 버전으로 쌓는다.
 * 설정 페이지는 이 정의를 읽어 입력 폼을 자동으로 그린다.
 */

export const settingGroups = {
  operation: { label: "운영 기본", description: "유료 전환일, 대관 가능시간, 동절기 운영" },
  schedule: { label: "교육실 접수기간", description: "접수기간 공개 방식(수동·자동)과 연장 단위" },
  application: { label: "신청 규칙", description: "단체 판별, 신청 제한, 입력·첨부 조건, 보완" },
  payment: { label: "결제·환불", description: "결제 방식, 결제 유효시간, 환불 처리" },
  notification: { label: "알림", description: "사건별 발송 채널과 시점" },
  privacy: { label: "개인정보", description: "자료 보존기간" },
} as const;

export type SettingGroup = keyof typeof settingGroups;
export type AdminRoleName = "rental" | "accounting" | "system";

export type SettingInput =
  | { kind: "integer"; min: number; max: number; unit?: string }
  | { kind: "percent" }
  | { kind: "boolean"; trueLabel: string; falseLabel: string }
  | { kind: "enum"; options: readonly { value: string; label: string }[] }
  | { kind: "time" }
  | { kind: "date" }
  | { kind: "monthDay" }
  | { kind: "text"; multiline: boolean; maxLength: number }
  | { kind: "list"; placeholder: string }
  | { kind: "tiers" };

export interface SettingDefinition<T> {
  group: SettingGroup;
  label: string;
  description?: string;
  /** 관련 정책 결정·규칙 ID (예: P-05, BR-03) */
  refs?: readonly string[];
  input: SettingInput;
  defaultValue: T;
  schema: z.ZodType<T>;
  /** 이 설정을 수정할 수 있는 역할. 시스템 관리자는 항상 포함된다. */
  editableBy: readonly AdminRoleName[];
  /** 오픈 전에 기념관이 값을 확정해야 하는 항목 (계획서 6장 ★) */
  requiredBeforeOpen: boolean;
  /** 폼 문자열 → 값. 실패 시 사용자에게 보여줄 오류 메시지. */
  parse(raw: string | undefined): { ok: true; value: T } | { ok: false; error: string };
  /** 값 → 화면 표시 문자열 */
  format(value: T): string;
  /** 값 → 폼 입력 초기값 */
  toInput(value: T): string;
}

interface Common {
  group: SettingGroup;
  label: string;
  description?: string;
  refs?: readonly string[];
  editableBy?: readonly AdminRoleName[];
  requiredBeforeOpen?: boolean;
}

function build<T>(
  common: Common,
  input: SettingInput,
  defaultValue: T,
  schema: z.ZodType<T>,
  fromRaw: (raw: string) => unknown,
  format: (value: T) => string,
  toInput: (value: T) => string = (v) => String(v),
): SettingDefinition<T> {
  const parsedDefault = schema.safeParse(defaultValue);
  if (!parsedDefault.success) {
    throw new Error(`설정 "${common.label}"의 기본값이 허용 범위를 벗어났습니다.`);
  }
  return {
    ...common,
    editableBy: common.editableBy ?? ["system"],
    requiredBeforeOpen: common.requiredBeforeOpen ?? false,
    input,
    defaultValue,
    schema,
    parse(raw) {
      const result = schema.safeParse(fromRaw((raw ?? "").trim()));
      if (result.success) return { ok: true, value: result.data };
      return { ok: false, error: result.error.issues[0]?.message ?? "올바른 값이 아닙니다." };
    },
    format,
    toInput,
  };
}

const toNumber = (raw: string) => (raw === "" ? Number.NaN : Number(raw));

export function integer(
  c: Common & { defaultValue: number; min: number; max: number; unit?: string },
): SettingDefinition<number> {
  const unit = c.unit ?? "";
  return build(
    c,
    { kind: "integer", min: c.min, max: c.max, unit: c.unit },
    c.defaultValue,
    z
      .number({ error: "숫자를 입력하세요." })
      .int("정수를 입력하세요.")
      .min(c.min, `${c.min}${unit} 이상이어야 합니다.`)
      .max(c.max, `${c.max}${unit} 이하여야 합니다.`),
    toNumber,
    (v) => `${v.toLocaleString("ko-KR")}${unit}`,
  );
}

export function percent(c: Common & { defaultValue: number }): SettingDefinition<number> {
  return build(
    c,
    { kind: "percent" },
    c.defaultValue,
    z
      .number({ error: "숫자를 입력하세요." })
      .int("정수를 입력하세요.")
      .min(0, "0% 이상이어야 합니다.")
      .max(100, "100% 이하여야 합니다."),
    toNumber,
    (v) => `${v}%`,
  );
}

export function boolean(
  c: Common & { defaultValue: boolean; trueLabel?: string; falseLabel?: string },
): SettingDefinition<boolean> {
  const trueLabel = c.trueLabel ?? "사용";
  const falseLabel = c.falseLabel ?? "사용 안 함";
  return build(
    c,
    { kind: "boolean", trueLabel, falseLabel },
    c.defaultValue,
    z.boolean(),
    (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
    (v) => (v ? trueLabel : falseLabel),
  );
}

export function enumeration<const V extends string>(
  c: Common & { defaultValue: NoInfer<V>; options: readonly { value: V; label: string }[] },
): SettingDefinition<V> {
  const values = c.options.map((o) => o.value) as [V, ...V[]];
  return build<V>(
    c,
    { kind: "enum", options: c.options },
    c.defaultValue,
    z.enum(values, { error: "목록에서 선택하세요." }) as unknown as z.ZodType<V>,
    (raw) => raw,
    (v) => c.options.find((o) => o.value === v)?.label ?? v,
  );
}

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-4]):[0-5]\d$/, "HH:MM 형식으로 입력하세요.")
  .refine((v) => v <= "24:00", "24:00 이하여야 합니다.");

export function time(c: Common & { defaultValue: string }): SettingDefinition<string> {
  return build(c, { kind: "time" }, c.defaultValue, timeSchema, (raw) => raw, (v) => v);
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식으로 입력하세요.")
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "존재하지 않는 날짜입니다.");

export function date(c: Common & { defaultValue: string }): SettingDefinition<string> {
  return build(c, { kind: "date" }, c.defaultValue, dateSchema, (raw) => raw, (v) => v);
}

const monthDaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "MM-DD 형식으로 입력하세요.")
  .refine((v) => {
    const [m, d] = v.split("-").map(Number) as [number, number];
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
    return d <= daysInMonth;
  }, "존재하지 않는 날짜입니다.");

export function monthDay(c: Common & { defaultValue: string }): SettingDefinition<string> {
  return build(
    c,
    { kind: "monthDay" },
    c.defaultValue,
    monthDaySchema,
    (raw) => raw,
    (v) => {
      const [m, d] = v.split("-").map(Number);
      return `${m}월 ${d}일`;
    },
  );
}

export function text(
  c: Common & { defaultValue: string; multiline?: boolean; maxLength?: number; required?: boolean },
): SettingDefinition<string> {
  const maxLength = c.maxLength ?? 500;
  let schema = z.string().max(maxLength, `${maxLength}자 이하로 입력하세요.`);
  if (c.required) schema = schema.min(1, "값을 입력하세요.");
  return build(
    c,
    { kind: "text", multiline: c.multiline ?? false, maxLength },
    c.defaultValue,
    schema,
    (raw) => raw,
    (v) => (v === "" ? "(비어 있음)" : v),
  );
}

/** 쉼표로 구분한 목록. item으로 각 항목을 검증한다. */
export function list(
  c: Common & {
    defaultValue: string[];
    item: z.ZodType<string>;
    placeholder: string;
    maxItems?: number;
    normalize?: (item: string) => string;
  },
): SettingDefinition<string[]> {
  const maxItems = c.maxItems ?? 20;
  const normalize = c.normalize ?? ((s: string) => s);
  return build(
    c,
    { kind: "list", placeholder: c.placeholder },
    c.defaultValue,
    z
      .array(c.item)
      .max(maxItems, `${maxItems}개까지 입력할 수 있습니다.`)
      .refine((items) => new Set(items).size === items.length, "중복된 항목이 있습니다."),
    (raw) =>
      raw
        .split(/[,\n]/)
        .map((s) => normalize(s.trim()))
        .filter((s) => s !== ""),
    (v) => (v.length === 0 ? "(없음)" : v.join(", ")),
    (v) => v.join(", "),
  );
}

/** 시점별 환불률표. 폼에서는 JSON 문자열로 주고받는다. */
export function refundTiers(c: Common & { defaultValue: RefundTier[] }): SettingDefinition<RefundTier[]> {
  return build<RefundTier[]>(
    c,
    { kind: "tiers" },
    c.defaultValue,
    refundTiersSchema as unknown as z.ZodType<RefundTier[]>,
    (raw) => {
      try {
        return raw === "" ? [] : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    describeRefundTiers,
    (v) => JSON.stringify(v),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 서로 다른 자료형의 정의를 한 목록에 담기 위한 타입
export type AnySettingDefinition = SettingDefinition<any>;
