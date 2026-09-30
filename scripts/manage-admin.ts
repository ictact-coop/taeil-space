/**
 * 관리자 계정 관리 (서버에서 실행). 관리 화면이 생기기 전까지 이 스크립트로 처리한다.
 *   pnpm admin:manage list
 *   pnpm admin:manage reset-2fa --login <아이디>        OTP 기기 분실 → 다음 로그인 때 다시 등록
 *   pnpm admin:manage reset-password --login <아이디>   임시 비밀번호 발급(ADMIN_PASSWORD로 지정 가능), 잠금 해제
 *   pnpm admin:manage deactivate --login <아이디>       퇴사·담당 변경 → 로그인 차단
 *   pnpm admin:manage activate --login <아이디>
 * 모든 변경은 감사 로그에 남고, 해당 계정의 기존 로그인 세션은 끊긴다.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { writeAudit } from "../src/server/audit/log";
import { hashPassword, validatePasswordPolicy } from "../src/server/auth/password";
import { createDb } from "../src/server/db/connect";
import { adminSessions, adminUsers } from "../src/server/db/schema";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { login: { type: "string" } } });
const command = positionals[0];
const commands = ["list", "reset-2fa", "reset-password", "deactivate", "activate"];
if (!command || !commands.includes(command) || (command !== "list" && !values.login)) {
  console.error(`사용법: pnpm admin:manage <${commands.join("|")}> [--login <아이디>]`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  if (command === "list") {
    const rows = await db.select().from(adminUsers).orderBy(adminUsers.loginId);
    for (const u of rows) {
      const flags = [u.isActive ? "사용" : "중지", u.totpEnabledAt ? "OTP 등록" : "OTP 미등록", u.lockedUntil && u.lockedUntil > new Date() ? "잠김" : ""].filter(Boolean);
      console.log(`${u.loginId}\t${u.name}\t${u.role}\t${flags.join(", ")}`);
    }
  } else {
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.loginId, values.login!));
    if (!user) throw new Error(`계정이 없습니다: ${values.login}`);
    let password: string | null = null;
    const changes: Partial<typeof adminUsers.$inferInsert> = { updatedAt: new Date() };
    if (command === "reset-2fa") Object.assign(changes, { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, failedLoginCount: 0, lockedUntil: null });
    if (command === "reset-password") {
      password = process.env.ADMIN_PASSWORD ?? `${randomBytes(12).toString("base64url")}9a`;
      const policyError = validatePasswordPolicy(password);
      if (policyError) throw new Error(policyError);
      Object.assign(changes, { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null });
    }
    if (command === "deactivate") changes.isActive = false;
    if (command === "activate") Object.assign(changes, { isActive: true, failedLoginCount: 0, lockedUntil: null });

    await db.transaction(async (tx) => {
      await tx.update(adminUsers).set(changes).where(eq(adminUsers.id, user.id));
      await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, user.id));
      await writeAudit(tx, { actorType: "system", action: `admin.${command}`, targetType: "admin_user", targetId: user.id, reason: "manage-admin 스크립트" });
    });
    console.log(`${command} 완료: ${user.loginId} (${user.name})`);
    if (password && !process.env.ADMIN_PASSWORD) console.log(`임시 비밀번호: ${password}\n(지금 한 번만 표시됩니다.)`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
