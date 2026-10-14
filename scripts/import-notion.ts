/**
 * 노션 '대관 신청 목록'에서 신청 가져오기. 자세한 절차는 docs/NOTION_IMPORT.md.
 *   pnpm import:notion                        미리보기(저장하지 않음)
 *   pnpm import:notion --apply                저장
 *   pnpm import:notion --since 2026-10-15     공간 사용 희망일 기준일(KST, 기본 2026-10-15)
 *   pnpm import:notion --status "승인,접수 전"  가져올 노션 상태(기본: 승인·접수 전·검토 중·결재 중·보류)
 *   pnpm import:notion --exclude "[기]"        행사명이 이 말로 시작하면 제외(쉼표로 여러 개, 예: 기념관 자체 행사)
 *   pnpm import:notion --file pages.json      노션 API 대신 저장해 둔 응답(JSON)으로
 * 환경변수: DATABASE_URL, NOTION_TOKEN(노션 개인 액세스 토큰 또는 내부 연결 토큰), NOTION_DATA_SOURCE_ID(기본: 대관 신청 목록)
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDb } from "../src/server/db/connect";
import { DEFAULT_IMPORT_STATUSES, fetchNotionLookups, fetchNotionPages, importNotionBookings, type NotionLookups, type NotionPage } from "../src/server/import/notion";

const DEFAULT_DATA_SOURCE = "3669b99c-27e2-804f-ab17-000b3670fc66";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    since: { type: "string", default: "2026-10-15" },
    status: { type: "string" },
    file: { type: "string" },
    exclude: { type: "string" },
  },
});

if (!/^\d{4}-\d{2}-\d{2}$/.test(values.since ?? "")) {
  console.error("--since는 YYYY-MM-DD 형식입니다.");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}
const excludeTitlePrefixes = values.exclude ? values.exclude.split(",").map((s) => s.trim()).filter(Boolean) : [];
const statuses = values.status ? values.status.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_IMPORT_STATUSES;

let pages: NotionPage[];
let lookups: NotionLookups;
if (values.file) {
  // { pages: [...], lookups: { spaces: {id: 이름}, orgs: {id: {name, regNo}} } }
  const raw = JSON.parse(readFileSync(values.file, "utf8")) as { pages: NotionPage[]; lookups: { spaces: Record<string, string>; orgs: Record<string, { name: string; regNo: string }> } };
  pages = raw.pages;
  lookups = { spaces: new Map(Object.entries(raw.lookups.spaces)), orgs: new Map(Object.entries(raw.lookups.orgs)) };
} else {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN 환경변수가 필요합니다(노션 개인 액세스 토큰 또는 내부 연결 토큰, docs/NOTION_IMPORT.md).");
    process.exit(1);
  }
  const dataSource = process.env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE;
  console.log(`노션에서 읽는 중… (기준일 ${values.since})`);
  pages = await fetchNotionPages(token, dataSource, values.since!);
  lookups = await fetchNotionLookups(token, pages);
}

const { db, pool } = createDb(url);
try {
  const r = await importNotionBookings(db, pages, lookups, { since: values.since!, statuses, excludeTitlePrefixes, apply: values.apply });
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
  console.log(`\n${r.applied ? "■ 저장했습니다" : "■ 미리보기 (저장하지 않음 — 저장하려면 --apply)"}`);
  console.log(`노션 ${r.fetched}건 중 대상 아님(기준일 이전·반려·취소${excludeTitlePrefixes.length ? `·제외 행사명(${excludeTitlePrefixes.join(", ")})` : ""}) ${r.ignored}건\n`);
  console.log(`${r.applied ? "가져온" : "가져올"} 신청 ${r.created.length}건 → 입금 대기(미결제)`);
  for (const c of r.created) console.log(`  ${c.applicationNo}  ${c.when}  ${c.spaceName}  ${c.orgName} / ${c.title}  ${won(c.amount)}  [노션: ${c.notionStatus}]${c.warnings.map((w) => `\n      ⚠ ${w}`).join("")}`);
  if (r.existing.length) {
    console.log(`\n이미 가져온 신청 ${r.existing.length}건(건너뜀)`);
    for (const e of r.existing) console.log(`  ${e.applicationNo}  ${e.when}  ${e.title}`);
  }
  if (r.conflicts.length) {
    console.log(`\n일정이 겹쳐 못 가져온 신청 ${r.conflicts.length}건 — 겹치면 노션에서 '승인'된 신청을 먼저 가져옵니다. 노션에서 중복·시간을 확인하세요`);
    for (const c of r.conflicts) console.log(`  ${c.when}  ${c.spaceName}  ${c.title} [노션: ${c.notionStatus}]  ↔ ${c.with}\n    ${c.notionUrl}`);
  }
  if (r.skipped.length) {
    console.log(`\n확인이 필요해 건너뛴 신청 ${r.skipped.length}건 — 노션에서 고친 뒤 다시 실행하면 이어서 가져옵니다`);
    for (const s of r.skipped) console.log(`  ${s.date ?? "날짜 없음"}  ${s.title}: ${s.reason}\n    ${s.notionUrl}`);
  }
  if (!r.applied) console.log("\n문제가 없으면 같은 명령에 --apply를 붙여 저장하세요.");
} finally {
  await pool.end();
}
