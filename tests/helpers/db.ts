import { sql } from "drizzle-orm";
import { createDb } from "@/server/db/connect";
import { runMigrations } from "@/server/db/migrate";
import { adminUsers } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { hashPassword } from "@/server/auth/password";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
/** TEST_DATABASE_URL이 없으면 DB 통합 테스트는 건너뛴다. CI에서는 항상 설정한다. */
export const hasTestDb = Boolean(TEST_DATABASE_URL);

/** 테스트 DB를 비우고 마이그레이션을 처음부터 다시 적용한다. */
export async function resetTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 필요합니다.");
  const admin = createDb(TEST_DATABASE_URL);
  await admin.db.execute(sql`drop schema if exists public cascade`);
  await admin.db.execute(sql`drop schema if exists drizzle cascade`);
  await admin.db.execute(sql`create schema public`);
  await admin.pool.end();
  await runMigrations(TEST_DATABASE_URL);
  const { db, pool } = createDb(TEST_DATABASE_URL);
  return { db, close: () => pool.end() };
}

let counter = 0;
export async function createTestAdmin(
  db: Db,
  role: "rental" | "accounting" | "system" = "system",
  password = "test-password-123",
) {
  counter += 1;
  const [user] = await db
    .insert(adminUsers)
    .values({ loginId: `admin${counter}-${role}`, name: `테스트${counter}`, role, passwordHash: await hashPassword(password) })
    .returning();
  return user!;
}

export async function createTestSpace(db: Db, overrides: Partial<typeof import("@/server/db/schema").spaces.$inferInsert> = {}) {
  const { spaces } = await import("@/server/db/schema");
  counter += 1;
  const [space] = await db
    .insert(spaces)
    .values({ code: `space${counter}`, name: `공간${counter}`, capacity: 20, leadDays: 14, ...overrides })
    .returning();
  return space!;
}

export async function createTestApplication(
  db: Db,
  params: { spaceId: string; startsAt: Date; endsAt: Date; status?: (typeof import("@/server/db/schema").applicationStatus.enumValues)[number] },
) {
  const { applications } = await import("@/server/db/schema");
  counter += 1;
  const [app] = await db
    .insert(applications)
    .values({
      applicationNo: `R-TEST-${counter}`,
      status: params.status ?? "confirmed",
      spaceId: params.spaceId,
      orgName: "테스트단체",
      contactName: "담당자",
      contactPhone: "010-0000-0000",
      contactEmail: "t@example.org",
      eventTitle: "행사",
      eventPurpose: "목적",
      expectedHeadcount: 10,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
    })
    .returning();
  return app!;
}
