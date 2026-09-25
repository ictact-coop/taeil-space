# 전태일기념관 대관 시스템

2026년 유료 대관 전환에 맞춘 대관 신청·심사·결제·예약 관리 시스템입니다.
개발 계획과 구현 순서는 [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)를 참고하세요.

## 기술 스택

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 · Drizzle ORM · Tailwind CSS 4 · Vitest

## 로컬 개발

```bash
pnpm install
cp .env.example .env            # APP_ENCRYPTION_KEY는 `openssl rand -base64 32`로 생성
docker compose up -d db         # PostgreSQL (taeil, taeil_test DB)
pnpm db:migrate                 # 스키마 적용
pnpm db:seed                    # 5개 공간, 기본 휴관 규칙(매주 월요일, 1월 1일)
pnpm admin:create --login admin --name "시스템관리자" --role system
pnpm dev                        # http://localhost:3000/admin
```

첫 로그인 때 인증 앱(Google Authenticator 등)으로 2단계 인증을 등록해야 합니다.

## 명령어

| 명령 | 내용 |
|---|---|
| `pnpm lint` / `pnpm typecheck` | 린트 / 타입 검사 |
| `pnpm test` | 단위 테스트 + DB 통합 테스트 (`TEST_DATABASE_URL`이 없으면 DB 테스트는 건너뜀) |
| `pnpm db:generate` | 스키마(`src/server/db/schema.ts`) 변경 후 마이그레이션 생성 |
| `pnpm db:migrate` | 마이그레이션 적용 |

## 구조

```
src/
  domain/settings/   설정 정의(키·자료형·기본값·검증), 버전 조회, 교차 검증 — 프레임워크와 무관한 순수 로직
  server/
    db/              스키마, 마이그레이션 실행
    auth/            비밀번호(argon2id), TOTP, 세션, 비밀값 암호화
    settings/        설정 저장·되돌리기·예약 취소·이력
    audit/           감사 로그 기록·조회
  app/
    admin/login/     로그인, 2단계 인증
    admin/(console)/ 대시보드, 정책 설정, 감사 로그
drizzle/             SQL 마이그레이션 (0001: 이중 예약 방지 배제 제약, 추가 전용 트리거)
tests/db/            DB 통합 테스트
```

## 정책 설정 원칙

- 설정 정의는 코드(`src/domain/settings/definitions.ts`)에, 값은 DB(`policy_values`)에 적용 시작 시각과 함께 버전으로 쌓습니다.
- 값은 덮어쓰지 않습니다. 되돌리기·예약 취소도 새 행을 추가하는 방식이며, DB 트리거가 수정·삭제를 막습니다.
- 같은 적용 시각이면 나중에 저장한 행이 이깁니다.
- 새 설정은 `definitions.ts`에 추가하면 설정 페이지에 자동으로 나타납니다. 여러 값을 함께 봐야 하는 규칙은 `cross-validate.ts`에 추가합니다.
