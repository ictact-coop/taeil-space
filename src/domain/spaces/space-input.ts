import { z } from "zod";
import { isExtraConsentKey } from "./consents";

const int = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${label}을(를) 숫자로 입력하세요.` })
    .int(`${label}은(는) 정수여야 합니다.`)
    .min(min, `${label}은(는) ${min} 이상이어야 합니다.`)
    .max(max, `${label}은(는) ${max} 이하여야 합니다.`);

const optionalInt = (label: string, min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), int(label, min, max).nullable());

/** 공간 설정 폼 ([요구] 9·11장, P-02) */
export const spaceInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,30}$/, "코드는 영문 소문자로 시작하고 영문·숫자·하이픈만 쓸 수 있습니다."),
    name: z.string().trim().min(1, "공간 이름을 입력하세요.").max(50),
    capacity: int("정원", 1, 1000),
    minHeadcount: optionalInt("최소 인원", 1, 1000),
    description: z.string().trim().max(1000),
    equipment: z
      .string()
      .transform((s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().max(50)).max(30, "장비는 30개까지 입력할 수 있습니다.")),
    notice: z.string().trim().max(1000),
    /** 비우면 교육실처럼 관리자가 공개한 접수기간 안에서만 신청받는다 */
    leadDays: optionalInt("신청기한", 0, 365),
    slotMinutes: z.coerce
      .number()
      .refine((v) => [15, 30, 60, 90, 120, 180].includes(v), "예약 시간 단위는 15·30·60·90·120·180분 중에서 고르세요."),
    minDurationMinutes: int("최소 대관시간", 15, 720),
    bufferBeforeMinutes: int("준비 시간", 0, 180),
    bufferAfterMinutes: int("철수 시간", 0, 180),
    extraConsents: z.array(z.string()).refine((a) => a.every(isExtraConsentKey), "알 수 없는 동의 항목입니다."),
    isPublic: z.boolean(),
    sortOrder: int("표시 순서", 0, 999),
  })
  .superRefine((v, ctx) => {
    if (v.minHeadcount !== null && v.minHeadcount > v.capacity) {
      ctx.addIssue({ code: "custom", path: ["minHeadcount"], message: "최소 인원은 정원보다 클 수 없습니다." });
    }
    if (v.minDurationMinutes % v.slotMinutes !== 0) {
      ctx.addIssue({ code: "custom", path: ["minDurationMinutes"], message: "최소 대관시간은 예약 시간 단위의 배수여야 합니다." });
    }
    for (const key of ["bufferBeforeMinutes", "bufferAfterMinutes"] as const) {
      if (v[key] % 5 !== 0) ctx.addIssue({ code: "custom", path: [key], message: "준비·철수 시간은 5분 단위로 입력하세요." });
    }
  });

export type SpaceInput = z.infer<typeof spaceInputSchema>;

export function spaceInputFromForm(form: FormData): Record<string, unknown> {
  const s = (k: string) => String(form.get(k) ?? "");
  return {
    code: s("code"),
    name: s("name"),
    capacity: s("capacity"),
    minHeadcount: s("minHeadcount"),
    description: s("description"),
    equipment: s("equipment"),
    notice: s("notice"),
    leadDays: s("leadDays"),
    slotMinutes: s("slotMinutes"),
    minDurationMinutes: s("minDurationMinutes"),
    bufferBeforeMinutes: s("bufferBeforeMinutes"),
    bufferAfterMinutes: s("bufferAfterMinutes"),
    extraConsents: form.getAll("extraConsents").map(String),
    isPublic: form.get("isPublic") === "true",
    sortOrder: s("sortOrder"),
  };
}
