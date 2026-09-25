import { uploadAttachment } from "@/server/booking/attachments";
import { db } from "@/server/db/client";
import { badRequest, json } from "@/server/http/json";

const kinds = ["event_plan", "discount_proof", "other"] as const;
/** 요청 본문 상한(설정의 파일당 최대 크기와 별개로 서버를 보호) */
const MAX_BODY = 55 * 1024 * 1024;

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return badRequest("파일이 너무 큽니다.");
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("요청 형식이 올바르지 않습니다.");
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const uploadToken = String(form.get("uploadToken") ?? "");
  if (!(file instanceof File)) return badRequest("파일을 선택하세요.");
  if (!(kinds as readonly string[]).includes(kind)) return badRequest("첨부 종류가 올바르지 않습니다.");
  const result = await uploadAttachment(db, {
    uploadToken,
    kind: kind as (typeof kinds)[number],
    fileName: file.name,
    data: Buffer.from(await file.arrayBuffer()),
  });
  return result.ok ? json(result.attachment, { status: 201 }) : badRequest(result.error);
}
