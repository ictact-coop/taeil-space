import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { spacePhotos } from "@/server/db/schema";
import { getStorage } from "@/server/storage/storage";

/** 공간 사진 (공개) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [photo] = await db.select({ key: spacePhotos.storageKey, contentType: spacePhotos.contentType }).from(spacePhotos).where(eq(spacePhotos.id, id));
  if (!photo) return new Response("Not found", { status: 404 });
  const data = await getStorage().get(photo.key);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": photo.contentType, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff" },
  });
}
