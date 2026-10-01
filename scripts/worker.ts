import { createDb } from "../src/server/db/connect";
import { startWorker } from "../src/server/jobs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}
const { db, pool } = createDb(url);
const boss = await startWorker(url, db);
console.log("작업 프로세스를 시작했습니다.");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
