import { lt, sql } from "drizzle-orm";
import { rateLimits } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";

/**
 * 요청 횟수 제한 (고정 창). 한도를 넘으면 false.
 * 예: consumeRateLimit(db, `submit:${ip}`, { limit: 10, windowSeconds: 3600 })
 */
export async function consumeRateLimit(
  db: DbOrTx,
  key: string,
  opts: { limit: number; windowSeconds: number },
  now: Date = new Date(),
): Promise<boolean> {
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: key.slice(0, 200), windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= opts.limit;
}

/** 지난 창 기록 정리 (작업 프로세스) */
export async function purgeRateLimits(db: DbOrTx, now: Date = new Date()): Promise<number> {
  const rows = await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 3600_000))).returning({ key: rateLimits.key });
  return rows.length;
}

/** 공개 기능별 한도 (IP 기준) */
export const limits = {
  submit: { limit: 10, windowSeconds: 3600 },
  upload: { limit: 30, windowSeconds: 600 },
  quote: { limit: 300, windowSeconds: 600 },
  otpRequest: { limit: 20, windowSeconds: 3600 },
  otpVerify: { limit: 30, windowSeconds: 3600 },
  adminLogin: { limit: 30, windowSeconds: 900 },
} as const;
