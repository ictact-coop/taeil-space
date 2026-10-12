import type { NotionLookups, NotionPage } from "@/server/import/notion";

/** 노션 API 응답 모양의 테스트용 대관 신청 페이지 */
export function notionPage(p: {
  id: string;
  title: string;
  status?: string;
  start: string | null;
  end?: string | null;
  spaces?: string[];
  org?: string;
  applicant?: string;
  phone?: string;
  email?: string;
  headcount?: string;
  equipment?: string[];
  registered?: string;
}): NotionPage {
  return {
    id: p.id,
    url: `https://www.notion.so/${p.id}`,
    created_time: "2026-09-01T00:00:00.000Z",
    properties: {
      "행사/공연명": { type: "title", title: [{ plain_text: p.title }] },
      상태: { type: "status", status: { name: p.status ?? "승인" } },
      시작일: { type: "date", date: p.start ? { start: p.start, end: null } : null },
      종료일: { type: "date", date: p.end ? { start: p.end, end: null } : null },
      신청공간: { type: "relation", relation: (p.spaces ?? ["sp-seminar"]).map((id) => ({ id })) },
      신청단체: { type: "relation", relation: p.org ? [{ id: p.org }] : [] },
      신청자: { type: "rich_text", rich_text: p.applicant ? [{ plain_text: p.applicant }] : [] },
      연락처: { type: "phone_number", phone_number: p.phone ?? "010-1234-5678" },
      이메일: { type: "email", email: p.email ?? "a@example.org" },
      인원: { type: "rich_text", rich_text: [{ plain_text: p.headcount ?? "10" }] },
      신청기기: { type: "multi_select", multi_select: (p.equipment ?? []).map((name) => ({ name })) },
      신청등록일: { type: "date", date: p.registered ? { start: p.registered, end: null } : null },
    },
  };
}

export const notionLookups: NotionLookups = {
  spaces: new Map([
    ["sp-seminar", "세미나실"],
    ["sp-meeting1", "회의실 1"],
    ["sp-hall", "다목적홀"],
    ["sp-edu", "교육실"],
    ["sp-etc", "기타공간"],
  ]),
  orgs: new Map([
    ["org-union", { name: "○○노동조합", regNo: "123-82-87650" }],
    ["org-typo", { name: "△△교사모임", regNo: "105-+80-12345" }],
    ["org-none", { name: "□□연구소", regNo: "무" }],
  ]),
};
