"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { deleteSpacePhoto } from "@/server/spaces/photos";

export async function deletePhotoAction(spaceId: string, photoId: string): Promise<void> {
  const admin = await requireAdmin(["system"]);
  await deleteSpacePhoto(db, { actor: { id: admin.id, role: admin.role, ip: admin.ip }, photoId });
  revalidatePath(`/admin/settings/spaces/${spaceId}`);
}
