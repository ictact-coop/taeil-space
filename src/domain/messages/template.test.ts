import { describe, expect, it } from "vitest";
import { fillTemplate, parseMessageTemplates, splitSubject } from "./template";

describe("안내 문구 자리표시자·문구 모음", () => {
  it("자리표시자를 채우고, 모르는 것은 그대로 둔다", () => {
    expect(fillTemplate("일자: {일자}\n장소: {공간} {없는것}", { 일자: "2026. 11. 3.(화) 10:00–12:00", 공간: "세미나실" })).toBe(
      "일자: 2026. 11. 3.(화) 10:00–12:00\n장소: 세미나실 {없는것}",
    );
    expect(fillTemplate("{신청번호}", {})).toBe("{신청번호}");
  });

  it("--- 줄로 나누고 첫 줄을 이름으로 쓴다", () => {
    const list = parseMessageTemplates("일정 중복\n다른 일정과 겹칩니다.\n\n둘째 문단\n---\n\n신청 기한\n7일 전까지 신청하세요.\n----\n이름만 있음\n---\n");
    expect(list).toEqual([
      { title: "일정 중복", body: "다른 일정과 겹칩니다.\n\n둘째 문단" },
      { title: "신청 기한", body: "7일 전까지 신청하세요." },
    ]);
    expect(parseMessageTemplates("")).toEqual([]);
  });

  it("첫 줄은 제목, 나머지는 본문", () => {
    expect(splitSubject("\n[전태일기념관] 세미나실 신청이 승인되었습니다.\n\n일자: x\n")).toEqual({ subject: "[전태일기념관] 세미나실 신청이 승인되었습니다.", body: "일자: x" });
  });
});
