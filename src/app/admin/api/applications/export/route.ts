import { hasPermission } from "@/domain/auth/permissions";
import { kstDateOf } from "@/lib/time";
import { encryptedXlsx, validateExportPassword, xlsxHeaders } from "@/lib/xlsx";
import { listApplicationsForExport, normalizeAdminFilter } from "@/server/applications/admin-queries";
import { applicationsTable } from "@/server/applications/export";
import { writeAudit } from "@/server/audit/log";
import { adminPermissions, getCurrentAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { clientIpFrom } from "@/server/security/client-ip";

/**
 * 신청 관리 내려받기(자료 다운로드 권한). 목록 화면의 필터(상태 탭·검색어·이용일·공간·증빙 종류)와 정렬을 그대로 적용한다.
 * 증빙 미요청을 포함한 모든 신청과 증빙 발행 정보를 담은 엑셀 파일을, 내려받는 사람이 정한 비밀번호로 암호화해 준다
 * (2026-11 기념관 요청: 개인정보 보호). 비밀번호는 주소에 남지 않게 POST 본문으로 받고, 저장하지 않는다.
 */
export async function POST(req: Request) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!hasPermission(adminPermissions(current), "applications.download")) return new Response("권한이 없습니다.", { status: 403 });
  const form = await req.formData();
  const s = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const error = validateExportPassword(s("password") ?? "", s("passwordConfirm") ?? "");
  if (error) return new Response(error, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const filter = normalizeAdminFilter({
    tab: s("tab"), q: s("q"), from: s("from"), to: s("to"), spaceId: s("space"), receipt: s("receipt"), sort: s("sort"), dir: s("dir"),
  });
  const rows = await listApplicationsForExport(db, filter);
  const body = await encryptedXlsx(applicationsTable(rows), { sheetName: "대관신청", password: s("password")! });
  await writeAudit(db, {
    actorType: "admin",
    actorId: current.user.id,
    action: "pii.export_applications",
    targetType: "application",
    after: { filter, count: rows.length, encrypted: true },
    ip: clientIpFrom(req.headers),
  });
  return new Response(new Uint8Array(body), { headers: xlsxHeaders(`대관신청_${kstDateOf(new Date())}.xlsx`) });
}

export function GET() {
  return new Response("신청 관리 화면의 내려받기 버튼에서 비밀번호를 정해 내려받으세요.", { status: 405, headers: { "content-type": "text/plain; charset=utf-8", allow: "POST" } });
}
