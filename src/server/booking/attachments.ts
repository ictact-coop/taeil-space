import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { attachments } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { getSettings } from "@/server/settings/service";
import { detectContentType, extensionOf } from "@/server/storage/file-type";
import { scanFile } from "@/server/storage/scan";
import { getStorage } from "@/server/storage/storage";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newUploadToken = () => randomBytes(24).toString("base64url");

export type AttachmentKind = "event_plan" | "discount_proof" | "other";
export type AttachmentRow = typeof attachments.$inferSelect;

export type UploadResult =
  | { ok: true; attachment: { id: string; name: string; size: number; kind: AttachmentKind } }
  | { ok: false; error: string };

/** 신청서 작성 중 첨부 업로드. 확장자·크기·개수·파일 내용 시그니처·악성코드 검사를 거친다. */
export async function uploadAttachment(
  db: Db,
  params: { uploadToken: string; kind: AttachmentKind; fileName: string; data: Buffer; now?: Date },
): Promise<UploadResult> {
  if (params.uploadToken.length < 20) return { ok: false, error: "업로드 세션이 올바르지 않습니다. 화면을 새로고침하세요." };
  const settings = await getSettings(db, params.now);
  const ext = extensionOf(params.fileName);
  const allowed = settings["application.attachmentExtensions"];
  if (!allowed.includes(ext)) return { ok: false, error: `올릴 수 있는 파일 형식: ${allowed.join(", ")}` };
  const maxMb = settings["application.attachmentMaxMb"];
  if (params.data.length === 0) return { ok: false, error: "빈 파일입니다." };
  if (params.data.length > maxMb * 1024 * 1024) return { ok: false, error: `파일은 ${maxMb}MB 이하만 올릴 수 있습니다.` };
  const contentType = detectContentType(ext, params.data.subarray(0, 16));
  if (!contentType) return { ok: false, error: "파일 내용이 확장자와 맞지 않습니다. 원본 파일을 올려 주세요." };

  const tokenHash = hashToken(params.uploadToken);
  const existing = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.uploadTokenHash, tokenHash), isNull(attachments.applicationId)));
  if (existing.length >= settings["application.attachmentMaxCount"]) {
    return { ok: false, error: `첨부파일은 ${settings["application.attachmentMaxCount"]}개까지 올릴 수 있습니다.` };
  }

  const scan = await scanFile(params.data);
  if (scan === "infected") return { ok: false, error: "악성코드가 발견되어 올릴 수 없습니다." };

  const now = params.now ?? new Date();
  const key = `attachments/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  await getStorage().put(key, params.data);
  const name = params.fileName.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120);
  const [row] = await db
    .insert(attachments)
    .values({
      uploadTokenHash: tokenHash,
      kind: params.kind,
      originalName: name,
      storageKey: key,
      contentType,
      size: params.data.length,
      sha256: createHash("sha256").update(params.data).digest("hex"),
      scanStatus: scan,
    })
    .returning();
  return { ok: true, attachment: { id: row!.id, name, size: row!.size, kind: params.kind } };
}

/** 제출 전 첨부 삭제 (같은 업로드 세션의 파일만) */
export async function removePendingAttachment(db: Db, uploadToken: string, id: string): Promise<boolean> {
  const [row] = await db
    .delete(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.uploadTokenHash, hashToken(uploadToken)), isNull(attachments.applicationId)))
    .returning({ storageKey: attachments.storageKey });
  if (row) await getStorage().remove(row.storageKey);
  return Boolean(row);
}

export async function listPendingAttachments(db: DbOrTx, uploadToken: string) {
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.uploadTokenHash, hashToken(uploadToken)), isNull(attachments.applicationId)));
}

/** 신청에 연결되지 않은 채 오래된 첨부 정리 */
export async function purgeOrphanAttachments(db: Db, olderThan: Date): Promise<number> {
  const rows = await db
    .delete(attachments)
    .where(and(isNull(attachments.applicationId), lt(attachments.createdAt, olderThan)))
    .returning({ storageKey: attachments.storageKey });
  for (const r of rows) await getStorage().remove(r.storageKey);
  return rows.length;
}
