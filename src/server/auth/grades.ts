import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePermissions } from "@/domain/auth/permissions";
import { writeAudit } from "@/server/audit/log";
import { type Actor, fieldErrorsFrom, type MutationResult, pgErrorCode } from "@/server/actor";
import { adminGrades, adminUsers } from "@/server/db/schema";
import type { Db, DbOrTx } from "@/server/db/types";
import { PermissionError } from "./permissions";

/**
 * 관리자 등급 관리. 등급을 만들고 고치는 일은 시스템 최고 관리자만 한다
 * (계정 관리 권한만 가진 사람이 자기 등급에 권한을 더하는 일을 막기 위해).
 * 최고 관리자 등급은 하나뿐이고, 권한 목록과 관계없이 모든 권한을 가지며 지울 수 없다.
 */
const gradeSchema = z.object({
  name: z.string().trim().min(1, "등급 이름을 입력하세요.").max(30, "등급 이름은 30자 이하로 입력하세요."),
  description: z.string().trim().max(200, "설명은 200자 이하로 입력하세요."),
  permissions: z.array(z.string()),
});

export type GradeInput = { name: string; description: string; permissions: string[] };

function assertSuper(actor: Actor | null) {
  if (actor && !actor.isSuper) throw new PermissionError();
}

const audit = (actor: Actor | null) => ({ actorType: actor ? ("admin" as const) : ("system" as const), actorId: actor?.id ?? null, ip: actor?.ip ?? null });

export async function listGrades(db: DbOrTx) {
  return db
    .select({
      id: adminGrades.id,
      code: adminGrades.code,
      name: adminGrades.name,
      description: adminGrades.description,
      permissions: adminGrades.permissions,
      isSuper: adminGrades.isSuper,
      sortOrder: adminGrades.sortOrder,
      memberCount: sql<number>`count(${adminUsers.id})::int`,
      activeCount: sql<number>`count(${adminUsers.id}) filter (where ${adminUsers.isActive})::int`,
    })
    .from(adminGrades)
    .leftJoin(adminUsers, eq(adminUsers.gradeId, adminGrades.id))
    .groupBy(adminGrades.id)
    .orderBy(asc(adminGrades.sortOrder), asc(adminGrades.name));
}

export type GradeSummary = Awaited<ReturnType<typeof listGrades>>[number];

export async function findGrade(db: DbOrTx, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [grade] = await db.select().from(adminGrades).where(eq(adminGrades.id, id));
  return grade ?? null;
}

export async function findGradeByCode(db: DbOrTx, code: string) {
  const [grade] = await db.select().from(adminGrades).where(eq(adminGrades.code, code));
  return grade ?? null;
}

function duplicateName(e: unknown) {
  return pgErrorCode(e) === "23505" ? ({ ok: false, fieldErrors: { name: "같은 이름의 등급이 있습니다." } } as const) : null;
}

export async function createGrade(db: Db, params: { actor: Actor | null; raw: GradeInput }): Promise<MutationResult<{ id: string }>> {
  assertSuper(params.actor);
  const parsed = gradeSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const input = { ...parsed.data, permissions: normalizePermissions(parsed.data.permissions) };
  try {
    return await db.transaction(async (tx) => {
      const [{ max } = { max: 100 }] = await tx.select({ max: sql<number>`coalesce(max(${adminGrades.sortOrder}), 90)::int` }).from(adminGrades);
      const [row] = await tx
        .insert(adminGrades)
        .values({ ...input, sortOrder: max + 10 })
        .returning({ id: adminGrades.id });
      await writeAudit(tx, { ...audit(params.actor), action: "grade.created", targetType: "admin_grade", targetId: row!.id, after: input });
      return { ok: true as const, value: { id: row!.id } };
    });
  } catch (e) {
    const dup = duplicateName(e);
    if (dup) return dup;
    throw e;
  }
}

export async function updateGrade(db: Db, params: { actor: Actor | null; gradeId: string; raw: GradeInput }): Promise<MutationResult> {
  assertSuper(params.actor);
  const grade = await findGrade(db, params.gradeId);
  if (!grade) return { ok: false, formError: "등급을 찾을 수 없습니다." };
  const parsed = gradeSchema.safeParse(params.raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  // 최고 관리자 등급의 권한은 '전체'로 고정
  const permissions = grade.isSuper ? grade.permissions : normalizePermissions(parsed.data.permissions);
  const after = { name: parsed.data.name, description: parsed.data.description, permissions };
  const before = { name: grade.name, description: grade.description, permissions: grade.permissions };
  if (JSON.stringify(before) === JSON.stringify(after)) return { ok: true };
  try {
    await db.transaction(async (tx) => {
      await tx.update(adminGrades).set({ ...after, updatedAt: new Date() }).where(eq(adminGrades.id, grade.id));
      await writeAudit(tx, { ...audit(params.actor), action: "grade.updated", targetType: "admin_grade", targetId: grade.id, before, after });
    });
    return { ok: true };
  } catch (e) {
    const dup = duplicateName(e);
    if (dup) return dup;
    throw e;
  }
}

export async function deleteGrade(db: Db, params: { actor: Actor | null; gradeId: string }): Promise<MutationResult> {
  assertSuper(params.actor);
  const grade = await findGrade(db, params.gradeId);
  if (!grade) return { ok: false, formError: "등급을 찾을 수 없습니다." };
  if (grade.isSuper) return { ok: false, formError: "시스템 최고 관리자 등급은 지울 수 없습니다." };
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(adminUsers).where(eq(adminUsers.gradeId, grade.id));
    if (n > 0) return { ok: false, formError: `이 등급을 쓰는 계정이 ${n}개 있습니다(중지된 계정 포함). 먼저 다른 등급으로 옮기세요.` };
    await tx.delete(adminGrades).where(and(eq(adminGrades.id, grade.id), ne(adminGrades.isSuper, true)));
    await writeAudit(tx, { ...audit(params.actor), action: "grade.deleted", targetType: "admin_grade", targetId: grade.id, before: { name: grade.name, permissions: grade.permissions } });
    return { ok: true };
  });
}
