/**
 * 고유번호·사업자등록번호 (계획서 2.5). 둘 다 10자리(XXX-XX-XXXXX).
 * 사업자등록번호는 마지막 자리 검증번호를 확인한다. 고유번호는 같은 체계인지 확인되지 않아 형식만 본다.
 */
export type RegType = "unique_no" | "business_no";

export const regTypeLabels: Record<RegType, string> = {
  unique_no: "고유번호",
  business_no: "사업자등록번호",
};

export function normalizeRegNo(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function formatRegNo(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}

export function isValidBusinessNoChecksum(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += d[i]! * weights[i]!;
  sum += Math.floor((d[8]! * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

export function validateRegNo(type: RegType, raw: string): { ok: true; digits: string } | { ok: false; message: string } {
  const digits = normalizeRegNo(raw);
  if (!/^\d{10}$/.test(digits)) return { ok: false, message: `${regTypeLabels[type]}는 숫자 10자리입니다(예: 123-45-67890).` };
  if (type === "business_no" && !isValidBusinessNoChecksum(digits)) {
    return { ok: false, message: "사업자등록번호가 올바르지 않습니다. 번호를 다시 확인하세요." };
  }
  return { ok: true, digits };
}
