import { removePendingAttachment } from "@/server/booking/attachments";
import { db } from "@/server/db/client";
import { badRequest, json, notFound } from "@/server/http/json";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { uploadToken?: unknown } | null;
  if (!/^[0-9a-f-]{36}$/.test(id) || typeof body?.uploadToken !== "string") return badRequest("요청 형식이 올바르지 않습니다.");
  return (await removePendingAttachment(db, body.uploadToken, id)) ? json({ ok: true }) : notFound();
}
