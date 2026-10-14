import { and, eq, inArray, sql } from "drizzle-orm";
import { normalizeRegNo, isValidBusinessNoChecksum, type RegType } from "@/domain/organization/reg-no";
import { calculatePrice } from "@/domain/pricing/calculate";
import { kstDateOf, toKstLocalInput } from "@/lib/time";
import { toMinutes } from "@/domain/booking/time";
import { pgErrorCode } from "@/server/actor";
import { writeAudit } from "@/server/audit/log";
import { occupancyRange } from "@/server/booking/availability";
import { nextApplicationNo } from "@/server/booking/submit";
import { tstzRange } from "@/server/calendar/block-service";
import { applicationStatusHistory, applications, organizations, payments, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { getFeeScheduleAt } from "@/server/pricing/fee-service";
import { getSettings } from "@/server/settings/service";

/**
 * 노션 '대관 신청 목록'에서 신청을 가져온다 (pnpm import:notion).
 * - 공간 사용 희망일(시작일, KST)이 기준일 이후이고, 진행 중·승인 상태인 신청만 가져온다(반려·취소는 제외).
 * - 가져온 신청은 '입금 대기(미결제)'가 된다. 금액은 지금 요금표로 계산한다.
 *   자동 취소·입금 기한 알림은 하지 않고, 신청자에게 메일도 보내지 않는다. 담당자가 입금 확인(또는 반려)으로 처리한다.
 * - 노션 페이지 ID를 import_ref로 남겨, 다시 실행해도 중복되지 않는다.
 * - 기본은 미리보기(모든 처리를 한 트랜잭션에서 해 보고 되돌림). apply일 때만 저장한다.
 */

export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2025-09-03";
/** 가져올 노션 상태 (반려·취소는 제외) */
export const DEFAULT_IMPORT_STATUSES = ["승인", "접수 전", "검토 중", "결재 중", "보류"];
/** 노션 공간 이름 → 시스템 공간 코드 (공백은 무시하고 비교) */
export const NOTION_SPACE_CODES: Record<string, string> = {
  세미나실: "seminar",
  회의실1: "meeting1",
  회의실2: "meeting2",
  교육실: "education",
  다목적홀: "hall",
  공연장: "hall",
};
/** 이 범위를 벗어난 시각은 노션 입력 실수로 보고 건너뛴다(노션에서 고친 뒤 다시 실행) */
const EARLIEST = 7 * 60;
const LATEST = 23 * 60;

// ─── 노션 API 응답 모양 (쓰는 부분만) ─────────────────────────────

type RichText = { plain_text: string }[];
export type NotionProperty =
  | { type: "title"; title: RichText }
  | { type: "rich_text"; rich_text: RichText }
  | { type: "status"; status: { name: string } | null }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: { name: string }[] }
  | { type: "date"; date: { start: string; end: string | null } | null }
  | { type: "relation"; relation: { id: string }[] }
  | { type: "phone_number"; phone_number: string | null }
  | { type: "email"; email: string | null }
  | { type: "created_time"; created_time: string }
  | { type: string; [k: string]: unknown };

export interface NotionPage {
  id: string;
  url?: string;
  created_time?: string;
  properties: Record<string, NotionProperty>;
}

export interface NotionLookups {
  /** 공간 페이지 ID → 이름 */
  spaces: Map<string, string>;
  /** 단체 페이지 ID → 단체명·등록번호 */
  orgs: Map<string, { name: string; regNo: string }>;
}

const plain = (rt: RichText | undefined) => (rt ?? []).map((t) => t.plain_text).join("").trim();

export function propText(p: NotionProperty | undefined): string {
  if (!p) return "";
  switch (p.type) {
    case "title":
      return plain((p as { title: RichText }).title);
    case "rich_text":
      return plain((p as { rich_text: RichText }).rich_text);
    case "phone_number":
      return ((p as { phone_number: string | null }).phone_number ?? "").trim();
    case "email":
      return ((p as { email: string | null }).email ?? "").trim();
    case "status":
      return (p as { status: { name: string } | null }).status?.name ?? "";
    case "select":
      return (p as { select: { name: string } | null }).select?.name ?? "";
    default:
      return "";
  }
}
const propDate = (p: NotionProperty | undefined) => (p?.type === "date" ? ((p as { date: { start: string; end: string | null } | null }).date ?? null) : null);
const propRelation = (p: NotionProperty | undefined) => (p?.type === "relation" ? (p as { relation: { id: string }[] }).relation.map((r) => r.id) : []);
const propMulti = (p: NotionProperty | undefined) => (p?.type === "multi_select" ? (p as { multi_select: { name: string }[] }).multi_select.map((o) => o.name) : []);
const hasTime = (iso: string | null | undefined): boolean => Boolean(iso && iso.length > 10);
const compact = (s: string) => s.replace(/\s+/g, "");

/** '20명 내외', '10~15 명', '50여명' → 가장 큰 숫자. 없으면 1 */
export function parseHeadcount(raw: string): number {
  const nums = (raw.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n <= 10000);
  return nums.length ? Math.max(...nums) : 1;
}

/** 등록번호 종류 추정: 가운데 두 자리가 80·89면 고유번호(비영리), 검증번호가 맞으면 사업자등록번호 */
export function guessRegNo(raw: string): { regType: RegType; regNo: string } | null {
  const digits = normalizeRegNo(raw).replace(/\D/g, "");
  if (!/^\d{10}$/.test(digits)) return null;
  const mid = digits.slice(3, 5);
  if (mid === "80" || mid === "89") return { regType: "unique_no", regNo: digits };
  return { regType: isValidBusinessNoChecksum(digits) ? "business_no" : "unique_no", regNo: digits };
}

// ─── 노션 페이지 → 가져올 신청 ────────────────────────────────────

export interface ImportCandidate {
  ref: string;
  notionUrl: string;
  notionStatus: string;
  title: string;
  spaceId: string;
  spaceName: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  startsAt: Date;
  endsAt: Date;
  orgName: string;
  org: { regType: RegType; regNo: string } | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  headcount: number;
  equipment: string[];
  submittedAt: Date;
  /** 미리보기에 보여 줄 보정 내용 */
  notes: string[];
}

export type MapOutcome =
  | { ok: true; items: ImportCandidate[] }
  | { ok: false; ignored: boolean; title: string; notionUrl: string; date: string | null; reason: string };

type AppSpace = { id: string; code: string; name: string };

export function findSpace(notionName: string, appSpaces: readonly AppSpace[]): AppSpace | null {
  const n = compact(notionName);
  if (!n) return null;
  const code = NOTION_SPACE_CODES[n];
  return appSpaces.find((s) => s.code === code) ?? appSpaces.find((s) => compact(s.name) === n || compact(s.name).includes(n)) ?? null;
}

export function mapNotionPage(
  page: NotionPage,
  lookups: NotionLookups,
  appSpaces: readonly AppSpace[],
  opts: { since: string; statuses: readonly string[]; excludeTitlePrefixes?: readonly string[] },
): MapOutcome {
  const p = page.properties;
  const title = propText(p["행사/공연명"]) || "(행사명 없음)";
  const notionUrl = page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`;
  const start = propDate(p["시작일"]);
  const date = start && hasTime(start.start) ? kstDateOf(new Date(start.start)) : (start?.start?.slice(0, 10) ?? null);
  const skip = (reason: string, ignored = false): MapOutcome => ({ ok: false, ignored, title, notionUrl, date, reason });

  if (!date || date < opts.since) return skip(`희망일이 ${opts.since} 이전`, true);
  const status = propText(p["상태"]) || "접수 전";
  if (!opts.statuses.includes(status)) return skip(`노션 상태 '${status}'는 가져오지 않음`, true);
  const excluded = (opts.excludeTitlePrefixes ?? []).find((prefix) => title.startsWith(prefix));
  if (excluded) return skip(`행사명이 '${excluded}'로 시작해 제외`, true);
  if (!start || !hasTime(start.start)) return skip("시작 시각이 없습니다(날짜만 있음)");

  const endDate = propDate(p["종료일"]);
  const endIso = endDate && hasTime(endDate.start) ? endDate.start : hasTime(start.end) ? start.end : null;
  if (!endIso) return skip("종료 시각이 없습니다");
  const startsAt = new Date(start.start);
  let endsAt = new Date(endIso);
  const s = toKstLocalInput(startsAt);
  let e = toKstLocalInput(endsAt);
  const notes: string[] = [];
  if (e.slice(0, 10) !== date) {
    // 종료일에 시각만 맞고 날짜가 다른 경우가 많다(예: 신청한 날짜) → 시작일 날짜에 종료 시각을 붙인다
    const fixed = new Date(`${date}T${e.slice(11)}:00+09:00`);
    if (fixed <= startsAt) return skip(`종료일(${e.replace("T", " ")})이 시작일과 다른 날이고, 시각도 시작보다 이릅니다. 노션 시각을 확인하세요`);
    notes.push(`종료일 날짜(${e.slice(0, 10)})가 시작일과 달라 ${date} ${e.slice(11)}로 맞췄습니다`);
    endsAt = fixed;
    e = toKstLocalInput(fixed);
  }
  if (endsAt <= startsAt) return skip(`종료(${e.slice(11)})가 시작(${s.slice(11)})보다 이르거나 같습니다`);
  const startMinutes = toMinutes(s.slice(11));
  const endMinutes = toMinutes(e.slice(11));
  if (startMinutes < EARLIEST || endMinutes > LATEST) return skip(`이용 시각이 07:00~23:00 밖입니다(${s.slice(11)}~${e.slice(11)}). 노션 시각을 확인하세요`);

  const spaceNames = propRelation(p["신청공간"]).map((id) => lookups.spaces.get(id) ?? "");
  if (spaceNames.length === 0) return skip("신청공간이 비어 있습니다");
  const matched: AppSpace[] = [];
  for (const name of spaceNames) {
    const space = findSpace(name, appSpaces);
    if (!space) return skip(`시스템에 없는 공간: '${name || "(이름 없음)"}'`);
    if (!matched.some((m) => m.id === space.id)) matched.push(space);
  }

  const orgPage = propRelation(p["신청단체"]).map((id) => lookups.orgs.get(id)).find(Boolean);
  const contactName = propText(p["신청자"]);
  const orgName = orgPage?.name || contactName || "(단체명 없음)";
  const registered = propDate(p["신청등록일"])?.start;
  const submittedAt = registered ? new Date(hasTime(registered) ? registered : `${registered.slice(0, 10)}T09:00:00+09:00`) : new Date(page.created_time ?? Date.now());
  const base = {
    notionUrl,
    notionStatus: status,
    title,
    date,
    startMinutes,
    endMinutes,
    startsAt,
    endsAt,
    orgName,
    org: orgPage?.regNo ? guessRegNo(orgPage.regNo) : null,
    contactName: contactName || orgName,
    contactPhone: propText(p["연락처"]).replace(/[^\d]/g, ""),
    contactEmail: propText(p["이메일"]).toLowerCase(),
    headcount: parseHeadcount(propText(p["인원"])),
    equipment: propMulti(p["신청기기"]),
    submittedAt,
    notes,
  };
  // 공간을 여러 개 고른 신청은 공간마다 하나씩 만든다
  return {
    ok: true,
    items: matched.map((sp) => ({ ...base, ref: matched.length > 1 ? `notion:${page.id}#${sp.code}` : `notion:${page.id}`, spaceId: sp.id, spaceName: sp.name })),
  };
}

// ─── 가져오기 ────────────────────────────────────────────────────

export interface ImportReport {
  applied: boolean;
  fetched: number;
  created: { applicationNo: string; title: string; spaceName: string; when: string; orgName: string; amount: number; notionStatus: string; warnings: string[] }[];
  existing: { applicationNo: string; title: string; when: string }[];
  skipped: { title: string; date: string | null; reason: string; notionUrl: string }[];
  conflicts: { title: string; spaceName: string; when: string; with: string; notionUrl: string }[];
  ignored: number;
}

class DryRunRollback extends Error {}

const when = (c: { date: string; startMinutes: number; endMinutes: number }) =>
  `${c.date} ${String(Math.floor(c.startMinutes / 60)).padStart(2, "0")}:${String(c.startMinutes % 60).padStart(2, "0")}~${String(Math.floor(c.endMinutes / 60)).padStart(2, "0")}:${String(c.endMinutes % 60).padStart(2, "0")}`;

export async function importNotionBookings(
  db: Db,
  pages: readonly NotionPage[],
  lookups: NotionLookups,
  opts: { since: string; statuses?: readonly string[]; excludeTitlePrefixes?: readonly string[]; apply: boolean; now?: Date },
): Promise<ImportReport> {
  const now = opts.now ?? new Date();
  const statuses = opts.statuses ?? DEFAULT_IMPORT_STATUSES;
  const report: ImportReport = { applied: opts.apply, fetched: pages.length, created: [], existing: [], skipped: [], conflicts: [], ignored: 0 };
  const spaceRows = await db.select().from(spaces);

  const candidates: ImportCandidate[] = [];
  for (const page of pages) {
    const r = mapNotionPage(page, lookups, spaceRows, { since: opts.since, statuses, excludeTitlePrefixes: opts.excludeTitlePrefixes });
    if (r.ok) candidates.push(...r.items);
    else if (r.ignored) report.ignored += 1;
    else report.skipped.push({ title: r.title, date: r.date, reason: r.reason, notionUrl: r.notionUrl });
  }
  candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  try {
    await db.transaction(async (tx) => {
      const settings = await getSettings(tx, now);
      const dayEnd = toMinutes(settings["operation.dayEnd"]);
      const fee = await getFeeScheduleAt(tx, now);
      const refs = candidates.map((c) => c.ref);
      const already = refs.length
        ? await tx.select({ ref: applications.importRef, no: applications.applicationNo }).from(applications).where(inArray(applications.importRef, refs))
        : [];
      const existingNo = new Map(already.map((a) => [a.ref, a.no]));

      for (const c of candidates) {
        const no = existingNo.get(c.ref);
        if (no) {
          report.existing.push({ applicationNo: no, title: c.title, when: when(c) });
          continue;
        }
        const space = spaceRows.find((s) => s.id === c.spaceId)!;
        const spaceFee = fee?.items.spaces[space.id];
        const price = spaceFee ? calculatePrice({ fee: spaceFee, startMinutes: c.startMinutes, endMinutes: c.endMinutes, dayEndMinutes: dayEnd }) : null;
        const amount = price?.total ?? 0;
        const range = occupancyRange(space, c.date, c.startMinutes, c.endMinutes);
        try {
          // 행마다 저장점: 겹치는 일정이 있으면 그 행만 되돌리고 계속한다
          const applicationNo = await tx.transaction(async (sp) => {
            let organizationId: string | null = null;
            if (c.org) {
              const [org] = await sp
                .insert(organizations)
                .values({ regType: c.org.regType, regNo: c.org.regNo, latestName: c.orgName })
                .onConflictDoUpdate({ target: organizations.regNo, set: { latestName: c.orgName } })
                .returning({ id: organizations.id });
              organizationId = org!.id;
            }
            const applicationNo = await nextApplicationNo(sp, now);
            const [app] = await sp
              .insert(applications)
              .values({
                applicationNo,
                status: "pending_payment",
                spaceId: space.id,
                organizationId,
                orgName: c.orgName,
                contactName: c.contactName,
                contactPhone: c.contactPhone,
                contactEmail: c.contactEmail,
                eventTitle: c.title,
                eventPurpose: `노션 대관 신청 목록에서 가져온 신청입니다(원본 상태: ${c.notionStatus}).${c.equipment.length ? `\n신청 기기: ${c.equipment.join(", ")}` : ""}\n원본: ${c.notionUrl}`,
                expectedHeadcount: c.headcount,
                startsAt: c.startsAt,
                endsAt: c.endsAt,
                priceSnapshot: price,
                policySnapshot: { import: { source: "notion", notionStatus: c.notionStatus, url: c.notionUrl, importedAt: now.toISOString() }, feeScheduleId: fee?.id ?? null },
                totalAmount: amount,
                submittedAt: c.submittedAt,
                importRef: c.ref,
                createdAt: now,
                updatedAt: now,
              })
              .returning({ id: applications.id });
            // 입금 기한은 이용 시작 시각으로 표시만 한다(가져온 신청은 자동 취소하지 않음)
            await sp.insert(slotOccupancies).values({ spaceId: space.id, during: tstzRange(range.from, range.to), kind: "pending_payment", applicationId: app!.id, expiresAt: c.startsAt });
            await sp.insert(payments).values({ applicationId: app!.id, orderId: `${applicationNo}-import`, method: "bank_transfer", amount, status: "ready", createdAt: now, updatedAt: now });
            await sp.insert(applicationStatusHistory).values({
              applicationId: app!.id,
              fromStatus: null,
              toStatus: "pending_payment",
              actorType: "system",
              reason: `노션에서 가져옴(원본 상태: ${c.notionStatus})`,
              createdAt: now,
            });
            return applicationNo;
          });
          report.created.push({
            applicationNo,
            title: c.title,
            spaceName: space.name,
            when: when(c),
            orgName: c.orgName,
            amount,
            notionStatus: c.notionStatus,
            warnings: [...c.notes, ...(spaceFee ? [] : ["요금표가 없어 0원으로 넣었습니다"])],
          });
        } catch (e) {
          if (pgErrorCode(e) !== "23P01") throw e;
          const [hit] = await tx
            .select({ no: applications.applicationNo, title: applications.eventTitle, kind: slotOccupancies.kind })
            .from(slotOccupancies)
            .leftJoin(applications, eq(applications.id, slotOccupancies.applicationId))
            .where(
              and(
                eq(slotOccupancies.spaceId, space.id),
                sql`${slotOccupancies.during} && tstzrange(${range.from.toISOString()}::timestamptz, ${range.to.toISOString()}::timestamptz, '[)')`,
              ),
            )
            .limit(1);
          report.conflicts.push({
            title: c.title,
            spaceName: space.name,
            when: when(c),
            with: hit?.no ? `${hit.no} ${hit.title}` : hit?.kind === "block" ? "기념관 일정 차단" : "다른 일정",
            notionUrl: c.notionUrl,
          });
        }
      }
      if (opts.apply && report.created.length > 0) {
        await writeAudit(tx, {
          actorType: "system",
          action: "application.imported",
          targetType: "import",
          targetId: "notion",
          after: { since: opts.since, created: report.created.length, conflicts: report.conflicts.length, skipped: report.skipped.length },
          reason: "노션 대관 신청 목록 가져오기",
        });
      }
      if (!opts.apply) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}

// ─── 노션 API에서 읽기 ───────────────────────────────────────────

async function notionFetch<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429 && attempt < 5) {
    const wait = Number(res.headers.get("retry-after") ?? "1") * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
    return notionFetch(token, path, init, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " — NOTION_TOKEN을 확인하세요."
        : res.status === 404
          ? " — 토큰을 만든 사람이 이 데이터베이스를 볼 수 있는지(개인 액세스 토큰), 또는 내부 연결이 대관 신청 목록·공간·단체 데이터베이스에 추가되어 있는지(••• → 연결 추가) 확인하세요."
          : "";
    throw new Error(`노션 API ${res.status} ${path}${hint}\n${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** 시작일이 기준일 하루 전 이후인 페이지를 모두 읽는다(KST 날짜 판단은 mapNotionPage에서) */
export async function fetchNotionPages(token: string, dataSourceId: string, since: string): Promise<NotionPage[]> {
  const after = new Date(`${since}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() - 1);
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const body = { page_size: 100, start_cursor: cursor, filter: { property: "시작일", date: { on_or_after: after.toISOString().slice(0, 10) } } };
    const res = await notionFetch<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(token, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

/** 신청공간·신청단체 관계 페이지의 이름(과 등록번호)을 읽는다 */
export async function fetchNotionLookups(token: string, pages: readonly NotionPage[]): Promise<NotionLookups> {
  const spaceIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const page of pages) {
    for (const id of propRelation(page.properties["신청공간"])) spaceIds.add(id);
    for (const id of propRelation(page.properties["신청단체"])) orgIds.add(id);
  }
  const lookups: NotionLookups = { spaces: new Map(), orgs: new Map() };
  const titleOf = (page: NotionPage) => propText(Object.values(page.properties).find((v) => v.type === "title"));
  for (const id of spaceIds) lookups.spaces.set(id, titleOf(await notionFetch<NotionPage>(token, `/pages/${id}`)));
  for (const id of orgIds) {
    const page = await notionFetch<NotionPage>(token, `/pages/${id}`);
    lookups.orgs.set(id, { name: titleOf(page), regNo: propText(page.properties["사업자등록/고유번호"]) });
  }
  return lookups;
}
