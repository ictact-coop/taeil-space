import { getMonthCalendar } from "@/server/booking/availability";
import { findSpace } from "@/server/booking/context";
import { db } from "@/server/db/client";
import { badRequest, json, notFound } from "@/server/http/json";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest("month는 YYYY-MM 형식이어야 합니다.");
  const space = await findSpace(db, id);
  if (!space || !space.isPublic) return notFound();
  return json({ month, days: await getMonthCalendar(db, space, month) });
}
