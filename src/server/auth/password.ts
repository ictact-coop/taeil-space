import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "비밀번호에 영문과 숫자를 함께 넣어야 합니다.";
  return null;
}

/** argon2id (라이브러리 기본값) */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 존재하지 않는 계정도 비슷한 시간이 걸리게 해서 계정 존재 여부가 드러나지 않게 한다. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("dummy-password-for-timing-0000");
  await verifyPassword(await dummyHash, password);
}
