import { isValidDateString } from "@/domain/calendar/closures";
import { getDayAvailability } from "@/server/booking/availability";
import { findSpace } from "@/server/booking/context";
import { db } from "@/server/db/client";
import { badRequest, json, notFound } from "@/server/http/json";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isValidDateString(date)) return badRequest("date는 YYYY-MM-DD 형식이어야 합니다.");
  const space = await findSpace(db, id);
  if (!space || !space.isPublic) return notFound();
  return json(await getDayAvailability(db, space, date));
}
