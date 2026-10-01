import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** db 또는 트랜잭션 어느 쪽이든 받을 수 있는 핸들 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
