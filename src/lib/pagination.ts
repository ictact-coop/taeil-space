/** 1 … 4 5 [6] 7 8 … 20 모양의 페이지 번호(null은 생략 표시) */
export function pageNumbers(current: number, count: number): (number | null)[] {
  const keep = new Set([1, count, current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push(n - sorted[i - 1]! === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}
