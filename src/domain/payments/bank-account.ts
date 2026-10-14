/**
 * 입금 계좌 안내 문구(자유 입력)에서 계좌번호를 찾는다. 복사 버튼에 쓴다.
 * 숫자와 하이픈으로 된 덩어리 중 숫자가 8자리 이상인 첫 번째를 고른다(전화번호 02-318-0903처럼 짧은 것은 건너뜀).
 * 휴대전화 번호 모양(010-…)은 다른 후보가 없을 때만 고른다(휴대전화 번호를 계좌번호로 쓰는 은행도 있다).
 */
export function extractAccountNumber(text: string): string | null {
  let phoneLike: string | null = null;
  for (const m of text.matchAll(/\d[\d\- ]{5,}\d/g)) {
    const candidate = m[0].trim().replace(/\s+/g, "");
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 10 || (digits.length >= 8 && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(candidate))) {
      if (/^01\d-?\d{3,4}-?\d{4}$/.test(candidate)) {
        phoneLike ??= candidate;
        continue;
      }
      return candidate;
    }
  }
  return phoneLike;
}
