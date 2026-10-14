import { describe, expect, it } from "vitest";
import { pageNumbers } from "./pagination";

describe("페이지 번호", () => {
  it("현재 쪽 앞뒤 2쪽과 처음·끝만 보이고 사이는 생략", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(6, 20)).toEqual([1, null, 4, 5, 6, 7, 8, null, 20]);
    expect(pageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, 6, null, 20]);
    expect(pageNumbers(20, 20)).toEqual([1, null, 18, 19, 20]);
  });
});
