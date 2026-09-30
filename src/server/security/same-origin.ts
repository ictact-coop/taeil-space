/**
 * 쿠키 인증을 쓰는 route handler의 CSRF 방어. 브라우저가 붙이는 Origin이 이 사이트와 다르면 거부한다.
 * (서버 액션은 Next.js가 자체 검사한다.)
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
