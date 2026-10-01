import { desc, lt, sql } from "drizzle-orm";
import { adminUsers, auditLogs } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";

/** 최신순 감사 로그. before(id)를 주면 그보다 오래된 기록부터. */
export async function listAuditLogs(db: DbOrTx, params: { before?: number; limit: number }) {
  const before = params.before;
  return db
    .select({ log: auditLogs, actorName: adminUsers.name })
    .from(auditLogs)
    // actor_id는 관리자 외 행위자도 담는 text 컬럼이라 uuid를 text로 바꿔 비교한다
    .leftJoin(adminUsers, sql`${adminUsers.id}::text = ${auditLogs.actorId}`)
    .where(before !== undefined && Number.isFinite(before) && before > 0 ? lt(auditLogs.id, before) : undefined)
    .orderBy(desc(auditLogs.id))
    .limit(params.limit);
}
