import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentAdmin, listApplicationsForExport, listRefunds, writeAudit } = vi.hoisted(() => ({
  getCurrentAdmin: vi.fn(),
  listRefunds: vi.fn(async () => []),
  listApplicationsForExport: vi.fn(async () => []),
  writeAudit: vi.fn(),
}));
vi.mock("@/server/auth/current", () => ({
  getCurrentAdmin,
  adminPermissions: (current: { grade: unknown }) => current.grade,
  requestMeta: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/applications/admin-queries", () => ({
  listApplicationsForExport,
  listRefunds,
  normalizeRefundTab: (tab: string) => tab === "completed" ? "completed" : "pending",
  normalizeAdminFilter: () => ({}),
}));
vi.mock("@/server/audit/log", () => ({ writeAudit }));

import { GET as exportRefunds } from "@/app/admin/api/refunds/export/route";
import { GET as exportApplications } from "@/app/admin/api/applications/export/route";
import { GET as downloadAttachment } from "@/app/admin/api/attachments/[id]/route";

const request = new Request("http://localhost/admin/api/applications/export");
const routes = [
  { name: "환불 CSV", run: () => exportRefunds(new Request("http://localhost/admin/api/refunds/export?tab=completed")), allowedStatus: 200 },
  { name: "신청 CSV", run: () => exportApplications(request), allowedStatus: 200 },
  { name: "기존 증빙 URL도 통합 CSV", run: () => exportApplications(new Request(`${request.url}?kind=receipts`)), allowedStatus: 200 },
  // An invalid ID reaches validation only after authorization succeeds.
  { name: "첨부파일", run: () => downloadAttachment(request, { params: Promise.resolve({ id: "invalid" }) }), allowedStatus: 404 },
];

beforeEach(() => vi.clearAllMocks());

for (const route of routes) {
  describe(`${route.name} 다운로드 권한`, () => {
    it("로그인 및 2단계 인증이 필요하다", async () => {
      getCurrentAdmin.mockResolvedValue(null);
      expect((await route.run()).status).toBe(401);
      getCurrentAdmin.mockResolvedValue({ session: { mfaVerified: false } });
      expect((await route.run()).status).toBe(401);
    });
    it("신청 조회만으로는 직접 URL 접근도 거부한다", async () => {
      getCurrentAdmin.mockResolvedValue({ session: { mfaVerified: true }, grade: { isSuper: false, permissions: ["applications.view"] } });
      expect((await route.run()).status).toBe(403);
      expect(listApplicationsForExport).not.toHaveBeenCalled();
      expect(listRefunds).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });
    it.each([false, true])("자료 다운로드 권한 또는 최고 관리자에게 허용한다 (최고 관리자: %s)", async (isSuper) => {
      getCurrentAdmin.mockResolvedValue({
        user: { id: "admin" }, session: { mfaVerified: true },
        grade: { isSuper, permissions: isSuper ? [] : ["applications.view", "applications.download", "refunds.manage"] },
      });
      expect((await route.run()).status).toBe(route.allowedStatus);
    });
  });
}


describe("통합 CSV와 환불 내역 내려받기", () => {
  it.each([{ permissions: ["applications.view", "applications.download"] }, { permissions: ["applications.view", "refunds.manage"] }])("환불 CSV에는 환불 처리와 다운로드 권한이 모두 필요하다 ($permissions)", async ({ permissions }) => {
    getCurrentAdmin.mockResolvedValue({ session: { mfaVerified: true }, grade: { isSuper: false, permissions } });
    expect((await exportRefunds(new Request("http://localhost/admin/api/refunds/export"))).status).toBe(403);
    expect(listRefunds).not.toHaveBeenCalled();
  });
  it("선택한 환불 탭을 내보내고 감사 로그와 CSV 헤더를 기록한다", async () => {
    getCurrentAdmin.mockResolvedValue({ user: { id: "admin" }, session: { mfaVerified: true }, grade: { isSuper: true, permissions: [] } });
    const response = await exportRefunds(new Request("http://localhost/admin/api/refunds/export?tab=completed"));
    expect(listRefunds).toHaveBeenCalledWith({}, "completed");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(writeAudit).toHaveBeenCalledWith({}, expect.objectContaining({ action: "pii.export_refunds", after: { tab: "completed", count: 0 } }));
  });
  it("기존 증빙 URL도 미요청을 제외하지 않는 통합 CSV를 반환한다", async () => {
    getCurrentAdmin.mockResolvedValue({ user: { id: "admin" }, session: { mfaVerified: true }, grade: { isSuper: true, permissions: [] } });
    const regular = await exportApplications(request);
    const legacy = await exportApplications(new Request(`${request.url}?kind=receipts`));
    expect(await regular.text()).toBe(await legacy.text());
    expect(writeAudit).toHaveBeenLastCalledWith({}, expect.objectContaining({ action: "pii.export_applications" }));
  });
});
