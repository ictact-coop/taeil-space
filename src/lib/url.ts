/**
 * 처리 결과 메시지를 검색 파라미터로 붙인 주소. 한글 메시지는 반드시 인코딩해야
 * 서버 액션의 redirect 헤더에 넣을 수 있다.
 */
export function withNotice(path: string, notice: { done: string } | { error: string }): string {
  return `${path}?${new URLSearchParams(notice).toString()}`;
}
