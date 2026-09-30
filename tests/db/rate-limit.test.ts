import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateLimits } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { consumeRateLimit, purgeRateLimits } from "@/server/security/rate-limit";
import { hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("요청 횟수 제한", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await resetTestDb()));
  afterAll(async () => close?.());

  it("창 안에서 한도까지 허용하고, 다음 창에서 다시 허용", async () => {
    const opts = { limit: 3, windowSeconds: 60 };
    const t0 = new Date("2026-10-01T00:00:05Z");
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await consumeRateLimit(db, "submit:1.2.3.4", opts, t0));
    expect(results).toEqual([true, true, true, false]);
    expect(await consumeRateLimit(db, "submit:5.6.7.8", opts, t0)).toBe(true);
    expect(await consumeRateLimit(db, "submit:1.2.3.4", opts, new Date("2026-10-01T00:01:01Z"))).toBe(true);
  });

  it("하루 지난 기록 정리", async () => {
    const removed = await purgeRateLimits(db, new Date("2026-10-03T00:00:00Z"));
    expect(removed).toBeGreaterThanOrEqual(3);
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });
});
