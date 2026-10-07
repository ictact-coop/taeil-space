# 전태일기념관 대관 시스템 운영 이미지. 웹·작업 프로세스·마이그레이션이 같은 이미지를 쓴다.
#   웹:       (기본 CMD) pnpm start
#   작업:     pnpm worker
#   마이그레이션: pnpm db:migrate
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# 빌드 중에는 DB에 접속하지 않는다. 연결 문자열 형식만 채워 둔다.
# 타입 검사는 CI(pnpm typecheck)가 하므로 이미지 빌드에서는 건너뛴다(next.config.ts).
RUN DATABASE_URL=postgres://build:build@localhost:5432/build SKIP_BUILD_TYPECHECK=1 pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/uploads
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
