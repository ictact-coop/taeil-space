import { z } from "zod";

export const discountInputSchema = z
  .object({
    name: z.string().trim().min(1, "감면 이름을 입력하세요.").max(50),
    description: z.string().trim().max(300),
    kind: z.enum(["percent", "amount"], { error: "방식을 고르세요." }),
    value: z.coerce.number({ error: "값을 숫자로 입력하세요." }).int("값은 정수여야 합니다."),
    proofRequired: z.boolean(),
    proofGuide: z.string().trim().max(200),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(999),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && (v.value < 1 || v.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "비율은 1~100% 사이여야 합니다." });
    }
    if (v.kind === "amount" && (v.value < 1 || v.value > 10_000_000)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "금액은 1원 이상이어야 합니다." });
    }
    if (v.proofRequired && v.proofGuide === "") {
      ctx.addIssue({ code: "custom", path: ["proofGuide"], message: "증빙이 필요하면 어떤 서류인지 안내 문구를 입력하세요." });
    }
  });

export type DiscountInput = z.infer<typeof discountInputSchema>;

export function discountInputFromForm(form: FormData): Record<string, unknown> {
  const s = (k: string) => String(form.get(k) ?? "");
  return {
    name: s("name"),
    description: s("description"),
    kind: s("kind"),
    value: s("value"),
    proofRequired: form.get("proofRequired") === "true",
    proofGuide: s("proofGuide"),
    isActive: form.get("isActive") === "true",
    sortOrder: s("sortOrder") || "0",
  };
}

export function describeDiscount(d: { kind: "percent" | "amount"; value: number }): string {
  return d.kind === "percent" ? `${d.value}% 감면` : `${d.value.toLocaleString("ko-KR")}원 감면`;
}
