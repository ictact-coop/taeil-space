import { z } from "zod";
import { parseKstLocalInput } from "@/lib/time";

const kstDateTime = (label: string) =>
  z.string().transform((v, ctx) => {
    const d = parseKstLocalInput(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `${label}을(를) 입력하세요.` });
      return z.NEVER;
    }
    return d;
  });

/** 자체행사·시설점검·임시차단 입력 (BR-02, [WF] A-03) */
export const blockInputSchema = z
  .object({
    kind: z.enum(["event", "maintenance", "temporary"], { error: "종류를 고르세요." }),
    spaceId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()),
    startsAt: kstDateTime("시작 시각"),
    endsAt: kstDateTime("종료 시각"),
    reason: z.string().trim().min(1, "사유를 입력하세요.").max(200),
  })
  .refine((v) => v.startsAt < v.endsAt, { path: ["endsAt"], message: "종료 시각은 시작 시각보다 늦어야 합니다." })
  .refine((v) => v.endsAt.getTime() - v.startsAt.getTime() <= 31 * 24 * 3600_000, {
    path: ["endsAt"],
    message: "한 번에 31일까지 차단할 수 있습니다. 더 긴 기간은 휴관 규칙으로 등록하세요.",
  });

export const blockKindLabels = { event: "자체행사", maintenance: "시설점검", temporary: "임시차단" } as const;
