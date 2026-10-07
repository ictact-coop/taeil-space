import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * 보안 헤더. 결제창(PortOne → 각 PG사)이 외부 스크립트·iframe·폼 전송을 쓰므로
 * script/frame/connect/form-action은 https 출처를 허용한다. 라이브 결제 점검 후 좁힐 수 있다
 * (docs/GO_LIVE_CHECKLIST.md).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https:${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https:${isProd ? "" : " ws:"}`,
  "frame-src https:",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 운영 이미지 빌드(Dockerfile)에서는 타입 검사를 건너뛴다. 같은 검사를 CI가 PR마다 하고(pnpm typecheck),
  // 작은 서버에서 빌드할 때 메모리·시간을 크게 줄인다. 로컬·CI의 pnpm build는 그대로 검사한다.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
  serverExternalPackages: ["@node-rs/argon2"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
