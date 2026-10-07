/**
 * 입금 계좌 안내 문구(자유 입력)에서 계좌번호를 찾는다. 복사 버튼에 쓴다.
 * 숫자와 하이픈으로 된 덩어리 중 숫자가 8자리 이상인 첫 번째를 고른다(전화번호 02-318-0903처럼 짧은 것은 건너뜀).
 */
export function extractAccountNumber(text: string): string | null {
  for (const m of text.matchAll(/\d[\d\- ]{5,}\d/g)) {
    const candidate = m[0].trim().replace(/\s+/g, "");
    if (candidate.replace(/\D/g, "").length >= 10 || (candidate.replace(/\D/g, "").length >= 8 && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(candidate))) {
      return candidate;
    }
  }
  return null;
}
