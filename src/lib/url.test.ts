import { describe, expect, it } from "vitest";
import { withNotice } from "./url";

describe("withNotice", () => {
  it("한글 메시지를 인코딩해 헤더에 넣을 수 있는 주소를 만든다", () => {
    const url = withNotice("/admin/settings/fees", { done: "요금표를 저장했습니다." });
    expect(url).toMatch(/^[\x21-\x7e]+$/); // 출력 가능한 ASCII만
    expect(new URL(url, "http://x").searchParams.get("done")).toBe("요금표를 저장했습니다.");
  });
});
