"use server";

import { redirect } from "next/navigation";
import { endSession, getCurrentAdmin, requestMeta } from "@/server/auth/current";
import { writeAudit } from "@/server/audit/log";
import { db } from "@/server/db/client";

export async function logoutAction(): Promise<void> {
  const current = await getCurrentAdmin();
  if (current) {
    await writeAudit(db, {
      actorType: "admin",
      actorId: current.user.id,
      action: "auth.logout",
      targetType: "admin_user",
      targetId: current.user.id,
      ip: (await requestMeta()).ip,
    });
  }
  await endSession();
  redirect("/admin/login");
}
