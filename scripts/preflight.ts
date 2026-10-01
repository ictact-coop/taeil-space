/**
 * 배포 전·후 점검. 서버에서 운영 이미지로 실행한다.
 *   docker compose ... run --rm web pnpm preflight          # 환경·DB·저장소·오픈 준비 항목
 *   docker compose ... run --rm web pnpm preflight --smtp   # + SMTP 접속 확인
 * 오류(✗)가 하나라도 있으면 종료 코드 1. 경고(!)는 오픈 전에 정리할 일이다.
 * 비밀 값은 출력하지 않는다.
 */
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { createDb } from "../src/server/db/connect";
import { smtpConfigFromEnv } from "../src/server/notifications/mailer";
import { adminGrades, adminUsers } from "../src/server/db/schema";
import { getSettings } from "../src/server/settings/service";
import { computeReadiness } from "../src/server/settings/readiness";

const { values: args } = parseArgs({ options: { smtp: { type: "boolean", default: false } } });
const prod = process.env.NODE_ENV === "production";
let errors = 0;
let warnings = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => (warnings++, console.log(`  ! ${m}`));
const fail = (m: string) => (errors++, console.log(`  ✗ ${m}`));
const section = (m: string) => console.log(`\n[${m}]`);
const env = (k: string) => (process.env[k] ?? "").trim();

section("환경변수");
if (!env("DATABASE_URL")) fail("DATABASE_URL이 없습니다.");
else ok("DATABASE_URL 설정됨");
const key = env("APP_ENCRYPTION_KEY");
if (!key) fail("APP_ENCRYPTION_KEY가 없습니다. openssl rand -base64 32 로 만들고 따로 보관하세요.");
else if (Buffer.from(key, "base64").length !== 32) fail("APP_ENCRYPTION_KEY는 32바이트를 base64로 인코딩한 값이어야 합니다.");
else ok("APP_ENCRYPTION_KEY 형식 정상 (값은 출력하지 않음)");
const base = env("APP_BASE_URL");
if (!base) fail("APP_BASE_URL이 없습니다(메일 링크에 쓰임).");
else if (prod && !base.startsWith("https://")) fail(`APP_BASE_URL이 https가 아닙니다: ${base}`);
else ok(`APP_BASE_URL = ${base}`);
if (env("SITE_DOMAIN") && base && !base.includes(env("SITE_DOMAIN"))) warn(`APP_BASE_URL(${base})과 SITE_DOMAIN(${env("SITE_DOMAIN")})이 다릅니다.`);
const provider = env("EMAIL_PROVIDER") || "log";
if (provider === "smtp") {
  const smtp = smtpConfigFromEnv();
  if (!smtp || !env("EMAIL_FROM")) fail("EMAIL_PROVIDER=smtp인데 SMTP_HOST(또는 SMTP_URL)나 EMAIL_FROM이 없습니다.");
  else ok(`메일: SMTP ${typeof smtp === "string" ? "(SMTP_URL)" : `${smtp.host}:${smtp.port}${smtp.auth ? `, 사용자 ${smtp.auth.user}` : ""}`}, 발신 ${env("EMAIL_FROM")}`);
} else if (prod) fail(`EMAIL_PROVIDER=${provider}: 운영에서는 메일이 실제로 나가지 않습니다. smtp로 설정하세요.`);
else warn(`EMAIL_PROVIDER=${provider} (개발용)`);
if (env("PAYMENT_FAKE") === "1") (prod ? fail : warn)("PAYMENT_FAKE=1: 가짜 결제가 켜져 있습니다. 운영에서는 비워 두세요.");
const portone = ["PORTONE_STORE_ID", "PORTONE_CHANNEL_KEY", "PORTONE_API_SECRET", "PORTONE_WEBHOOK_SECRET"].filter((k) => env(k));
if (portone.length === 0) ok("PG 키 없음 → 계좌이체로 운영");
else if (portone.length < 4) warn(`PortOne 키가 일부만 있습니다(${portone.join(", ")}). 4개를 모두 넣거나 모두 비우세요.`);
else ok("PortOne 키 4개 설정됨 (결제 방식을 PG로 바꿀 수 있음)");
ok(`TRUST_PROXY_HOPS = ${env("TRUST_PROXY_HOPS") || "1(기본)"}`);

section("파일 저장소");
const storageDir = env("STORAGE_DIR") || path.join(process.cwd(), ".data", "uploads");
try {
  await mkdir(storageDir, { recursive: true });
  const probe = path.join(storageDir, `.preflight-${process.pid}`);
  await writeFile(probe, "ok");
  await access(probe);
  await rm(probe);
  ok(`쓰기 가능: ${storageDir}`);
} catch (e) {
  fail(`저장소에 쓸 수 없습니다(${storageDir}): ${e instanceof Error ? e.message : e}`);
}
if (env("CLAMAV_HOST")) {
  const port = Number(env("CLAMAV_PORT") || 3310);
  const pong = await new Promise<string>((resolve) => {
    const s = net.connect({ host: env("CLAMAV_HOST"), port, timeout: 3000 }, () => s.write("zPING\0"));
    s.on("data", (d) => (resolve(d.toString().replace(/\0/g, "").trim()), s.destroy()));
    s.on("error", (e) => resolve(`오류: ${e.message}`));
    s.on("timeout", () => (resolve("시간 초과"), s.destroy()));
  });
  (pong === "PONG" ? ok : warn)(`악성코드 검사(clamd ${env("CLAMAV_HOST")}:${port}): ${pong}`);
} else warn("CLAMAV_HOST 없음: 첨부파일은 '검사 안 됨'으로 기록됩니다(담당자가 PC 백신으로 확인).");

if (env("DATABASE_URL")) {
  section("데이터베이스");
  const { db, pool } = createDb(env("DATABASE_URL"));
  try {
    const version = (await db.execute(sql`show server_version`)).rows[0] as { server_version: string };
    const major = Number(version.server_version.split(".")[0]);
    (major >= 16 ? ok : warn)(`PostgreSQL ${version.server_version}${major >= 16 ? "" : " (16 이상 권장)"}`);
    const ext = await db.execute(sql`select 1 from pg_extension where extname = 'btree_gist'`);
    if (ext.rows.length === 0) fail("btree_gist 확장이 없습니다(이중 예약 방지에 필요). 마이그레이션을 먼저 실행하세요. 관리형 DB라면 확장 허용 여부를 확인하세요.");
    else ok("btree_gist 확장 설치됨");

    const journal = (await import("../drizzle/meta/_journal.json", { with: { type: "json" } })).default as { entries: { tag: string }[] };
    const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ rows: [{ n: 0 }] }));
    const n = (applied.rows[0] as { n: number }).n;
    if (n < journal.entries.length) fail(`적용되지 않은 마이그레이션이 ${journal.entries.length - n}개 있습니다. pnpm db:migrate를 실행하세요.`);
    else ok(`마이그레이션 최신 (${n}/${journal.entries.length})`);

    if (n >= journal.entries.length) {
      const [supers] = await db
        .select({ n: count() })
        .from(adminUsers)
        .innerJoin(adminGrades, eq(adminGrades.id, adminUsers.gradeId))
        .where(and(eq(adminGrades.isSuper, true), eq(adminUsers.isActive, true)));
      const [enrolled] = await db
        .select({ n: count() })
        .from(adminUsers)
        .innerJoin(adminGrades, eq(adminGrades.id, adminUsers.gradeId))
        .where(and(eq(adminGrades.isSuper, true), eq(adminUsers.isActive, true), isNotNull(adminUsers.totpEnabledAt)));
      if ((supers?.n ?? 0) === 0) fail("사용 중인 최고 관리자가 없습니다. pnpm admin:create --login ... --name ... --grade super");
      else if ((supers?.n ?? 0) < 2) warn(`최고 관리자 ${supers?.n}명. 비상시를 위해 두 명 이상 권장합니다.`);
      else ok(`최고 관리자 ${supers?.n}명`);
      if ((supers?.n ?? 0) > 0 && (enrolled?.n ?? 0) === 0) warn("최고 관리자 중 2단계 인증을 등록한 사람이 없습니다. 첫 로그인을 마치세요.");
      const noEmail = await db
        .select({ loginId: adminUsers.loginId })
        .from(adminUsers)
        .where(and(eq(adminUsers.isActive, true), isNull(adminUsers.email)));
      if (noEmail.length > 0) warn(`이메일이 없는 관리자 ${noEmail.length}명(${noEmail.map((u) => u.loginId).join(", ")}): 아이디·비밀번호를 스스로 찾을 수 없습니다. '내 계정'이나 계정 관리에서 등록하세요.`);

      section("오픈 준비 (관리자 > 정책 설정 > 개요·오픈 준비)");
      const items = await computeReadiness(db);
      const todo = items.filter((i) => i.state === "todo");
      const confirm = items.filter((i) => i.state === "confirm");
      for (const i of todo) fail(`${i.label}: ${i.detail}`);
      for (const i of confirm) warn(`확정 필요 — ${i.label}`);
      if (todo.length === 0 && confirm.length === 0) ok("오픈 전 필수 항목을 모두 확정했습니다.");
      const s = await getSettings(db);
      if (s["notification.staffEmails"].length === 0) warn("담당자 알림 수신 주소가 없습니다(새 신청·입금 확인 요청 메일을 받을 곳).");
      else ok(`담당자 알림 수신: ${s["notification.staffEmails"].join(", ")}`);
      if (s["payment.method"] === "bankTransfer" && !s["payment.bankAccountInfo"].trim()) fail("결제 방식이 계좌이체인데 입금 계좌 안내가 비어 있습니다.");
    }
  } catch (e) {
    fail(`DB에 접속할 수 없습니다: ${e instanceof Error ? e.message : e}`);
  } finally {
    await pool.end();
  }
}

if (args.smtp) {
  section("SMTP 접속");
  const smtp = smtpConfigFromEnv();
  if (provider !== "smtp" || !smtp) fail("EMAIL_PROVIDER=smtp와 SMTP_HOST(또는 SMTP_URL)가 있어야 확인할 수 있습니다.");
  else {
    try {
      const nodemailer = await import("nodemailer");
      const timeouts = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };
      await nodemailer.createTransport(typeof smtp === "string" ? { url: smtp, ...timeouts } : { ...smtp, ...timeouts }).verify();
      ok("SMTP 서버 접속·인증 성공 (실제 발송은 pnpm mail:test --to 주소)");
    } catch (e) {
      fail(`SMTP 접속 실패: ${e instanceof Error ? e.message : e}`);
    }
  }
}

console.log(`\n결과: 오류 ${errors}개, 경고 ${warnings}개${errors ? " — 오류를 해결한 뒤 다시 실행하세요." : warnings ? " — 경고는 오픈 전에 정리하세요." : " — 준비 완료"}`);
process.exit(errors ? 1 : 0);
