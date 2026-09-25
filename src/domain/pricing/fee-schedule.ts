import { z } from "zod";

/**
 * 요금표 한 버전의 내용 ([요구] 16장, P-01, [WF] A-04).
 * 공간별: 기본시간·기본요금, 추가 단위시간·추가요금, 야간 시간당 요금
 * 부대시설/옵션: 이름·금액·부과 단위
 * 금액은 원(정수). 계산식은 단계 2 요금 계산에서 사용한다.
 */
const won = (label: string) =>
  z.number({ error: `${label}을(를) 입력하세요.` }).int(`${label}은(는) 원 단위 정수여야 합니다.`).min(0, `${label}은(는) 0원 이상이어야 합니다.`).max(10_000_000);

export const spaceFeeSchema = z
  .object({
    baseMinutes: z.number().int().min(30, "기본시간은 30분 이상이어야 합니다.").max(720),
    baseFee: won("기본요금"),
    extraUnitMinutes: z.number().int().min(15, "추가 단위시간은 15분 이상이어야 합니다.").max(240),
    extraFee: won("추가요금"),
    nightFeePerHour: won("야간 시간당 요금"),
  })
  .refine((f) => f.baseMinutes % 15 === 0 && f.extraUnitMinutes % 15 === 0, "시간은 15분 단위로 입력하세요.");

export const feeOptionSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,30}$/),
  name: z.string().trim().min(1, "옵션 이름을 입력하세요.").max(40),
  fee: won("옵션 금액"),
  unit: z.enum(["per_booking", "per_hour"]),
});

export const feeScheduleItemsSchema = z.object({
  /** 공간 id → 요금 */
  spaces: z.record(z.string().uuid(), spaceFeeSchema),
  options: z.array(feeOptionSchema).max(20),
});

export type SpaceFee = z.infer<typeof spaceFeeSchema>;
export type FeeOption = z.infer<typeof feeOptionSchema>;
export type FeeScheduleItems = z.infer<typeof feeScheduleItemsSchema>;

export const feeOptionUnitLabels: Record<FeeOption["unit"], string> = {
  per_booking: "1회",
  per_hour: "시간당",
};

export function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
