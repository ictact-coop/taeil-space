import { describe, expect, it } from "vitest";
import { parseKstLocalInput, toKstLocalInput } from "./time";

describe("KST 입력 변환", () => {
  it("datetime-local(KST)을 UTC Date로 바꾼다", () => {
    expect(parseKstLocalInput("2026-10-29T09:00")?.toISOString()).toBe("2026-10-29T00:00:00.000Z");
  });
  it("Date를 KST datetime-local 문자열로 바꾼다", () => {
    expect(toKstLocalInput(new Date("2026-10-28T15:30:00Z"))).toBe("2026-10-29T00:30");
  });
  it("형식이 틀리면 null", () => {
    expect(parseKstLocalInput("2026-10-29 09:00")).toBeNull();
    expect(parseKstLocalInput("")).toBeNull();
  });
});
