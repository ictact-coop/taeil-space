import type { FeeOption, SpaceFee } from "./fee-schedule";

/**
 * 요금 계산 ([요구] 16장): 기본요금 + 추가시간 요금 + 야간요금 + 옵션 − 감면 = 결제금액
 * - 추가시간: 기본시간을 넘는 시간을 추가 단위로 올림
 * - 야간: 주간 종료 시각 이후 시간에 시간당 요금(분 단위 비례, 원 단위 반올림)
 * - 옵션: 1회 요금 또는 시간당 요금(분 단위 비례)
 * - 감면: 비율은 원 단위 내림, 금액은 소계를 넘지 않음
 */
export interface PriceItem {
  kind: "base" | "extra" | "night" | "option" | "discount";
  label: string;
  amount: number;
}

export interface PriceQuote {
  items: PriceItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  durationMinutes: number;
  nightMinutes: number;
}

export interface DiscountForPrice {
  name: string;
  kind: "percent" | "amount";
  value: number;
}

export function calculatePrice(params: {
  fee: SpaceFee;
  startMinutes: number;
  endMinutes: number;
  dayEndMinutes: number;
  options?: readonly FeeOption[];
  selectedOptionKeys?: readonly string[];
  discount?: DiscountForPrice | null;
}): PriceQuote {
  const { fee, startMinutes, endMinutes, dayEndMinutes } = params;
  const duration = endMinutes - startMinutes;
  if (duration <= 0) throw new Error("종료 시각은 시작 시각보다 늦어야 합니다.");
  const items: PriceItem[] = [{ kind: "base", label: `기본 대관료(${Math.round(fee.baseMinutes / 6) / 10}시간)`, amount: fee.baseFee }];

  const over = Math.max(0, duration - fee.baseMinutes);
  if (over > 0) {
    const units = Math.ceil(over / fee.extraUnitMinutes);
    items.push({ kind: "extra", label: `추가 시간(${units}×${fee.extraUnitMinutes}분)`, amount: units * fee.extraFee });
  }

  const nightMinutes = Math.max(0, endMinutes - Math.max(startMinutes, dayEndMinutes));
  if (nightMinutes > 0) {
    items.push({ kind: "night", label: `야간(${nightMinutes}분)`, amount: Math.round((fee.nightFeePerHour * nightMinutes) / 60) });
  }

  const selected = new Set(params.selectedOptionKeys ?? []);
  for (const option of params.options ?? []) {
    if (!selected.has(option.key)) continue;
    const amount = option.unit === "per_booking" ? option.fee : Math.round((option.fee * duration) / 60);
    items.push({ kind: "option", label: option.name, amount });
  }

  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  let discountAmount = 0;
  if (params.discount) {
    discountAmount =
      params.discount.kind === "percent" ? Math.floor((subtotal * params.discount.value) / 100) : Math.min(params.discount.value, subtotal);
    if (discountAmount > 0) items.push({ kind: "discount", label: `감면: ${params.discount.name}`, amount: -discountAmount });
  }
  return { items, subtotal, discountAmount, total: subtotal - discountAmount, durationMinutes: duration, nightMinutes };
}
