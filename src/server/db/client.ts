import "server-only";
import { createDb } from "./connect";
import type { Db } from "./types";

const globalForDb = globalThis as unknown as { taeilDb?: Db };

function init(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 없습니다. .env.example을 참고하세요.");
  return createDb(url).db;
}

/** 앱 전체에서 쓰는 DB 핸들. 개발 서버 재시작(HMR) 때 연결이 늘어나지 않게 전역에 보관한다. */
export const db: Db = globalForDb.taeilDb ?? init();
if (process.env.NODE_ENV !== "production") globalForDb.taeilDb = db;
