import { asc, inArray } from "drizzle-orm";
import { spacePhotos } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { getFeeScheduleAt } from "@/server/pricing/fee-service";
import { getSettings } from "@/server/settings/service";
import { listActiveDiscounts, listPublicSpaces } from "./context";

/** 대관 안내·공간 안내 화면에 필요한 공개 정보 */
export async function getPublicInfo(db: DbOrTx, now: Date = new Date()) {
  const [settings, spaces, fee, discounts] = await Promise.all([getSettings(db, now), listPublicSpaces(db), getFeeScheduleAt(db, now), listActiveDiscounts(db)]);
  const photos = spaces.length
    ? await db
        .select({ id: spacePhotos.id, spaceId: spacePhotos.spaceId, alt: spacePhotos.alt })
        .from(spacePhotos)
        .where(inArray(spacePhotos.spaceId, spaces.map((s) => s.id)))
        .orderBy(asc(spacePhotos.sortOrder), asc(spacePhotos.createdAt))
    : [];
  return { settings, spaces, fee, discounts, photos };
}
