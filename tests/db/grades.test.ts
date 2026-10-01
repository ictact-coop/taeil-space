import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGrade, deleteGrade, findGradeByCode, listGrades, updateGrade } from "@/server/auth/grades";
import { PermissionError } from "@/server/auth/permissions";
import { validateSession, createSession } from "@/server/auth/service";
import { adminGrades, adminUsers, auditLogs } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { createTestAdmin, hasTestDb, resetTestDb } from "../helpers/db";

describe.skipIf(!hasTestDb)("관리자 등급", () => {
  let db: Db;
  let close: () => Promise<void>;
  let sys: Awaited<ReturnType<typeof createTestAdmin>>;

  beforeAll(async () => {
    ({ db, close } = await resetTestDb());
    sys = await createTestAdmin(db, "system");
  });
  afterAll(async () => close?.());

  it("기본 등급 3개가 마이그레이션으로 만들어진다", async () => {
    const grades = await listGrades(db);
    expect(grades.slice(0, 3).map((g) => [g.code, g.name, g.isSuper])).toEqual([
      ["super", "시스템 최고 관리자", true],
      ["staff", "기념관 내부 임직원", false],
      ["club", "동아리 운영자", false],
    ]);
    expect(grades.find((g) => g.code === "staff")!.permissions).toEqual(expect.arrayContaining(["applications.review", "schedule.manage"]));
    expect(grades.find((g) => g.code === "club")!.permissions).toEqual(["calendar.view"]);
  });

  it("최고 관리자 등급은 하나뿐 (DB 제약)", async () => {
    await expect(db.insert(adminGrades).values({ name: "또 다른 최고", isSuper: true })).rejects.toThrow();
  });

  it("등급 생성: 선행 권한 자동 포함, 모르는 키 제거, 이름 중복 거부, 감사 로그", async () => {
    const r = await createGrade(db, { actor: sys.actor, raw: { name: "자원활동가", description: "행사 지원", permissions: ["applications.review", "hack.all"] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db.select().from(adminGrades).where(eq(adminGrades.id, r.value.id));
    expect(row!.permissions).toEqual(["applications.view", "applications.review"]);
    expect(await createGrade(db, { actor: sys.actor, raw: { name: "자원활동가", description: "", permissions: [] } })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(await createGrade(db, { actor: sys.actor, raw: { name: " ", description: "", permissions: [] } })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect((await db.select().from(auditLogs).where(eq(auditLogs.targetId, r.value.id))).map((l) => l.action)).toContain("grade.created");
  });

  it("최고 관리자가 아니면 등급을 만들거나 고칠 수 없다 (계정 관리 권한이 있어도)", async () => {
    const actor = { id: sys.id, isSuper: false, permissions: ["accounts.manage" as const] };
    const staff = (await findGradeByCode(db, "staff"))!;
    await expect(createGrade(db, { actor, raw: { name: "x", description: "", permissions: [] } })).rejects.toBeInstanceOf(PermissionError);
    await expect(updateGrade(db, { actor, gradeId: staff.id, raw: { name: staff.name, description: "", permissions: ["audit.view"] } })).rejects.toBeInstanceOf(PermissionError);
    await expect(deleteGrade(db, { actor, gradeId: staff.id })).rejects.toBeInstanceOf(PermissionError);
  });

  it("권한을 바꾸면 그 등급 계정의 다음 요청부터 적용된다", async () => {
    const g = await createGrade(db, { actor: sys.actor, raw: { name: "행사 지원", description: "", permissions: ["calendar.view"] } });
    if (!g.ok) throw new Error("grade");
    const user = await createTestAdmin(db, "club");
    await db.update(adminUsers).set({ gradeId: g.value.id }).where(eq(adminUsers.id, user.id));
    const { token } = await createSession(db, user.id, true, {});
    expect((await validateSession(db, token))!.grade.permissions).toEqual(["calendar.view"]);
    expect(await updateGrade(db, { actor: sys.actor, gradeId: g.value.id, raw: { name: "행사 지원", description: "", permissions: ["calendar.view", "applications.view"] } })).toEqual({ ok: true });
    expect((await validateSession(db, token))!.grade.permissions).toEqual(["applications.view", "calendar.view"]);
  });

  it("동아리 운영자 등급은 '대관 일정 조회'로 고정 (이름·설명만 바뀜)", async () => {
    const club = (await findGradeByCode(db, "club"))!;
    expect(club.permissions).toEqual(["calendar.view"]);
    expect(club.description).toContain("일정 확인만");
    expect(await updateGrade(db, { actor: sys.actor, gradeId: club.id, raw: { name: "동아리 운영자", description: "동아리", permissions: ["calendar.view", "applications.view", "audit.view"] } })).toEqual({ ok: true });
    const [row] = await db.select().from(adminGrades).where(eq(adminGrades.id, club.id));
    expect(row).toMatchObject({ permissions: ["calendar.view"], description: "동아리" });
  });

  it("최고 관리자 등급: 이름·설명만 바뀌고 권한은 '전체'로 고정, 삭제 불가", async () => {
    const sup = (await findGradeByCode(db, "super"))!;
    expect(await updateGrade(db, { actor: sys.actor, gradeId: sup.id, raw: { name: "최고 관리자", description: "전부", permissions: ["calendar.view"] } })).toEqual({ ok: true });
    const [row] = await db.select().from(adminGrades).where(eq(adminGrades.id, sup.id));
    expect(row).toMatchObject({ name: "최고 관리자", permissions: [], isSuper: true });
    expect(await deleteGrade(db, { actor: sys.actor, gradeId: sup.id })).toMatchObject({ ok: false, formError: expect.stringContaining("지울 수 없") });
  });

  it("계정이 있는 등급은 지울 수 없고, 비우면 지울 수 있다", async () => {
    const r = await createGrade(db, { actor: sys.actor, raw: { name: "임시 등급", description: "", permissions: [] } });
    if (!r.ok) throw new Error("grade");
    const user = await createTestAdmin(db, "club");
    await db.update(adminUsers).set({ gradeId: r.value.id, isActive: false }).where(eq(adminUsers.id, user.id));
    expect(await deleteGrade(db, { actor: sys.actor, gradeId: r.value.id })).toMatchObject({ ok: false, formError: expect.stringContaining("1개") });
    const club = (await findGradeByCode(db, "club"))!;
    await db.update(adminUsers).set({ gradeId: club.id }).where(eq(adminUsers.id, user.id));
    expect(await deleteGrade(db, { actor: sys.actor, gradeId: r.value.id })).toEqual({ ok: true });
  });
});
