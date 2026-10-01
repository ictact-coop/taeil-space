import { z } from "zod";

/**
 * 확정 후 취소 시점별 환불률표 (P-06).
 * "이용일 daysBefore일 전까지 취소하면 percent% 환불". 남은 일수가 가장 큰 구간부터 본다.
 * 어느 구간에도 들지 않으면 0%.
 */
export interface RefundTier {
  daysBefore: number;
  percent: number;
}

export const refundTiersSchema = z
  .array(
    z.object({
      daysBefore: z.number().int("일수는 정수여야 합니다.").min(0, "일수는 0 이상이어야 합니다.").max(365, "일수는 365 이하여야 합니다."),
      percent: z.number().int("환불률은 정수여야 합니다.").min(0, "환불률은 0% 이상이어야 합니다.").max(100, "환불률은 100% 이하여야 합니다."),
    }),
  )
  .max(10, "구간은 10개까지 둘 수 있습니다.")
  .superRefine((tiers, ctx) => {
    const days = tiers.map((t) => t.daysBefore);
    if (new Set(days).size !== days.length) {
      ctx.addIssue({ code: "custom", message: "같은 일수의 구간이 두 번 있습니다." });
      return;
    }
    const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]!.percent > sorted[i - 1]!.percent) {
        ctx.addIssue({
          code: "custom",
          message: `이용일이 가까울수록 환불률이 같거나 낮아야 합니다(${sorted[i]!.daysBefore}일 전 ${sorted[i]!.percent}% > ${sorted[i - 1]!.daysBefore}일 전 ${sorted[i - 1]!.percent}%).`,
        });
        return;
      }
    }
  })
  .transform((tiers) => [...tiers].sort((a, b) => b.daysBefore - a.daysBefore));

/** 이용일까지 남은 일수에 적용할 환불률 */
export function refundPercentFor(daysRemaining: number, tiers: readonly RefundTier[]): number {
  const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  return sorted.find((t) => daysRemaining >= t.daysBefore)?.percent ?? 0;
}

export function describeRefundTiers(tiers: readonly RefundTier[]): string {
  if (tiers.length === 0) return "(미입력)";
  return tiers.map((t) => (t.daysBefore === 0 ? `당일 ${t.percent}%` : `${t.daysBefore}일 전까지 ${t.percent}%`)).join(" · ");
}
