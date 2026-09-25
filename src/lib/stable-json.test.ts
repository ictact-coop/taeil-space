import { describe, expect, it } from "vitest";
import { sameJson, stableStringify } from "./stable-json";

describe("stableStringify", () => {
  it("객체 키 순서와 무관하게 같은 문자열", () => {
    expect(sameJson({ percent: 50, daysBefore: 3 }, { daysBefore: 3, percent: 50 })).toBe(true);
    expect(sameJson([{ a: 1, b: { d: 2, c: 3 } }], [{ b: { c: 3, d: 2 }, a: 1 }])).toBe(true);
  });
  it("배열 순서와 값은 구분한다", () => {
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: "1" })).toBe(false);
    expect(stableStringify(null)).toBe("null");
  });
});
