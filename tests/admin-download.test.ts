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

import { GET as exportRefundsGet, POST as exportRefunds } from "@/app/admin/api/refunds/export/route";
import { GET as exportApplicationsGet, POST as exportApplications } from "@/app/admin/api/applications/export/route";
import { GET as downloadAttachment } from "@/app/admin/api/attachments/[id]/route";

/** 내려받기는 비밀번호를 POST 본문으로 받는다 */
const post = (url: string, fields: Record<string, string> = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries({ password: "secret12", passwordConfirm: "secret12", ...fields })) body.set(k, v);
  return new Request(url, { method: "POST", body });
};
const appsUrl = "http://localhost/admin/api/applications/export";
const refundsUrl = "http://localhost/admin/api/refunds/export";
const request = new Request(appsUrl);
const routes = [
  { name: "환불 엑셀", run: () => exportRefunds(post(refundsUrl, { tab: "completed" })), allowedStatus: 200 },
  { name: "신청 엑셀", run: () => exportApplications(post(appsUrl)), allowedStatus: 200 },
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


describe("비밀번호를 건 엑셀 내려받기", () => {
  const superAdmin = () => getCurrentAdmin.mockResolvedValue({ user: { id: "admin" }, session: { mfaVerified: true }, grade: { isSuper: true, permissions: [] } });
  it.each([{ permissions: ["applications.view", "applications.download"] }, { permissions: ["applications.view", "refunds.manage"] }])("환불 내역에는 환불 처리와 다운로드 권한이 모두 필요하다 ($permissions)", async ({ permissions }) => {
    getCurrentAdmin.mockResolvedValue({ session: { mfaVerified: true }, grade: { isSuper: false, permissions } });
    expect((await exportRefunds(post(refundsUrl))).status).toBe(403);
    expect(listRefunds).not.toHaveBeenCalled();
  });
  it("비밀번호가 짧거나 확인이 다르면 내려주지 않고 기록도 남기지 않는다", async () => {
    superAdmin();
    for (const fields of [{ password: "12345", passwordConfirm: "12345" }, { password: "secret12", passwordConfirm: "secret13" }, { password: "", passwordConfirm: "" }]) {
      expect((await exportApplications(post(appsUrl, fields))).status).toBe(400);
      expect((await exportRefunds(post(refundsUrl, fields))).status).toBe(400);
    }
    expect(listApplicationsForExport).not.toHaveBeenCalled();
    expect(listRefunds).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
  it("암호화된 엑셀 파일을 주고 감사 로그를 남긴다", async () => {
    superAdmin();
    const response = await exportRefunds(post(refundsUrl, { tab: "completed" }));
    expect(listRefunds).toHaveBeenCalledWith({}, "completed");
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("content-disposition")).toContain(".xlsx");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // 암호화된 오피스 파일은 OLE 복합 문서(D0 CF 11 E0)로 시작한다(일반 xlsx는 zip, PK)
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString("hex")).toBe("d0cf11e0");
    expect(writeAudit).toHaveBeenCalledWith({}, expect.objectContaining({ action: "pii.export_refunds", after: { tab: "completed", count: 0, encrypted: true } }));
    const apps = await exportApplications(post(appsUrl));
    expect(Buffer.from(await apps.arrayBuffer()).subarray(0, 4).toString("hex")).toBe("d0cf11e0");
    expect(writeAudit).toHaveBeenLastCalledWith({}, expect.objectContaining({ action: "pii.export_applications" }));
  });
  it("주소(GET)로는 내려받을 수 없다", async () => {
    expect(exportApplicationsGet().status).toBe(405);
    expect(exportRefundsGet().status).toBe(405);
  });
});
