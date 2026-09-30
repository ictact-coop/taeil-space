/**
 * 관리자 계정 관리 (서버에서 실행). 평소에는 관리 화면(계정 관리)을 쓰고,
 * 시스템 관리자가 모두 로그인할 수 없을 때 이 명령으로 복구한다.
 *   pnpm admin:manage list
 *   pnpm admin:manage reset-2fa --login <아이디>        OTP 기기 분실 → 다음 로그인 때 다시 등록
 *   pnpm admin:manage reset-password --login <아이디>   임시 비밀번호 발급(ADMIN_PASSWORD로 지정 가능), 잠금 해제
 *   pnpm admin:manage deactivate --login <아이디>       퇴사·담당 변경 → 로그인 차단
 *   pnpm admin:manage activate --login <아이디>
 * 모든 변경은 감사 로그에 남고, 해당 계정의 기존 로그인 세션은 끊긴다.
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { type AccountAction, applyAccountAction, listAdminAccounts } from "../src/server/auth/accounts";
import { createDb } from "../src/server/db/connect";
import { adminUsers } from "../src/server/db/schema";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { login: { type: "string" } } });
const command = positionals[0];
const actions: AccountAction[] = ["reset-2fa", "reset-password", "deactivate", "activate"];
if (!command || (command !== "list" && (!actions.includes(command as AccountAction) || !values.login))) {
  console.error(`사용법: pnpm admin:manage <list|${actions.join("|")}> [--login <아이디>]`);
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
    const now = new Date();
    for (const u of await listAdminAccounts(db)) {
      const flags = [u.isActive ? "사용" : "중지", u.totpEnabledAt ? "OTP 등록" : "OTP 미등록", u.lockedUntil && u.lockedUntil > now ? "잠김" : ""].filter(Boolean);
      console.log(`${u.loginId}\t${u.name}\t${u.role}\t${flags.join(", ")}`);
    }
  } else {
    const [user] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.loginId, values.login!));
    if (!user) throw new Error(`계정이 없습니다: ${values.login}`);
    const r = await applyAccountAction(db, { actor: null, userId: user.id, action: command as AccountAction, password: process.env.ADMIN_PASSWORD });
    if (!r.ok) throw new Error(r.formError ?? "처리하지 못했습니다.");
    console.log(`${command} 완료: ${r.value.loginId}`);
    if (r.value.temporaryPassword) console.log(`임시 비밀번호: ${r.value.temporaryPassword}\n(지금 한 번만 표시됩니다.)`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
