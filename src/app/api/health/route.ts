import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { json } from "@/server/http/json";

export const dynamic = "force-dynamic";

/** 상태 확인 (로드밸런서·가동 감시용). DB 연결까지 확인한다. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
}
