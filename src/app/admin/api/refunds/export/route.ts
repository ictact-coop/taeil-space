import { hasPermission } from "@/domain/auth/permissions";
import { csvHeaders } from "@/lib/csv";
import { kstDateOf } from "@/lib/time";
import { listRefunds, normalizeRefundTab } from "@/server/applications/admin-queries";
import { writeAudit } from "@/server/audit/log";
import { adminPermissions, getCurrentAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { refundsCsv } from "@/server/payments/refund-export";
import { clientIpFrom } from "@/server/security/client-ip";

export async function GET(req: Request) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  const permissions = adminPermissions(current);
  if (!hasPermission(permissions, "refunds.manage") || !hasPermission(permissions, "applications.download")) {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const tab = normalizeRefundTab(new URL(req.url).searchParams.get("tab"));
  const rows = await listRefunds(db, tab);
  const body = refundsCsv(rows);
  await writeAudit(db, {
    actorType: "admin", actorId: current.user.id, action: "pii.export_refunds", targetType: "refund",
    after: { tab, count: rows.length }, ip: clientIpFrom(req.headers),
  });
  return new Response(body, { headers: csvHeaders(`환불내역_${tab === "completed" ? "완료" : "대기"}_${kstDateOf(new Date())}.csv`) });
}
