import { generate } from "otplib";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./encryption";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password";
import { createTotpSecret, verifyTotp } from "./totp";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("비밀값 암호화", () => {
  it("암호화한 값을 복호화하면 원문이 나온다", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("같은 값도 매번 다른 암호문이 된다", () => {
    expect(encryptSecret("a")).not.toBe(encryptSecret("a"));
  });
  it("변조된 암호문은 복호화되지 않는다", () => {
    const [v, iv, tag, data] = encryptSecret("secret").split(".");
    const tampered = [v, iv, tag, `${data!.slice(0, -2)}AA`].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("비밀번호", () => {
  it("정책: 12자 이상, 영문+숫자", () => {
    expect(validatePasswordPolicy("short1")).not.toBeNull();
    expect(validatePasswordPolicy("onlyletterslong")).not.toBeNull();
    expect(validatePasswordPolicy("letters1234567")).toBeNull();
  });
  it("해시와 확인", async () => {
    const h = await hashPassword("correct-horse-1");
    expect(await verifyPassword(h, "correct-horse-1")).toBe(true);
    expect(await verifyPassword(h, "wrong-horse-1")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("TOTP", () => {
  const now = new Date("2026-10-01T00:00:15Z");
  const epoch = Math.floor(now.getTime() / 1000);

  it("올바른 코드는 통과하고 사용한 시간 단계를 돌려준다", async () => {
    const secret = createTotpSecret();
    const token = await generate({ secret, epoch });
    const result = await verifyTotp(secret, token, null, now);
    expect(result).toEqual({ ok: true, step: Math.floor(epoch / 30) });
  });

  it("같은 코드를 다시 쓰면 거부한다", async () => {
    const secret = createTotpSecret();
    const token = await generate({ secret, epoch });
    const first = await verifyTotp(secret, token, null, now);
    if (!first.ok) throw new Error("first should pass");
    expect(await verifyTotp(secret, token, first.step, now)).toEqual({ ok: false });
  });

  it("30초 전 코드까지는 허용, 그 이전은 거부", async () => {
    const secret = createTotpSecret();
    expect((await verifyTotp(secret, await generate({ secret, epoch: epoch - 30 }), null, now)).ok).toBe(true);
    expect((await verifyTotp(secret, await generate({ secret, epoch: epoch - 90 }), null, now)).ok).toBe(false);
  });

  it("형식이 틀린 코드는 거부", async () => {
    expect(await verifyTotp(createTotpSecret(), "12ab56", null, now)).toEqual({ ok: false });
  });
});
