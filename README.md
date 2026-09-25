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
pnpm dev                        # 이용자 http://localhost:3000 · 관리자 http://localhost:3000/admin
pnpm worker                     # 주기 작업(결제 유효시간 만료, 고아 첨부·세션 정리) — 별도 터미널
```

첫 로그인 때 인증 앱(Google Authenticator 등)으로 2단계 인증을 등록해야 합니다.

### 결제·이메일

- **결제**: `PORTONE_API_SECRET`이 없으면 개발 환경에서는 가짜 결제(“테스트 결제하기” 버튼)를 씁니다. PortOne 계약 후 `PORTONE_STORE_ID`·`PORTONE_CHANNEL_KEY`·`PORTONE_API_SECRET`·`PORTONE_WEBHOOK_SECRET`을 설정하고, PortOne 콘솔의 웹훅 주소를 `https://<도메인>/api/webhooks/portone`으로 등록합니다.
- **이메일**: 기본값 `EMAIL_PROVIDER=log`는 실제로 보내지 않고 서버 로그에 남깁니다. 운영에서는 `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`을 설정합니다.

## 명령어

| 명령 | 내용 |
|---|---|
| `pnpm lint` / `pnpm typecheck` | 린트 / 타입 검사 |
| `pnpm test` | 단위 테스트 + DB 통합 테스트 (`TEST_DATABASE_URL`이 없으면 DB 테스트는 건너뜀) |
| `pnpm db:generate` | 스키마(`src/server/db/schema.ts`) 변경 후 마이그레이션 생성 |
| `pnpm db:migrate` | 마이그레이션 적용 |
| `pnpm worker` | pg-boss 작업 프로세스: 결제 유효시간 만료·알림 발송(1분), 환불 재시도(2분), 결제 대사(5분), 보완기한 만료(10분) |

## 구조

```
src/
  domain/            프레임워크와 무관한 순수 로직
    settings/        설정 정의(키·자료형·기본값·검증), 버전 조회, 교차 검증
    calendar/        휴관 규칙 판정, 접수기간, 입력 검증
    pricing/         요금표 형식, 감면 입력
    refund/          시점별 환불률
    spaces/          공간 입력 검증, 동의 항목
    booking/         신청 규칙(BR-01~08), 운영시간·시간 칸, 신청서 입력 검증
    organization/    고유번호·사업자등록번호 검증
  server/
    db/              스키마, 마이그레이션 실행
    auth/            비밀번호(argon2id), TOTP, 세션, 비밀값 암호화
    settings/        설정 저장·되돌리기·예약 취소·확정·이력, 오픈 준비 점검
    spaces/ calendar/ pricing/   공간·휴관·일정 차단·접수기간·요금표·감면 저장, 공간 사진
    booking/         달력·가용성·견적, 신청 제출, 결제 유효시간 만료, 첨부
    payments/        PortOne·가짜 게이트웨이, 결제 확정(멱등)·대사, 환불
    applications/    상태 전이, 심사(보완·반려·승인·입금확인), 철회·보완 제출, 대시보드
    notifications/   알림 문구·발송 대기열·이메일
    applicant/       나의 대관 이메일 확인 코드·세션
    storage/         파일 저장소(로컬), 파일 형식 확인, 악성코드 검사(clamd)
    jobs/            pg-boss 주기 작업
    audit/           감사 로그 기록·조회
  app/
    (public)/        대관 안내, 공간 안내, 신청(일정 선택 → 신청서 → 결제), 나의 대관
    api/             달력·시간표·견적·첨부 업로드 API, PortOne 웹훅
    admin/login/     로그인, 2단계 인증
    admin/(console)/ 대시보드, 신청 관리·심사, 대관 캘린더, 환불 처리, 정책 설정, 감사 로그
drizzle/             SQL 마이그레이션 (0001: 이중 예약 방지 배제 제약·추가 전용 트리거, 0003: 요금표 추가 전용)
tests/db/            DB 통합 테스트
```

## 정책 설정 원칙

- 설정 정의는 코드(`src/domain/settings/definitions.ts`)에, 값은 DB(`policy_values`)에 적용 시작 시각과 함께 버전으로 쌓습니다.
- 값은 덮어쓰지 않습니다. 되돌리기·예약 취소도 새 행을 추가하는 방식이며, DB 트리거가 수정·삭제를 막습니다.
- 같은 적용 시각이면 나중에 저장한 행이 이깁니다.
- DB(jsonb)는 객체 키 순서를 바꿔 저장하므로 값 비교에는 `src/lib/stable-json.ts`의 `sameJson`을 씁니다.
- 서버 액션에서 한글 메시지를 붙여 이동할 때는 `src/lib/url.ts`의 `withNotice`로 인코딩합니다.
- 새 설정은 `definitions.ts`에 추가하면 설정 페이지에 자동으로 나타납니다. 여러 값을 함께 봐야 하는 규칙은 `cross-validate.ts`에 추가합니다.
