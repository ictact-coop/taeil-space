import { generateSecret, generateURI, verify } from "otplib";

const PERIOD_SECONDS = 30;
/** 앞뒤 30초(1단계)까지 허용 */
const TOLERANCE_SECONDS = 30;
export const TOTP_ISSUER = "전태일기념관 대관관리";

export function createTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, label: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label, secret });
}

/**
 * TOTP 코드 확인. 같은 코드(같은 시간 단계)를 두 번 쓰지 못하게 lastStep보다 큰 단계만 받는다.
 * 성공하면 사용한 시간 단계를 돌려주고, 호출한 쪽에서 저장한다.
 */
export async function verifyTotp(
  secret: string,
  token: string,
  lastStep: number | null,
  now: Date = new Date(),
): Promise<{ ok: true; step: number } | { ok: false }> {
  const code = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const epoch = Math.floor(now.getTime() / 1000);
  const result = await verify({ secret, token: code, epochTolerance: TOLERANCE_SECONDS, epoch });
  if (!result.valid) return { ok: false };
  const step =
    "timeStep" in result && typeof result.timeStep === "number"
      ? result.timeStep
      : Math.floor(epoch / PERIOD_SECONDS) + ("delta" in result ? result.delta : 0);
  if (lastStep !== null && step <= lastStep) return { ok: false };
  return { ok: true, step };
}
