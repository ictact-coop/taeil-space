import { hasPermission } from "@/domain/auth/permissions";
import { adminPermissions, getCurrentAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { getPerformanceReport, parseReportParams, performanceCsv } from "@/server/stats/performance";

/** 실적 통계 CSV 내려받기 (통계 조회 권한). 집계값만 담고 신청자 정보는 없다. */
export async function GET(req: Request) {
  const current = await getCurrentAdmin();
  if (!current?.session.mfaVerified) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!hasPermission(adminPermissions(current), "stats.view")) return new Response("권한이 없습니다.", { status: 403 });
  const q = new URL(req.url).searchParams;
  const params = parseReportParams({ view: q.get("view"), year: q.get("year"), month: q.get("month") });
  const report = await getPerformanceReport(db, params);
  const name = params.granularity === "month" ? `대관실적_월별_${params.year}.csv` : `대관실적_주별_${params.year}-${String(params.month).padStart(2, "0")}.csv`;
  return new Response(performanceCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="stats.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
