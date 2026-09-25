import { and, eq, gte } from "drizzle-orm";
import { getDefinition, settingKeys } from "@/domain/settings/definitions";
import { resolveAll } from "@/domain/settings/resolve";
import { kstDateOf, kstStartOfDay } from "@/lib/time";
import { closureRules, spaces } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/types";
import { getBookingWindowView, listWindowSpaces } from "@/server/calendar/booking-window-service";
import { getFeeScheduleAt } from "@/server/pricing/fee-service";
import { loadPolicyRows } from "./service";

export interface ReadinessItem {
  id: string;
  label: string;
  state: "ok" | "todo" | "confirm";
  detail: string;
  href: string;
  /** state가 confirm이면 이 설정 키를 "현재 값으로 확정"할 수 있다 */
  settingKey?: string;
}

/**
 * 오픈 전 필수 값 점검 (계획서 6장 ★).
 * - todo: 값이 아예 없어 오픈할 수 없음
 * - confirm: 제안 기본값을 쓰고 있어 기념관의 확정이 필요함
 */
export async function computeReadiness(db: DbOrTx, now: Date = new Date()): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = [];
  const { values, resolved } = resolveAll(await loadPolicyRows(db), now);
  const openAt = kstStartOfDay(values["operation.paidRentalStartDate"]);

  // 요금표: 유료 전환일에 적용될 요금표가 있어야 한다
  const fee = await getFeeScheduleAt(db, openAt > now ? openAt : now);
  const publicSpaces = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.isPublic, true));
  const feeCovers = fee !== null && publicSpaces.every((s) => fee.items.spaces[s.id]);
  items.push({
    id: "fees",
    label: "공간별 요금표 (P-01)",
    state: feeCovers ? "ok" : "todo",
    detail: feeCovers ? `유료 전환일(${values["operation.paidRentalStartDate"]})에 적용될 요금표가 있습니다.` : "유료 전환일에 적용될 요금표가 없거나 일부 공간이 빠졌습니다.",
    href: "/admin/settings/fees",
  });

  // 오픈 전 필수 설정
  for (const key of settingKeys) {
    const def = getDefinition(key);
    if (!def.requiredBeforeOpen) continue;
    const r = resolved[key];
    const empty = Array.isArray(r.value) && r.value.length === 0;
    items.push({
      id: key,
      label: `${def.label}${def.refs?.[0] ? ` (${def.refs[0]})` : ""}`,
      state: empty ? "todo" : r.source === "stored" ? "ok" : "confirm",
      detail: empty ? "값이 입력되지 않았습니다." : `${def.format(r.value as never)}${r.source === "default" ? " — 제안 기본값" : ""}`,
      href: `/admin/settings/${def.group}`,
      settingKey: empty ? undefined : key,
    });
  }

  // 접수기간 공간: 수동 방식이면 공개된 기간이 있어야 한다
  for (const space of await listWindowSpaces(db)) {
    if (!space.isPublic) continue;
    const view = await getBookingWindowView(db, space.id, now);
    items.push({
      id: `window-${space.id}`,
      label: `${space.name} 접수기간 (P-08)`,
      state: view.effective ? "ok" : "todo",
      detail: view.effective ? `${view.effective.from} ~ ${view.effective.until} 접수` : "공개된 접수기간이 없어 신청을 받을 수 없습니다.",
      href: "/admin/settings/booking-windows",
    });
  }

  // 해마다 바뀌는 휴관일(설·추석 등)
  const upcoming = await db
    .select({ id: closureRules.id })
    .from(closureRules)
    .where(and(eq(closureRules.isActive, true), eq(closureRules.type, "date_range"), gte(closureRules.endDate, kstDateOf(now))))
    .limit(1);
  items.push({
    id: "closures",
    label: "설·추석 등 날짜가 바뀌는 휴관일 (BR-01)",
    state: upcoming.length > 0 ? "ok" : "confirm",
    detail: upcoming.length > 0 ? "앞으로 적용될 특정 날짜 휴관 규칙이 있습니다." : "앞으로 적용될 특정 날짜 휴관 규칙이 없습니다. 설·추석 등을 등록했는지 확인하세요.",
    href: "/admin/settings/closures",
  });

  return items;
}
