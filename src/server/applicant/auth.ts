import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { applicantOtps, applicantSessions, applications } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { writeAudit } from "@/server/audit/log";
import { enqueueEmail, flushNotifications } from "@/server/notifications/queue";

/**
 * 나의 대관 본인 확인. 주로 전화번호 + 신청할 때 정한 비밀번호(2026-10 결정), 또는 이메일 확인 코드([요구] 3장).
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
    await tx.insert(applicantSessions).values({ id: sha(token), email, label: email, createdAt: now, expiresAt });
    return { ok: true, token, expiresAt } as const;
  });
}

/** 나의 대관 로그인 주체: 이메일(그 이메일의 신청 전체) 또는 전화번호·비밀번호로 확인한 신청 목록 */
export interface ApplicantPrincipal {
  email: string | null;
  applicationIds: string[] | null;
  label: string;
}

export async function getApplicantPrincipal(db: DbOrTx, token: string | undefined, now: Date = new Date()): Promise<ApplicantPrincipal | null> {
  if (!token) return null;
  const [row] = await db.select().from(applicantSessions).where(and(eq(applicantSessions.id, sha(token)), gt(applicantSessions.expiresAt, now)));
  if (!row || (!row.email && !row.applicationIds?.length)) return null;
  return { email: row.email, applicationIds: row.applicationIds, label: row.label || row.email || "" };
}

export const normalizePhone = (raw: string) => raw.replace(/[\s-]/g, "");
const maskPhone = (digits: string) => digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, (_, a: string, b: string, c: string) => `${a}-${"*".repeat(b.length)}-${c}`);

export const MIN_APPLICANT_PASSWORD = 4;
export const MAX_APPLICANT_PASSWORD = 50;

export type PhoneLoginResult = { ok: true; token: string; expiresAt: Date } | { ok: false; error: string };

/**
 * 전화번호 + 신청할 때 정한 비밀번호로 확인. 그 전화번호로 된 신청 중 비밀번호가 맞는 신청만 볼 수 있다.
 * 맞는 신청이 없으면 전화번호가 없는지 비밀번호가 틀렸는지 구분하지 않고 같은 안내를 한다.
 */
export async function loginWithPhone(db: Db, rawPhone: string, password: string, now: Date = new Date()): Promise<PhoneLoginResult> {
  const phone = normalizePhone(rawPhone);
  const invalid = { ok: false, error: "전화번호 또는 비밀번호가 맞지 않습니다." } as const;
  if (!/^0\d{8,10}$/.test(phone) || !password) return invalid;
  const rows = await db
    .select({ id: applications.id, hash: applications.applicantPasswordHash })
    .from(applications)
    .where(eq(applications.contactPhone, phone));
  const matched: string[] = [];
  for (const r of rows.slice(0, 200)) {
    if (r.hash && (await verifyPassword(r.hash, password))) matched.push(r.id);
  }
  if (rows.length === 0) await burnPasswordCheck(password);
  if (matched.length === 0) return invalid;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  await db.insert(applicantSessions).values({ id: sha(token), email: null, applicationIds: matched, label: maskPhone(phone), createdAt: now, expiresAt });
  return { ok: true, token, expiresAt };
}

/** 신청서의 나의 대관 비밀번호 확인·해시 */
export function validateApplicantPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_APPLICANT_PASSWORD) return `비밀번호는 ${MIN_APPLICANT_PASSWORD}자 이상으로 정하세요.`;
  if (password.length > MAX_APPLICANT_PASSWORD) return `비밀번호는 ${MAX_APPLICANT_PASSWORD}자 이하로 정하세요.`;
  if (password !== confirm) return "비밀번호 확인이 일치하지 않습니다.";
  return null;
}
export { hashPassword as hashApplicantPassword } from "@/server/auth/password";

export type ChangePasswordResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * 로그인한 신청자가 나의 대관 비밀번호를 바꾼다. 지금 볼 수 있는 신청 모두에 같은 비밀번호를 정한다.
 * 비밀번호를 잊은 경우: 이메일 확인 코드로 들어와서 여기서 새로 정한다(재설정). 이메일로 받을 수 없으면 관리자가 정해 준다.
 */
export async function changeApplicantPassword(
  db: Db,
  principal: ApplicantPrincipal,
  password: string,
  confirm: string,
  ip: string | null = null,
): Promise<ChangePasswordResult> {
  const error = validateApplicantPassword(password, confirm);
  if (error) return { ok: false, error };
  const conds = [
    principal.email ? eq(applications.contactEmail, principal.email) : undefined,
    principal.applicationIds?.length ? inArray(applications.id, principal.applicationIds) : undefined,
  ].filter((c) => c !== undefined);
  if (conds.length === 0) return { ok: false, error: "다시 로그인해 주세요." };
  const hash = await hashPassword(password);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(applications)
      .set({ applicantPasswordHash: hash })
      .where(or(...conds))
      .returning({ id: applications.id });
    for (const r of rows) {
      await writeAudit(tx, {
        actorType: "applicant",
        actorId: principal.email ?? principal.label,
        action: "application.applicant_password_changed",
        targetType: "application",
        targetId: r.id,
        ip,
      });
    }
    return rows.length;
  });
  if (updated === 0) return { ok: false, error: "비밀번호를 바꿀 신청이 없습니다." };
  return { ok: true, count: updated };
}

export async function endApplicantSession(db: DbOrTx, token: string | undefined): Promise<void> {
  if (token) await db.delete(applicantSessions).where(eq(applicantSessions.id, sha(token)));
}
