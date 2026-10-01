"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { deleteSpacePhoto } from "@/server/spaces/photos";

export async function deletePhotoAction(spaceId: string, photoId: string): Promise<void> {
  const admin = await requireAdmin("spaces.manage");
  await deleteSpacePhoto(db, { actor: admin, photoId });
  revalidatePath(`/admin/settings/spaces/${spaceId}`);
}
