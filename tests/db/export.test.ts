import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/actor";
import { listApplicationsForAdmin, listApplicationsForExport } from "@/server/applications/admin-queries";
import { applicationsCsv, receiptsCsv } from "@/server/applications/export";
import { confirmDeposit } from "@/server/applications/review";
import { newUploadToken } from "@/server/booking/attachments";
import { submitApplication } from "@/server/booking/submit";
import { applications, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { saveFeeSchedule } from "@/server/pricing/fee-service";
import { setStorageForTest } from "@/server/storage/storage";
import { createTestAdmin, createTestSpace, hasTestDb, resetTestDb } from "../helpers/db";

const now = new Date("2026-10-29T01:00:00Z");

describe.skipIf(!hasTestDb)("신청 내려받기", () => {
  let db: Db;
  let close: () => Promise<void>;
  let rental: Actor;
  let room: typeof spaces.$inferSelect;
  let hall: typeof spaces.$inferSelect;
  let storageDir: string;

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "memory";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "taeil-exp-"));
    process.env.STORAGE_DIR = storageDir;
    setStorageForTest(null);
    ({ db, close } = await resetTestDb());
    const system = (await createTestAdmin(db, "system")).actor;
    rental = (await createTestAdmin(db, "rental")).actor;
    room = await createTestSpace(db, { name: "세미나실", capacity: 15, slotMinutes: 60, minDurationMinutes: 60 });
    hall = await createTestSpace(db, { name: "공연장", capacity: 60, slotMinutes: 60, minDurationMinutes: 60 });
    const fee = { baseMinutes: 120, baseFee: 55000, extraUnitMinutes: 60, extraFee: 11000, nightFeePerHour: 0 };
    const t = new Date("2026-10-01T00:00:00Z");
    await saveFeeSchedule(db, { actor: system, items: { spaces: { [room.id]: fee, [hall.id]: { ...fee, baseFee: 110000 } }, options: [] }, effectiveFrom: t, reason: "요금", now: t });
  });
  afterAll(async () => {
    await close?.();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function submit(spaceId: string, date: string, orgName: string, receipt: Record<string, string> = {}) {
    const r = await submitApplication(
      db,
      {
        spaceId, date, start: "10:00", end: "12:00", orgName, regType: "", regNo: "",
        contactName: "홍길동", contactPhone: "010-1234-5678", contactEmail: "exp@example.org", eventTitle: "=위험한 행사명",
        eventPurpose: "노동 인권을 주제로 한 시민 토론회를 엽니다, 발제와 자유토론으로 진행합니다.",
        expectedHeadcount: "10", discountRuleId: "", optionKeys: [],
        consents: ["privacy", "operationRules", "refundRules"], uploadToken: newUploadToken(), applicantPassword: "1234", applicantPasswordConfirm: "1234",
        ...receipt,
      },
      {},
      now,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    return (await db.select().from(applications).where(eq(applications.applicationNo, r.applicationNo)))[0]!;
  }

  it("목록 필터(탭·검색어·이용일·공간)를 내려받기에도 그대로 적용하고, 증빙 희망 건만 따로 내려받는다", async () => {
    const a = await submit(room.id, "2026-11-12", "가모임", { receiptType: "cash", cashPurpose: "income", cashNumber: "010-2222-3333" });
    const b = await submit(hall.id, "2026-11-20", "나모임", { receiptType: "tax_invoice", taxBizNo: "123-82-87650", taxCompany: "나협동조합", taxCeo: "김대표", taxEmail: "bill@example.org" });
    await submit(room.id, "2026-12-03", "다모임");
    expect(await confirmDeposit(db, { actor: rental, applicationId: b.id, approve: true, now })).toEqual({ ok: true });

    const all = await listApplicationsForExport(db, { tab: "all", q: "" });
    expect(all).toHaveLength(3);
    const nov = await listApplicationsForExport(db, { tab: "all", q: "", from: "2026-11-01", to: "2026-11-30" });
    expect(nov.map((r) => r.app.orgName).sort()).toEqual(["가모임", "나모임"]);
    expect((await listApplicationsForExport(db, { tab: "all", q: "", spaceId: hall.id })).map((r) => r.app.orgName)).toEqual(["나모임"]);
    expect((await listApplicationsForExport(db, { tab: "pending", q: "모임" })).map((r) => r.app.orgName).sort()).toEqual(["가모임", "다모임"]);
    // 화면 목록도 같은 필터
    expect((await listApplicationsForAdmin(db, { tab: "all", q: "", from: "2026-11-01", to: "2026-11-30", page: 1 })).total).toBe(2);
    // 잘못된 날짜는 무시
    expect(await listApplicationsForExport(db, { tab: "all", q: "", from: "2026-13-45" })).toHaveLength(3);

    const csv = applicationsCsv(all);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("신청번호,상태,공간,이용일");
    expect(csv).toContain("'=위험한 행사명");
    expect(csv).toContain('"노동 인권을 주제로 한 시민 토론회를 엽니다, 발제와 자유토론으로 진행합니다."');
    expect(csv).toContain("010-1234-5678");

    const rc = receiptsCsv(all).slice(1).trim().split("\r\n");
    expect(rc).toHaveLength(3); // 머리글 + 증빙 희망 2건
    const cash = rc.find((l) => l.startsWith("현금영수증"))!;
    expect(cash).toContain(a.applicationNo);
    expect(cash).toContain("소득공제,010-2222-3333");
    expect(cash).toContain("입금 전");
    const tax = rc.find((l) => l.startsWith("세금계산서"))!;
    expect(tax).toContain("123-82-87650,나협동조합,김대표,bill@example.org");
    expect(tax).toContain("110000,100000,10000");
  });
});
