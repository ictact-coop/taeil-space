import "server-only";
import { headers } from "next/headers";
import { db } from "@/server/db/client";
import { clientIpFrom } from "./client-ip";
import { consumeRateLimit, limits } from "./rate-limit";

export const TOO_MANY_REQUESTS = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";

/** 요청자 IP 기준으로 횟수를 세고, 한도 안이면 true. route handler는 req.headers를 넘긴다. */
export async function throttle(kind: keyof typeof limits, h?: Headers): Promise<boolean> {
  const ip = clientIpFrom(h ?? (await headers()));
  return consumeRateLimit(db, `${kind}:${ip}`, limits[kind]);
}
