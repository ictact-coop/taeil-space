import { describe, expect, it } from "vitest";
import { hasPermission, normalizePermissions } from "./permissions";

describe("권한", () => {
  it("선행 권한을 더하고 모르는 키는 버린다", () => {
    expect(normalizePermissions(["applications.review", "nope", "schedule.manage"])).toEqual(["applications.view", "applications.review", "schedule.manage", "settings.view"]);
  });
  it("자료 다운로드는 신청 조회를 함께 부여하되 조회만으로 다운로드할 수 없다", () => {
    expect(normalizePermissions(["applications.download"])).toEqual(["applications.view", "applications.download"]);
    expect(hasPermission({ isSuper: false, permissions: ["applications.view"] }, "applications.download")).toBe(false);
    expect(hasPermission({ isSuper: true, permissions: [] }, "applications.download")).toBe(true);
  });
  it("최고 관리자는 모든 권한", () => {
    expect(hasPermission({ isSuper: true, permissions: [] }, "audit.view")).toBe(true);
    expect(hasPermission({ isSuper: false, permissions: ["calendar.view"] }, "audit.view")).toBe(false);
  });
});
