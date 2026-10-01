import { z } from "zod";
import { isValidDateString } from "./closures";

const optionalDate = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().refine(isValidDateString, "올바른 날짜가 아닙니다.").nullable(),
);
const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : Number(v)), z.number().int().min(min, message).max(max, message).nullable());

/** 휴관 규칙 입력 (계획서 2.6) */
export const closureInputSchema = z
  .object({
    type: z.enum(["weekly", "annual", "date_range", "open_exception"], { error: "규칙 유형을 고르세요." }),
    name: z.string().trim().min(1, "규칙 이름을 입력하세요.").max(50),
    publicMessage: z.string().trim().min(1, "이용자 안내 문구를 입력하세요.").max(200),
    spaceId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()),
    weekday: optionalInt(0, 6, "요일을 고르세요."),
    month: optionalInt(1, 12, "월은 1~12 사이여야 합니다."),
    day: optionalInt(1, 31, "일은 1~31 사이여야 합니다."),
    startDate: optionalDate,
    endDate: optionalDate,
    activeFrom: optionalDate,
    activeUntil: optionalDate,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.type === "weekly" && v.weekday === null) issue("weekday", "요일을 고르세요.");
    if (v.type === "annual") {
      if (v.month === null) issue("month", "월을 입력하세요.");
      if (v.day === null) issue("day", "일을 입력하세요.");
      if (v.month !== null && v.day !== null) {
        const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][v.month - 1] ?? 31;
        if (v.day > max) issue("day", `${v.month}월에는 ${v.day}일이 없습니다.`);
      }
    }
    if (v.type === "date_range" || v.type === "open_exception") {
      if (v.startDate === null) issue("startDate", "시작일을 입력하세요.");
      if (v.endDate === null) issue("endDate", "종료일을 입력하세요.");
      if (v.startDate && v.endDate && v.startDate > v.endDate) issue("endDate", "종료일은 시작일과 같거나 늦어야 합니다.");
    }
    if (v.activeFrom && v.activeUntil && v.activeFrom > v.activeUntil) {
      issue("activeUntil", "적용 종료일은 적용 시작일과 같거나 늦어야 합니다.");
    }
  })
  .transform((v) => ({
    ...v,
    // 유형에 해당하지 않는 칸은 비운다(DB 제약과 맞춤)
    weekday: v.type === "weekly" ? v.weekday : null,
    month: v.type === "annual" ? v.month : null,
    day: v.type === "annual" ? v.day : null,
    startDate: v.type === "date_range" || v.type === "open_exception" ? v.startDate : null,
    endDate: v.type === "date_range" || v.type === "open_exception" ? v.endDate : null,
  }));

export type ClosureInput = z.infer<typeof closureInputSchema>;
