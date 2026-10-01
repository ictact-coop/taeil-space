/**
 * 초기 데이터: 5개 공간([요구] 9장)과 기본 휴관 규칙(매주 월요일, 1월 1일).
 * 설·추석 등 해마다 바뀌는 휴관일은 관리자가 설정 화면에서 등록한다(계획서 2.6).
 * 여러 번 실행해도 이미 있는 데이터는 건너뛴다.
 */
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "../src/server/db/connect";
import { closureRules, spaces } from "../src/server/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

const seedSpaces: (typeof spaces.$inferInsert)[] = [
  {
    code: "seminar",
    name: "세미나실",
    capacity: 15,
    leadDays: 14,
    equipment: [],
    notice: "지원 용품은 기념관 사정에 따라 제한될 수 있습니다.",
    sortOrder: 1,
  },
  { code: "meeting1", name: "회의실1", capacity: 8, leadDays: 14, equipment: ["화이트보드"], notice: "소모품은 제공하지 않습니다.", sortOrder: 2 },
  { code: "meeting2", name: "회의실2", capacity: 6, leadDays: 14, equipment: [], notice: "별도 장비가 없습니다.", sortOrder: 3 },
  {
    code: "education",
    name: "교육실",
    capacity: 24,
    leadDays: null, // 관리자가 공개한 접수기간 안에서만 신청
    equipment: ["PC", "빔프로젝터 1대"],
    notice: "외부 노트북은 연결할 수 없습니다.",
    sortOrder: 4,
  },
  {
    code: "hall",
    name: "공연장(다목적홀)",
    capacity: 60,
    minHeadcount: 20,
    leadDays: 14,
    description: "83.6㎡",
    equipment: ["조명", "무선 마이크 6", "유선 마이크 6", "빔프로젝터", "현수막 500×90cm"],
    notice: "별도 공연장 이용 규정 동의가 필요합니다. 이용 전·후 대표번호로 연락해 주세요.",
    extraConsents: ["hallRules"],
    sortOrder: 5,
  },
];

const { db, pool } = createDb(url);
try {
  const inserted = await db.insert(spaces).values(seedSpaces).onConflictDoNothing({ target: spaces.code }).returning();
  console.log(`공간 ${inserted.length}개 추가 (이미 있던 공간은 건너뜀)`);

  const [monday] = await db
    .select({ id: closureRules.id })
    .from(closureRules)
    .where(and(eq(closureRules.type, "weekly"), eq(closureRules.weekday, 1), isNull(closureRules.spaceId)));
  if (!monday) {
    await db.insert(closureRules).values({ type: "weekly", weekday: 1, name: "정기 휴관(월요일)", publicMessage: "매주 월요일은 휴관일입니다." });
    console.log("휴관 규칙 추가: 매주 월요일");
  }
  const [newYear] = await db
    .select({ id: closureRules.id })
    .from(closureRules)
    .where(and(eq(closureRules.type, "annual"), eq(closureRules.month, 1), eq(closureRules.day, 1), isNull(closureRules.spaceId)));
  if (!newYear) {
    await db.insert(closureRules).values({ type: "annual", month: 1, day: 1, name: "신정", publicMessage: "1월 1일은 휴관일입니다." });
    console.log("휴관 규칙 추가: 매년 1월 1일");
  }
} finally {
  await pool.end();
}
