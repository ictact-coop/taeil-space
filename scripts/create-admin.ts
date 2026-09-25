/**
 * 관리자 계정 생성.
 *   pnpm admin:create --login admin --name "홍길동" --role system
 * 비밀번호는 ADMIN_PASSWORD 환경변수로 주거나, 없으면 임의로 만들어 한 번만 출력한다.
 * 첫 로그인 때 2단계 인증 등록을 요구한다.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { writeAudit } from "../src/server/audit/log";
import { hashPassword, validatePasswordPolicy } from "../src/server/auth/password";
import { createDb } from "../src/server/db/connect";
import { adminUsers } from "../src/server/db/schema";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "system" },
  },
});

const roles = ["rental", "accounting", "system"] as const;
type Role = (typeof roles)[number];

if (!values.login || !values.name || !roles.includes(values.role as Role)) {
  console.error('사용법: pnpm admin:create --login <아이디> --name <이름> --role <rental|accounting|system>');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD ?? `${randomBytes(12).toString("base64url")}9a`;
const policyError = validatePasswordPolicy(password);
if (policyError) {
  console.error(policyError);
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  const [created] = await db
    .insert(adminUsers)
    .values({ loginId: values.login, name: values.name, role: values.role as Role, passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id });
  await writeAudit(db, {
    actorType: "system",
    action: "admin.created",
    targetType: "admin_user",
    targetId: created!.id,
    after: { loginId: values.login, name: values.name, role: values.role },
    reason: "create-admin 스크립트",
  });
  console.log(`관리자 계정을 만들었습니다: ${values.login} (${values.role})`);
  if (generated) console.log(`임시 비밀번호: ${password}\n(지금 한 번만 표시됩니다. 안전한 곳에 옮겨 두세요.)`);
} finally {
  await pool.end();
}
