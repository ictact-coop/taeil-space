import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 신청서 첨부 업로드 토큰. 서버가 발급한 토큰만 받도록 HMAC 서명을 붙인다
 * (아무 문자열로 업로드해 저장 공간을 채우는 일을 막기 위해).
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY 환경변수가 없습니다.");
  return Buffer.from(`upload:${raw}`);
}

const sign = (nonce: string) => createHmac("sha256", key()).update(nonce).digest("base64url").slice(0, 22);

export function issueUploadToken(): string {
  const nonce = randomBytes(18).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

export function isValidUploadToken(token: string): boolean {
  const [nonce, sig] = token.split(".");
  if (!nonce || !sig || nonce.length < 20) return false;
  const expected = Buffer.from(sign(nonce));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
