/**
 * 접속자 IP. 운영에서는 앞단 프록시(Caddy)가 X-Forwarded-For에 접속자 IP를 덧붙이므로,
 * 조작될 수 있는 왼쪽 값이 아니라 오른쪽에서 TRUST_PROXY_HOPS(기본 1)번째 값을 쓴다.
 * 프록시 없이 직접 받는 경우(TRUST_PROXY_HOPS=0)에는 X-Forwarded-For를 무시한다.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  if (hops > 0) {
    const chain = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = chain[chain.length - hops];
    if (ip) return ip;
    const real = headers.get("x-real-ip");
    if (real) return real;
  }
  return "unknown";
}
