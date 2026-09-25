import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import type { Actor, MutationResult } from "@/server/actor";
import { assertCanManage } from "@/server/auth/permissions";
import { spacePhotos, spaces } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { detectContentType, extensionOf } from "@/server/storage/file-type";
import { getStorage } from "@/server/storage/storage";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export function listSpacePhotos(db: DbOrTx, spaceId: string) {
  return db.select().from(spacePhotos).where(eq(spacePhotos.spaceId, spaceId)).orderBy(asc(spacePhotos.sortOrder), asc(spacePhotos.createdAt));
}

export async function addSpacePhoto(
  db: Db,
  params: { actor: Actor; spaceId: string; fileName: string; data: Buffer; alt: string },
): Promise<MutationResult<{ id: string }>> {
  assertCanManage(params.actor.role, "spaces");
  const ext = extensionOf(params.fileName);
  if (!PHOTO_EXTENSIONS.includes(ext)) return { ok: false, formError: "사진은 jpg, png, webp 파일만 올릴 수 있습니다." };
  if (params.data.length > PHOTO_MAX_BYTES) return { ok: false, formError: "사진은 5MB 이하만 올릴 수 있습니다." };
  const contentType = detectContentType(ext, params.data.subarray(0, 16));
  if (!contentType) return { ok: false, formError: "이미지 파일이 아닙니다." };
  const alt = params.alt.trim();
  if (alt.length < 2) return { ok: false, formError: "사진 설명(대체 텍스트)을 입력하세요. 화면낭독기 이용자에게 읽어 줍니다." };
  const [space] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, params.spaceId));
  if (!space) return { ok: false, formError: "공간을 찾을 수 없습니다." };

  const key = `space-photos/${params.spaceId}/${randomUUID()}`;
  await getStorage().put(key, params.data);
  const existing = await listSpacePhotos(db, params.spaceId);
  const [row] = await db
    .insert(spacePhotos)
    .values({ spaceId: params.spaceId, storageKey: key, contentType, alt, sortOrder: existing.length, createdBy: params.actor.id })
    .returning({ id: spacePhotos.id });
  await writeAudit(db, {
    actorType: "admin",
    actorId: params.actor.id,
    action: "space.photo_add",
    targetType: "space",
    targetId: params.spaceId,
    after: { photoId: row!.id, alt },
    ip: params.actor.ip,
  });
  return { ok: true, value: { id: row!.id } };
}

export async function deleteSpacePhoto(db: Db, params: { actor: Actor; photoId: string }): Promise<MutationResult> {
  assertCanManage(params.actor.role, "spaces");
  const [row] = await db.delete(spacePhotos).where(eq(spacePhotos.id, params.photoId)).returning();
  if (!row) return { ok: false, formError: "사진을 찾을 수 없습니다." };
  await getStorage().remove(row.storageKey);
  await writeAudit(db, {
    actorType: "admin",
    actorId: params.actor.id,
    action: "space.photo_delete",
    targetType: "space",
    targetId: row.spaceId,
    before: { photoId: row.id, alt: row.alt },
    ip: params.actor.ip,
  });
  return { ok: true };
}
