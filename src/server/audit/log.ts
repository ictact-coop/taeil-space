import { auditLogs } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";

export interface AuditEntry {
  actorType: "admin" | "system" | "applicant";
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** 감사 로그 기록. 상태·금액·설정을 바꾸는 트랜잭션 안에서 함께 호출한다. (NFR-06) */
export async function writeAudit(db: DbOrTx, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await db.insert(auditLogs).values(
    list.map((e) => ({
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      ip: e.ip ?? null,
    })),
  );
}
