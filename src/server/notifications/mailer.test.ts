import { describe, expect, it } from "vitest";
import { smtpConfigFromEnv } from "./mailer";

describe("SMTP 설정", () => {
  it("SMTP_URL이 있으면 그대로 쓴다", () => {
    expect(smtpConfigFromEnv({ SMTP_URL: "smtps://u:p@smtp.example.com:465", SMTP_HOST: "ignored" })).toBe("smtps://u:p@smtp.example.com:465");
  });

  it("SMTP_HOST 방식: 465는 TLS, 비밀번호의 + / 는 그대로 전달 (AWS SES)", () => {
    expect(
      smtpConfigFromEnv({ SMTP_HOST: "email-smtp.ap-northeast-2.amazonaws.com", SMTP_USER: "AKIAEXAMPLE", SMTP_PASS: "Bx+k/9Qz==" }),
    ).toEqual({ host: "email-smtp.ap-northeast-2.amazonaws.com", port: 465, secure: true, auth: { user: "AKIAEXAMPLE", pass: "Bx+k/9Qz==" } });
  });

  it("587은 STARTTLS, 사용자가 없으면 인증 없이", () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: "relay.local", SMTP_PORT: "587" })).toEqual({ host: "relay.local", port: 587, secure: false });
  });

  it("설정이 없으면 null", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
  });
});
