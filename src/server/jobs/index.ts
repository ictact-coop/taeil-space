import { PgBoss } from "pg-boss";
import { purgeExpiredSessions } from "@/server/auth/service";
import { purgeOrphanAttachments } from "@/server/booking/attachments";
import { expirePendingApplications } from "@/server/booking/expire";
import type { Db } from "@/server/db/types";

/**
 * 주기 작업 (계획서 2.1: pg-boss). 웹 서버와 별도 프로세스(`pnpm worker`)로 실행한다.
 * 결제 유효시간 만료는 화면·신청 처리에서도 만료된 점유를 무시하므로, 작업이 잠시 멈춰도 이중 예약은 생기지 않는다.
 */
export const jobs = {
  "expire-pending-payments": { cron: "* * * * *", run: (db: Db) => expirePendingApplications(db) },
  "purge-orphan-attachments": { cron: "17 * * * *", run: (db: Db) => purgeOrphanAttachments(db, new Date(Date.now() - 24 * 3600_000)) },
  "purge-expired-sessions": { cron: "23 * * * *", run: async (db: Db) => (await purgeExpiredSessions(db), 0) },
} as const;

export async function startWorker(connectionString: string, db: Db): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  boss.on("error", (e) => console.error("[worker]", e));
  await boss.start();
  for (const [name, job] of Object.entries(jobs)) {
    await boss.createQueue(name);
    await boss.schedule(name, job.cron, null, { tz: "Asia/Seoul" });
    await boss.work(name, async () => {
      const count = await job.run(db);
      if (count) console.log(`[worker] ${name}: ${count}건 처리`);
    });
  }
  return boss;
}
