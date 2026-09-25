import { getCurrentAdmin, requestMeta } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { badRequest, json } from "@/server/http/json";
import { addSpacePhoto, PHOTO_MAX_BYTES } from "@/server/spaces/photos";

/** 공간 사진 업로드 (관리자 세션 쿠키 경로가 /admin이라 이 아래에 둔다) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentAdmin();
  if (!current || !current.session.mfaVerified) return json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!canManage(current.user.role, "spaces")) return json({ error: "권한이 없습니다." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES + 64 * 1024) return badRequest("사진은 5MB 이하만 올릴 수 있습니다.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("사진을 선택하세요.");
  const { id } = await params;
  const result = await addSpacePhoto(db, {
    actor: { id: current.user.id, role: current.user.role, ip: (await requestMeta()).ip },
    spaceId: id,
    fileName: file.name,
    data: Buffer.from(await file.arrayBuffer()),
    alt: String(form?.get("alt") ?? ""),
  });
  return result.ok ? json(result.value, { status: 201 }) : badRequest(result.formError ?? "올리지 못했습니다.");
}
