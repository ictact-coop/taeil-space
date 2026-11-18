import { hasPermission } from "@/domain/auth/permissions";
import { kstDateOf } from "@/lib/time";
import { encryptedXlsx, validateExportPassword, xlsxHeaders } from "@/lib/xlsx";
import { listRefunds, normalizeRefundTab } from "@/server/applications/admin-queries";
import { writeAudit } from "@/server/audit/log";
import { adminPermissions, getCurrentAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { refundsTable } from "@/server/payments/refund-export";
import { clientIpFrom } from "@/server/security/client-ip";

/** 환불 내역 내려받기: 신청 내려받기와 같이 비밀번호로 암호화한 엑셀 파일 */
export async function POST(req: Request) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  const permissions = adminPermissions(current);
  if (!hasPermission(permissions, "refunds.manage") || !hasPermission(permissions, "applications.download")) {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const error = validateExportPassword(password, String(form.get("passwordConfirm") ?? ""));
  if (error) return new Response(error, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const tab = normalizeRefundTab(String(form.get("tab") ?? ""));
  const rows = await listRefunds(db, tab);
  const body = await encryptedXlsx(refundsTable(rows), { sheetName: "환불내역", password });
  await writeAudit(db, {
    actorType: "admin", actorId: current.user.id, action: "pii.export_refunds", targetType: "refund",
    after: { tab, count: rows.length, encrypted: true }, ip: clientIpFrom(req.headers),
  });
  return new Response(new Uint8Array(body), { headers: xlsxHeaders(`환불내역_${tab === "completed" ? "완료" : "대기"}_${kstDateOf(new Date())}.xlsx`) });
}

export function GET() {
  return new Response("환불 처리 화면의 내려받기 버튼에서 비밀번호를 정해 내려받으세요.", { status: 405, headers: { "content-type": "text/plain; charset=utf-8", allow: "POST" } });
}
