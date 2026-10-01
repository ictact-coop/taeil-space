import { runMigrations } from "../src/server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}
await runMigrations(url);
console.log("마이그레이션 완료");
