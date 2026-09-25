export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

export const badRequest = (message: string) => json({ error: message }, { status: 400 });
export const notFound = () => json({ error: "찾을 수 없습니다." }, { status: 404 });
