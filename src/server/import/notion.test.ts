import { describe, expect, it } from "vitest";
import { notionLookups, notionPage } from "../../../tests/fixtures/notion";
import { findSpace, guessRegNo, mapNotionPage, parseHeadcount } from "./notion";

const appSpaces = [
  { id: "s1", code: "seminar", name: "세미나실" },
  { id: "s2", code: "meeting1", name: "회의실1" },
  { id: "s3", code: "meeting2", name: "회의실2" },
  { id: "s4", code: "education", name: "교육실" },
  { id: "s5", code: "hall", name: "공연장(다목적홀)" },
];
const opts = { since: "2026-10-15", statuses: ["승인", "접수 전"] };
const map = (p: Parameters<typeof notionPage>[0]) => mapNotionPage(notionPage(p), notionLookups, appSpaces, opts);

describe("노션 대관 신청 → 시스템 신청", () => {
  it("승인 건: KST 날짜·시각, 공간·단체·인원·연락처를 옮긴다", () => {
    const r = map({
      id: "p1", title: "노동조합 교육", start: "2026-10-15T01:00:00.000Z", end: "2026-10-15T03:30:00.000Z",
      spaces: ["sp-hall"], org: "org-union", applicant: "홍길동", phone: "010-1111-2222", email: "A@Example.org", headcount: "20명 내외",
      equipment: ["무선 마이크"], registered: "2026-08-10",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      ref: "notion:p1", spaceId: "s5", date: "2026-10-15", startMinutes: 600, endMinutes: 750, orgName: "○○노동조합",
      org: { regType: "business_no", regNo: "1238287650" }, contactName: "홍길동", contactPhone: "01011112222", contactEmail: "a@example.org",
      headcount: 20, equipment: ["무선 마이크"], notionStatus: "승인",
    });
    expect(r.items[0]!.submittedAt.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("기준일 이전(KST)·반려·취소는 대상에서 뺀다", () => {
    // UTC로는 10/14 15:30이지만 KST로는 10/15 00:30 → 시각 범위 밖이라 확인 필요로 분류
    expect(map({ id: "a", title: "x", start: "2026-10-14T15:30:00Z", end: "2026-10-14T16:30:00Z" })).toMatchObject({ ok: false, ignored: false });
    expect(map({ id: "b", title: "x", start: "2026-10-14T05:00:00Z", end: "2026-10-14T06:00:00Z" })).toMatchObject({ ok: false, ignored: true });
    expect(map({ id: "c", title: "x", status: "반려", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z" })).toMatchObject({ ok: false, ignored: true });
    expect(map({ id: "d", title: "x", status: "취소", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z" })).toMatchObject({ ok: false, ignored: true });
    expect(map({ id: "e", title: "x", status: "접수 전", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z" }).ok).toBe(true);
    // 행사명 앞머리로 제외(예: 기념관 자체 행사 [기])
    const own = notionPage({ id: "f", title: "[기]노동인권교육", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z" });
    expect(mapNotionPage(own, notionLookups, appSpaces, { ...opts, excludeTitlePrefixes: ["[기]"] })).toMatchObject({ ok: false, ignored: true });
    expect(mapNotionPage(own, notionLookups, appSpaces, opts).ok).toBe(true);
  });

  it("입력 실수로 보이는 시각·공간은 사유와 함께 건너뛴다", () => {
    const reason = (p: Parameters<typeof notionPage>[0]) => {
      const r = map(p);
      return r.ok ? null : r.reason;
    };
    expect(reason({ id: "1", title: "x", start: "2026-10-20", end: null })).toContain("시작 시각");
    expect(reason({ id: "2", title: "x", start: "2026-10-20T05:00:00Z", end: null })).toContain("종료 시각");
    expect(reason({ id: "3", title: "x", start: "2026-10-24T09:00:00Z", end: "2026-10-24T00:00:00Z" })).toContain("이르거나");
    expect(reason({ id: "4", title: "x", start: "2026-10-17T05:00:00Z", end: "2026-07-31T04:00:00Z" })).toContain("다른 날");
    expect(reason({ id: "5", title: "x", start: "2026-10-20T13:00:00Z", end: "2026-10-20T14:30:00Z" })).toContain("07:00~23:00");
    expect(reason({ id: "6", title: "x", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z", spaces: ["sp-etc"] })).toContain("'라운지 숨:' 공간이 없음");
    expect(reason({ id: "7", title: "x", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z", spaces: [] })).toContain("비어");
  });

  it("종료일 날짜만 다르면 시작일 날짜에 종료 시각을 붙이고 알려 준다", () => {
    const r = map({ id: "fix", title: "강의", start: "2026-12-10T04:00:00Z", end: "2026-07-31T05:00:00Z" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items[0]).toMatchObject({ startMinutes: 780, endMinutes: 840 });
    expect(r.items[0]!.endsAt.toISOString()).toBe("2026-12-10T05:00:00.000Z");
    expect(r.items[0]!.notes[0]).toContain("2026-07-31");
  });

  it("공간이 여러 개면 공간마다 한 건씩", () => {
    const r = map({ id: "multi", title: "체험교육", start: "2026-10-28T06:30:00Z", end: "2026-10-28T08:00:00Z", spaces: ["sp-hall", "sp-edu"] });
    expect(r.ok && r.items.map((i) => [i.ref, i.spaceId])).toEqual([
      ["notion:multi#hall", "s5"],
      ["notion:multi#education", "s4"],
    ]);
  });

  it("보조 함수: 인원·등록번호·공간 이름", () => {
    expect(parseHeadcount("10~15 명")).toBe(15);
    expect(parseHeadcount("50여명")).toBe(50);
    expect(parseHeadcount("")).toBe(1);
    expect(guessRegNo("105-+80-12345")).toEqual({ regType: "unique_no", regNo: "1058012345" });
    expect(guessRegNo("123-82-87650")).toEqual({ regType: "business_no", regNo: "1238287650" }); // 검증번호가 맞는 비영리법인 번호
    expect(guessRegNo("무")).toBeNull();
    expect(findSpace("회의실 1", appSpaces)?.code).toBe("meeting1");
    expect(findSpace("다목적홀", appSpaces)?.code).toBe("hall");
    // 노션 '기타공간'은 시스템의 '라운지 숨:' 공간으로 (공백·문장부호 무시). 그 공간이 없으면 건너뛴다
    expect(findSpace("기타공간", appSpaces)).toBeNull();
    const withLounge = [...appSpaces, { id: "s6", code: "lounge", name: "라운지 숨:" }];
    expect(findSpace("기타공간", withLounge)?.code).toBe("lounge");
    expect(findSpace("기타 공간", [...appSpaces, { id: "s7", code: "x", name: "라운지숨" }])?.code).toBe("x");
    expect(findSpace("세미나실", withLounge)?.code).toBe("seminar");
    const r = mapNotionPage(notionPage({ id: "etc", title: "x", start: "2026-10-20T05:00:00Z", end: "2026-10-20T06:00:00Z", spaces: ["sp-etc"] }), notionLookups, withLounge, opts);
    expect(r.ok && r.items.map((i) => i.spaceId)).toEqual(["s6"]);
  });
});
