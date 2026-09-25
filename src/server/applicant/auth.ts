import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { applicantOtps, applicantSessions, applications } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { enqueueEmail, flushNotifications } from "@/server/notifications/queue";

/**
 * 나의 대관 본인 확인 ([요구] 3장: 이메일 인증으로 내역 조회). 휴대전화 인증은 문자 발송(단계 5)과 함께 붙인다.
 * 계정 존재 여부가 드러나지 않도록, 신청 내역이 없는 이메일에도 같은 안내를 보여 준다(코드는 보내지 않음).
 */
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const SESSION_HOURS = 24;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type RequestCodeResult = { ok: true } | { ok: false; error: string };

export async function requestLoginCode(db: Db, rawEmail: string, now: Date = new Date()): Promise<RequestCodeResult> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "이메일 형식이 아닙니다." };
  const dest = sha(email);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(applicantOtps)
    .where(and(eq(applicantOtps.destinationHash, dest), gt(applicantOtps.createdAt, new Date(now.getTime() - 3600_000))))) as [{ n: number }];
  if (n >= MAX_CODES_PER_HOUR) return { ok: false, error: "요청이 많습니다. 잠시 후 다시 시도하세요." };
  const [hasApp] = await db.select({ id: applications.id }).from(applications).where(eq(applications.contactEmail, email)).limit(1);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.transaction(async (tx) => {
    await tx.insert(applicantOtps).values({ destinationHash: dest, codeHash: sha(`${dest}:${code}`), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now });
    if (hasApp) {
      await enqueueEmail(
        tx,
        "applicant_otp",
        email,
        "[전태일기념관] 나의 대관 확인 코드",
        `나의 대관 확인 코드: ${code}\n\n10분 안에 입력해 주세요. 요청하지 않았다면 이 메일을 무시하세요.`,
      );
    }
  });
  await flushNotifications(db).catch(() => undefined);
  return { ok: true };
}

export type VerifyCodeResult = { ok: true; token: string; expiresAt: Date } | { ok: false; error: string };

export async function verifyLoginCode(db: Db, rawEmail: string, code: string, now: Date = new Date()): Promise<VerifyCodeResult> {
  const email = normalizeEmail(rawEmail);
  const dest = sha(email);
  return db.transaction(async (tx) => {
    const [otp] = await tx
      .select()
      .from(applicantOtps)
      .where(and(eq(applicantOtps.destinationHash, dest), isNull(applicantOtps.consumedAt), gt(applicantOtps.expiresAt, now)))
      .orderBy(desc(applicantOtps.createdAt))
      .limit(1)
      .for("update");
    const invalid = { ok: false, error: "확인 코드가 올바르지 않거나 만료되었습니다." } as const;
    if (!otp || otp.attempts >= MAX_ATTEMPTS) return invalid;
    const expected = Buffer.from(otp.codeHash);
    const given = Buffer.from(sha(`${dest}:${code.trim()}`));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await tx.update(applicantOtps).set({ attempts: otp.attempts + 1 }).where(eq(applicantOtps.id, otp.id));
      return invalid;
    }
    await tx.update(applicantOtps).set({ consumedAt: now }).where(eq(applicantOtps.id, otp.id));
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
    await tx.insert(applicantSessions).values({ id: sha(token), email, createdAt: now, expiresAt });
    return { ok: true, token, expiresAt } as const;
  });
}

export async function getApplicantEmail(db: DbOrTx, token: string | undefined, now: Date = new Date()): Promise<string | null> {
  if (!token) return null;
  const [row] = await db.select().from(applicantSessions).where(and(eq(applicantSessions.id, sha(token)), gt(applicantSessions.expiresAt, now)));
  return row?.email ?? null;
}

export async function endApplicantSession(db: DbOrTx, token: string | undefined): Promise<void> {
  if (token) await db.delete(applicantSessions).where(eq(applicantSessions.id, sha(token)));
}
