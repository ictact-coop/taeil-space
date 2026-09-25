import { z } from "zod";
import { isValidDateString } from "@/domain/calendar/closures";
import { toMinutes } from "@/domain/booking/time";
import { quote } from "@/server/booking/availability";
import { findSpace } from "@/server/booking/context";
import { db } from "@/server/db/client";
import { badRequest, json, notFound } from "@/server/http/json";

const schema = z.object({
  spaceId: z.string().uuid(),
  date: z.string().refine(isValidDateString),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  headcount: z.number().int().min(1).max(10000).nullable().optional(),
  discountRuleId: z.string().uuid().nullable().optional(),
  optionKeys: z.array(z.string().max(30)).max(20).optional(),
});

/** 선택한 일시의 규칙 검사와 예상 금액 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("요청 형식이 올바르지 않습니다.");
  const q = parsed.data;
  const space = await findSpace(db, q.spaceId);
  if (!space || !space.isPublic) return notFound();
  return json(
    await quote(db, space, {
      date: q.date,
      startMinutes: toMinutes(q.start),
      endMinutes: toMinutes(q.end),
      headcount: q.headcount ?? null,
      discountRuleId: q.discountRuleId ?? null,
      optionKeys: q.optionKeys ?? [],
    }),
  );
}
