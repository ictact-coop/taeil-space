import { afterEach, describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";
import { isSameOrigin } from "./same-origin";
import { isValidUploadToken, issueUploadToken } from "./upload-token";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("접속자 IP", () => {
  afterEach(() => delete process.env.TRUST_PROXY_HOPS);

  it("프록시 1단: 오른쪽 끝 값을 쓴다 (왼쪽은 조작 가능)", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
  });
  it("프록시 2단 설정", () => {
    process.env.TRUST_PROXY_HOPS = "2";
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }))).toBe("203.0.113.7");
  });
  it("프록시 없음(0)이면 헤더를 믿지 않는다", () => {
    process.env.TRUST_PROXY_HOPS = "0";
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6" }))).toBe("unknown");
  });
  it("헤더가 없으면 x-real-ip, 그것도 없으면 unknown", () => {
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIpFrom(h({}))).toBe("unknown");
  });
});

describe("업로드 토큰", () => {
  it("서버가 발급한 토큰만 통과", () => {
    const t = issueUploadToken();
    expect(isValidUploadToken(t)).toBe(true);
    expect(isValidUploadToken(`${t.split(".")[0]}.AAAAAAAAAAAAAAAAAAAAAA`)).toBe(false);
    expect(isValidUploadToken("abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isValidUploadToken("")).toBe(false);
  });
});

describe("같은 출처 검사", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/admin/api", { method: "POST", headers });
  it("Origin이 같은 호스트면 허용", () => {
    expect(isSameOrigin(req({ origin: "https://rent.example.kr", host: "rent.example.kr" }))).toBe(true);
  });
  it("다른 사이트면 거부", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "rent.example.kr" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site", host: "rent.example.kr" }))).toBe(false);
  });
  it("Origin이 없는 비브라우저 요청은 허용 (쿠키가 없으면 어차피 인증 실패)", () => {
    expect(isSameOrigin(req({ host: "rent.example.kr" }))).toBe(true);
  });
});
