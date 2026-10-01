/**
 * 관리자 계정 생성 (첫 시스템 관리자를 만들 때). 그 뒤로는 관리 화면의 '계정 관리'를 쓴다.
 *   pnpm admin:create --login admin --name "홍길동" --grade super
 * --grade는 기본 등급 코드(super: 시스템 최고 관리자, staff: 기념관 내부 임직원, club: 동아리 운영자). 기본값 super.
 * 비밀번호는 ADMIN_PASSWORD 환경변수로 주거나, 없으면 임의로 만들어 한 번만 출력한다.
 * 첫 로그인 때 2단계 인증 등록을 요구한다.
 */
import { parseArgs } from "node:util";
import { createAdminAccount } from "../src/server/auth/accounts";
import { findGradeByCode } from "../src/server/auth/grades";
import { createDb } from "../src/server/db/connect";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    name: { type: "string" },
    grade: { type: "string", default: "super" },
  },
});

if (!values.login || !values.name) {
  console.error("사용법: pnpm admin:create --login <아이디> --name <이름> [--grade super|staff|club]");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  const grade = await findGradeByCode(db, values.grade ?? "super");
  if (!grade) throw new Error(`등급 코드가 없습니다: ${values.grade} (super, staff, club 중 하나)`);
  const r = await createAdminAccount(db, { actor: null, raw: { loginId: values.login, name: values.name, gradeId: grade.id }, password: process.env.ADMIN_PASSWORD });
  if (!r.ok) {
    console.error(r.formError ?? Object.values(r.fieldErrors ?? {}).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`관리자 계정을 만들었습니다: ${r.value.loginId} (${grade.name})`);
    if (r.value.temporaryPassword) console.log(`임시 비밀번호: ${r.value.temporaryPassword}\n(지금 한 번만 표시됩니다. 안전한 곳에 옮겨 두세요.)`);
  }
} finally {
  await pool.end();
}
