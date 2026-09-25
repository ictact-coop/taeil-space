import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, auditLogs, policyValues, scheduleBlocks, slotOccupancies, spaces } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { hasTestDb, resetTestDb } from "../helpers/db";

/** Postgres 오류 코드 (drizzle이 감싼 오류의 cause까지 확인) */
function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
}

async function expectPgError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (e) {
    expect(pgCode(e)).toBe(code);
    return;
  }
  throw new Error(`Postgres 오류 ${code}가 나야 합니다.`);
}

describe.skipIf(!hasTestDb)("DB 제약", () => {
  let db: Db;
  let close: () => Promise<void>;
  let spaceA: string;
  let spaceB: string;

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    const rows = await db
      .insert(spaces)
      .values([
        { code: "a", name: "A", capacity: 10 },
        { code: "b", name: "B", capacity: 10 },
      ])
      .returning({ id: spaces.id });
    spaceA = rows[0]!.id;
    spaceB = rows[1]!.id;
  });
  afterAll(async () => close?.());

  let seq = 0;
  async function newApplication(spaceId: string) {
    seq += 1;
    const [app] = await db
      .insert(applications)
      .values({
        applicationNo: `T-${seq}`,
        spaceId,
        orgName: "단체",
        contactName: "담당",
        contactPhone: "010",
        contactEmail: "a@b.c",
        eventTitle: "행사",
        eventPurpose: "목적",
        expectedHeadcount: 5,
        startsAt: new Date("2026-11-10T01:00:00Z"),
        endsAt: new Date("2026-11-10T04:00:00Z"),
      })
      .returning({ id: applications.id });
    return app!.id;
  }

  const range = (from: string, to: string) => `[${from},${to})`;

  describe("일정 점유 배제 제약 (AT-10)", () => {
    it("같은 공간의 겹치는 시간은 저장되지 않는다", async () => {
      await db.insert(slotOccupancies).values({
        spaceId: spaceA,
        during: range("2026-11-10 01:00Z", "2026-11-10 04:00Z"),
        kind: "confirmed",
        applicationId: await newApplication(spaceA),
      });
      await expectPgError(
        db.insert(slotOccupancies).values({
          spaceId: spaceA,
          during: range("2026-11-10 03:00Z", "2026-11-10 05:00Z"),
          kind: "held",
          applicationId: await newApplication(spaceA),
        }),
        "23P01", // exclusion_violation
      );
    });

    it("끝 시각과 시작 시각이 맞닿는 것은 겹침이 아니다", async () => {
      await db.insert(slotOccupancies).values({
        spaceId: spaceA,
        during: range("2026-11-10 04:00Z", "2026-11-10 06:00Z"),
        kind: "held",
        applicationId: await newApplication(spaceA),
      });
    });

    it("다른 공간은 같은 시간에 점유할 수 있다", async () => {
      await db.insert(slotOccupancies).values({
        spaceId: spaceB,
        during: range("2026-11-10 01:00Z", "2026-11-10 04:00Z"),
        kind: "confirmed",
        applicationId: await newApplication(spaceB),
      });
    });

    it("자체행사 차단과 신청 점유도 서로 겹칠 수 없다", async () => {
      const [block] = await db
        .insert(scheduleBlocks)
        .values({
          kind: "event",
          spaceId: spaceB,
          startsAt: new Date("2026-11-11T01:00:00Z"),
          endsAt: new Date("2026-11-11T09:00:00Z"),
          reason: "기념관 자체행사",
        })
        .returning({ id: scheduleBlocks.id });
      await db.insert(slotOccupancies).values({
        spaceId: spaceB,
        during: range("2026-11-11 01:00Z", "2026-11-11 09:00Z"),
        kind: "block",
        scheduleBlockId: block!.id,
      });
      await expectPgError(
        db.insert(slotOccupancies).values({
          spaceId: spaceB,
          during: range("2026-11-11 05:00Z", "2026-11-11 06:00Z"),
          kind: "pending_payment",
          applicationId: await newApplication(spaceB),
          expiresAt: new Date("2026-11-01T00:00:00Z"),
        }),
        "23P01",
      );
    });

    it("동시에 같은 슬롯을 요청하면 한 건만 성공한다", async () => {
      const ids = await Promise.all(Array.from({ length: 5 }, () => newApplication(spaceA)));
      const results = await Promise.allSettled(
        ids.map((applicationId) =>
          db.insert(slotOccupancies).values({
            spaceId: spaceA,
            during: range("2026-11-12 01:00Z", "2026-11-12 03:00Z"),
            kind: "pending_payment",
            applicationId,
            expiresAt: new Date("2026-11-01T00:00:00Z"),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("결제대기 점유에는 만료 시각이 필요하다", async () => {
      await expectPgError(
        db.insert(slotOccupancies).values({
          spaceId: spaceA,
          during: range("2026-11-13 01:00Z", "2026-11-13 02:00Z"),
          kind: "pending_payment",
          applicationId: await newApplication(spaceA),
        }),
        "23514", // check_violation
      );
    });
  });

  describe("추가만 가능한 테이블", () => {
    it("감사 로그는 수정·삭제할 수 없다", async () => {
      await db.insert(auditLogs).values({ actorType: "system", action: "test", targetType: "test" });
      await expectPgError(db.update(auditLogs).set({ action: "changed" }), "42501");
      await expectPgError(db.delete(auditLogs), "42501");
      await expectPgError(db.execute(sql`truncate audit_logs`), "42501");
    });

    it("정책 설정 값은 수정·삭제할 수 없다", async () => {
      await db.insert(policyValues).values({ key: "k", value: 1, effectiveFrom: new Date(), reason: "테스트" });
      await expectPgError(db.update(policyValues).set({ value: 2 }), "42501");
      await expectPgError(db.delete(policyValues), "42501");
    });
  });
});
