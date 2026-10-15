import { describe, expect, it } from "vitest";
import { splitVat } from "@/server/applications/export";
import { toCsv } from "./csv";

describe("CSV", () => {
  it("BOM·CRLF, 쉼표·따옴표·줄바꿈을 감싸고 수식으로 시작하는 값은 막는다", () => {
    const csv = toCsv([
      ["a", 1, null],
      ['쉼표,있음', '따옴표"', "줄\n바꿈"],
      ["=SUM(A1)", "+1", "-", "@x"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["a,1,", '"쉼표,있음","따옴표""","줄\n바꿈"', "'=SUM(A1),'+1,'-,'@x", ""]);
  });
  it("부가세 포함 금액을 공급가액·세액으로 나눈다", () => {
    expect(splitVat(110000)).toEqual({ supply: 100000, vat: 10000 });
    expect(splitVat(60000)).toEqual({ supply: 54545, vat: 5455 });
    expect(splitVat(0)).toEqual({ supply: 0, vat: 0 });
  });
});
