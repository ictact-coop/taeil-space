import { z } from "zod";
import { isValidDateString } from "@/domain/calendar/closures";
import { toMinutes } from "./time";

const time = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, "시각 형식이 올바르지 않습니다.");
const trimmed = (label: string, max: number) => z.string().trim().min(1, `${label}을(를) 입력하세요.`).max(max, `${label}은(는) ${max}자 이하로 입력하세요.`);
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^0\d{8,10}$/, "전화번호를 확인하세요(예: 010-1234-5678)."));

/** 신청서 입력 ([요구] 15장). 설정에 따라 달라지는 검사(최소 글자수, 단체번호 필수 등)는 제출 서비스에서 한다. */
export const applicationInputSchema = z
  .object({
    spaceId: z.string().uuid("공간을 선택하세요."),
    date: z.string().refine(isValidDateString, "날짜를 선택하세요."),
    start: time,
    end: time,
    orgName: trimmed("단체명", 100),
    regType: z.enum(["unique_no", "business_no", ""]),
    regNo: z.string().trim().max(20),
    contactName: trimmed("담당자 이름", 50),
    contactPhone: phone,
    contactEmail: z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아닙니다.")),
    eventTitle: trimmed("행사명", 100),
    eventPurpose: z.string().trim().max(3000, "행사 목적과 내용은 3,000자 이하로 입력하세요."),
    eventPublic: z.boolean(),
    expectedHeadcount: z.coerce.number({ error: "예상 인원을 숫자로 입력하세요." }).int("예상 인원은 정수여야 합니다.").min(1, "예상 인원을 입력하세요.").max(10000),
    nightManagerName: z.string().trim().max(50),
    nightManagerPhone: z.string().trim().max(20),
    discountRuleId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()),
    optionKeys: z.array(z.string().max(30)).max(20),
    consents: z.array(z.string()),
    uploadToken: z.string().min(20, "업로드 세션이 올바르지 않습니다. 화면을 새로고침하세요."),
  })
  .transform((v) => ({ ...v, startMinutes: toMinutes(v.start), endMinutes: toMinutes(v.end) }));

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export function applicationInputFromForm(form: FormData): Record<string, unknown> {
  const s = (k: string) => String(form.get(k) ?? "");
  return {
    spaceId: s("spaceId"),
    date: s("date"),
    start: s("start"),
    end: s("end"),
    orgName: s("orgName"),
    regType: s("regType"),
    regNo: s("regNo"),
    contactName: s("contactName"),
    contactPhone: s("contactPhone"),
    contactEmail: s("contactEmail"),
    eventTitle: s("eventTitle"),
    eventPurpose: s("eventPurpose"),
    eventPublic: form.get("eventPublic") === "true",
    expectedHeadcount: s("expectedHeadcount"),
    nightManagerName: s("nightManagerName"),
    nightManagerPhone: s("nightManagerPhone"),
    discountRuleId: s("discountRuleId"),
    optionKeys: form.getAll("optionKeys").map(String),
    consents: form.getAll("consents").map(String),
    uploadToken: s("uploadToken"),
  };
}
