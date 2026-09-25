import { eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit/log";
import { getCurrentAdmin, requestMeta } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { attachments } from "@/server/db/schema";
import { getStorage } from "@/server/storage/storage";

/** 첨부파일 내려받기 (관리자 전용, 내려받기 이력을 감사 로그에 남김 — [요구] 24장) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [file] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!file?.applicationId) return new Response("Not found", { status: 404 });
  if (file.scanStatus === "infected") return new Response("악성코드가 발견된 파일은 내려받을 수 없습니다.", { status: 403 });
  const data = await getStorage().get(file.storageKey);
  if (!data) return new Response("Not found", { status: 404 });
  await writeAudit(db, {
    actorType: "admin",
    actorId: current.user.id,
    action: "pii.download",
    targetType: "attachment",
    targetId: file.id,
    after: { applicationId: file.applicationId, name: file.originalName },
    ip: (await requestMeta()).ip,
  });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
