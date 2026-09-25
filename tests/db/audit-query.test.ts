import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeAudit } from "@/server/audit/log";
import { listAuditLogs } from "@/server/audit/query";
import type { Db } from "@/server/db/types";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("감사 로그 조회", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await resetTestDb()));
  afterAll(async () => close?.());

  it("관리자 이름을 붙여 최신순으로 돌려주고, 시스템 행위도 포함한다", async () => {
    const admin = await createTestAdmin(db);
    await writeAudit(db, { actorType: "system", action: "admin.created", targetType: "admin_user", targetId: admin.id });
    await writeAudit(db, { actorType: "admin", actorId: admin.id, action: "setting.change", targetType: "setting", targetId: "k" });

    const rows = await listAuditLogs(db, { limit: 10 });
    expect(rows.map((r) => r.log.action)).toEqual(["setting.change", "admin.created"]);
    expect(rows[0]!.actorName).toBe(admin.name);
    expect(rows[1]!.actorName).toBeNull();

    const older = await listAuditLogs(db, { before: rows[0]!.log.id, limit: 10 });
    expect(older.map((r) => r.log.action)).toEqual(["admin.created"]);
  });
});
