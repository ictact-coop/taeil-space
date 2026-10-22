import { hasPermission } from "@/domain/auth/permissions";
import { kstDateOf } from "@/lib/time";
import { csvHeaders } from "@/lib/csv";
import { listApplicationsForExport, normalizeAdminFilter } from "@/server/applications/admin-queries";
import { applicationsCsv } from "@/server/applications/export";
import { writeAudit } from "@/server/audit/log";
import { adminPermissions, getCurrentAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { clientIpFrom } from "@/server/security/client-ip";

/**
 * 신청 관리 내려받기(자료 다운로드 권한). 목록 화면의 필터(상태 탭·검색어·이용일·공간)를 그대로 적용한다.
 * 증빙 미요청을 포함한 모든 신청과 증빙 발행 정보를 한 파일에 담고, 개인정보 내려받기를 감사 로그에 남긴다.
 */
export async function GET(req: Request) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!hasPermission(adminPermissions(current), "applications.download")) return new Response("권한이 없습니다.", { status: 403 });
  const q = new URL(req.url).searchParams;
  const filter = normalizeAdminFilter({ tab: q.get("tab") ?? undefined, q: q.get("q") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, spaceId: q.get("space") ?? undefined });
  const rows = await listApplicationsForExport(db, filter);
  const body = applicationsCsv(rows);
  await writeAudit(db, {
    actorType: "admin",
    actorId: current.user.id,
    action: "pii.export_applications",
    targetType: "application",
    after: { filter, count: rows.length },
    ip: clientIpFrom(req.headers),
  });
  const name = `대관신청_${kstDateOf(new Date())}.csv`;
  return new Response(body, { headers: csvHeaders(name) });
}
