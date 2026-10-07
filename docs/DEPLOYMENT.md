# 운영 배포 안내

전태일기념관 대관 시스템을 운영 서버에 올리고 유지하는 방법을 정리한다.
배포 파일은 `Dockerfile`과 `deploy/` 폴더에 있다.

## 1. 운영 서버 추천

> **결정 (2026-10-01)**: **AWS Lightsail(서울 리전)** 에 배포한다. 단계별 절차는 [`docs/DEPLOY_AWS.md`](DEPLOY_AWS.md)에 있다.
> 아래 NCP 안은 처음 검토한 내용으로, 다른 국내 클라우드를 고를 때 참고한다. 배포 스크립트는 어느 쪽이든 같다.

### 처음 검토안: 네이버클라우드(NCP) VM 1대 + Docker Compose

| 항목 | 권장 구성 |
|---|---|
| 서버 | NCP Server(KVM, 서울 리전), vCPU 2 · 메모리 4GB · SSD 50GB 이상, Ubuntu 24.04 |
| 구성 | 한 대에서 Docker Compose로 `web`(Next.js), `worker`(pg-boss 작업), `caddy`(자동 HTTPS)를 돌린다 |
| DB | **시작안**: 같은 VM의 PostgreSQL 16 컨테이너(`--profile localdb`)에 두고, 매일 백업을 서버 밖에 보관한다<br>**여유가 있으면**: Cloud DB for PostgreSQL(관리형). 단, `btree_gist` 확장을 지원하는지 먼저 확인한다(아래) |
| 파일 | 첨부·공간 사진은 VM 디스크(도커 볼륨)에 두고, 매일 백업을 Object Storage에 복사한다 |
| 백업 보관 | NCP Object Storage(S3 호환). `deploy/backup.sh`가 직접 올린다 |
| 메일 | NCP Cloud Outbound Mailer 또는 기념관이 이미 쓰는 메일 서비스의 SMTP |
| 문자·알림톡(단계 5) | NCP SENS를 같은 계정에서 쓸 수 있다 |

**NCP를 추천하는 이유**

- **개인정보 국내 보관**: 신청자 이름, 연락처, 사업자등록번호, 첨부 서류가 모두 국내 리전에 남는다. 해외 서비스를 쓰면 개인정보 국외 이전을 고지·동의받아야 할 수 있다.
- **비영리 기관 운영에 맞다**: 원화 청구, 세금계산서 발행, 한국어 콘솔과 기술 지원을 받을 수 있다. 담당자가 바뀌어도 인수인계하기 쉽다.
- **한 계정에서 다 된다**: 서버, 백업 보관(Object Storage), 메일, 문자·알림톡(SENS)을 한 계정으로 해결한다. 단계 5를 추가 계약 없이 붙일 수 있다.
- **규모가 작다**: 대관 신청은 하루 수십 건 수준이다. 서버 1대로 충분하고, 쿠버네티스 같은 복잡한 구성은 필요 없다.

**시작안을 서버 1대 + DB 컨테이너로 잡은 이유**

- 관리형 DB는 월 비용이 VM보다 크다. 대관 시스템은 데이터 양도 적다.
- 대신 두 가지로 보완한다. 매일 `pg_dump`를 떠서 서버 밖(Object Storage)에 보관하고, 서버 스냅샷을 주기적으로 만든다.
- 복구 절차는 `deploy/restore.sh` 하나로 되어 있다. 오픈 전에 한 번 연습한다.
- 나중에 관리형 DB로 옮기려면 `DATABASE_URL`만 바꾸고 백업을 복원하면 된다.

**확인이 필요한 것**

- **Cloud DB for PostgreSQL의 `btree_gist` 확장 지원 여부**: 이중 예약 방지 제약(`drizzle/0001_constraints.sql`)에 필요하다. 이 문서를 쓸 때 NCP 문서를 직접 확인하지 못했다. 콘솔의 [Extension 관리 목록](https://guide.ncloud-docs.com/docs/clouddbforpostgresql-postgresqlextension)에서 확인하거나 NCP에 문의한다. 지원하지 않으면 시작안(DB 컨테이너)을 그대로 쓴다.
- **월 비용**: 서버 사양별 요금은 NCP 요금 계산기에서 확인한다. 비영리·공공 할인 프로그램이 있는지도 문의한다. 이 문서에는 추정 금액을 적지 않았다.

### 대안

| 대안 | 언제 고르나 | 비고 |
|---|---|---|
| **AWS 서울 리전** (Lightsail 인스턴스 또는 EC2 + RDS for PostgreSQL) | 기념관이나 협력사가 이미 AWS를 쓰고 있을 때 | RDS for PostgreSQL은 `btree_gist`를 지원한다. Lightsail 관리형 DB의 지원 여부는 따로 확인한다. 메일은 SES. 달러 청구 |
| **NHN Cloud / KT Cloud** | 기존 계약이 있을 때 | 구성은 NCP와 같다(VM + Docker Compose) |
| **기념관이 이미 쓰는 호스팅** | taeil.org를 운영하는 업체가 VM을 줄 수 있을 때 | Docker를 쓸 수 있고 root 권한이 있어야 한다. 웹호스팅(PHP 전용)은 안 된다 |

**권하지 않는 곳**

- **Vercel, Netlify 같은 해외 서버리스**: 작업 프로세스(결제 만료, 환불 재시도, 대사)를 상시 돌릴 수 없다. 첨부 파일을 로컬 디스크에 둘 수 없다. 개인정보가 국외로 이전된다.

## 2. 처음 배포하기

배포에 필요한 일은 `deploy/` 폴더의 스크립트로 한다. 모든 단계를 이 환경에서 그대로 리허설했다(2.8).

| 스크립트 | 하는 일 |
|---|---|
| `setup-server.sh` | 새 서버 준비(한 번): 시간대, 자동 보안 업데이트, 방화벽, Docker, 코드 받기, `.env` 생성(암호화 키·DB 비밀번호 자동 생성), 매일 백업 cron, 스왑 |
| `deploy.sh` | 배포·업데이트: 설정 검사 → 코드 받기 → 배포 전 백업 → 이미지 빌드 → 마이그레이션 → 교체 → 상태 확인, 실패하면 직전 버전으로 자동 되돌리기 |
| `backup.sh` | DB 덤프와 업로드 파일 백업(30일 보관, 선택: Object Storage로 복사) |
| `restore.sh` | 백업 복구. 복구 직전 상태를 먼저 한 번 더 백업한다 |
| `pnpm preflight` | 배포 전후 점검: 환경변수, DB·확장·마이그레이션, 저장소, 최고 관리자, 오픈 전 필수 설정(`--smtp`로 메일 서버 접속까지) |
| `pnpm mail:test --to 주소` | 실제 메일 한 통 보내기 |

### 2.1 준비물 (기념관에서 받을 것)

`docs/OPEN_REQUESTS.md`에 정리해 두었다. 배포에 꼭 필요한 것은 다음 세 가지다.

- 서버(AWS Lightsail 서울, `docs/DEPLOY_AWS.md`)와 도메인(예: `rent.taeil.org`), DNS를 바꿀 권한
- SMTP 계정
- 입금 계좌(계좌이체로 운영)

PG 키는 지금 필요 없다. 나중에 PG를 붙일 때 넣는다.

### 2.2 배포할 코드

서버는 GitHub 저장소에서 코드를 받는다.

- 지금 저장소에는 작업 브랜치(`claude/serene-archimedes-8gz977`) 하나뿐이다. 오픈 전에 검토를 거쳐 `main`으로 합치고, 서버는 `main`을 받도록 한다.
- 버전을 고정하려면 태그(예: `v1.0.0`)를 만들어 `./deploy.sh v1.0.0`으로 배포한다.
- 비공개 저장소라면 서버에서 받을 수 있게 읽기 전용 배포 키(GitHub → Settings → Deploy keys)를 등록하고 SSH 주소로 받는다.

### 2.3 서버 준비 (한 번)

```bash
# Ubuntu 22.04/24.04, 공인 IP. 클라우드 방화벽(ACG): 22는 관리자 IP만, 80·443은 전체 허용
curl -fsSL https://raw.githubusercontent.com/ictact-coop/taeil-space/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh git@github.com:ictact-coop/taeil-space.git main
```

- 비공개 저장소라 `curl`로 받을 수 없으면 스크립트 파일을 서버에 복사해서 실행한다.
- 끝나면 다음 두 가지를 한다.
  1. DNS에서 `SITE_DOMAIN`의 A 레코드를 서버 공인 IP로 지정한다. Caddy는 이 레코드가 있어야 HTTPS 인증서를 받는다.
  2. `/srv/taeil/deploy/.env`를 편집한다: `SITE_DOMAIN`, `ACME_EMAIL`, `APP_BASE_URL`, `EMAIL_FROM`, `SMTP_HOST`·`SMTP_USER`·`SMTP_PASS`(또는 `SMTP_URL` 한 줄).
- **`APP_ENCRYPTION_KEY`는 자동 생성된다.** 이 값을 비밀번호 관리자 등 **서버 밖에 꼭 따로 보관**한다. 잃어버리면 관리자 2단계 인증을 모두 다시 등록해야 하고, 백업에도 들어 있지 않다.

### 2.4 첫 배포

```bash
cd /srv/taeil/deploy
./deploy.sh
```

`web: healthy`와 `배포 완료`가 나오면 `https://<도메인>/api/health`가 `{"ok":true}`를 돌려준다.

이어서 첫 관리자와 기본 데이터를 만든다. 아래 `C`는 이후 명령에서 계속 쓴다.

```bash
C="docker compose -f /srv/taeil/deploy/docker-compose.prod.yml --env-file /srv/taeil/deploy/.env"
$C run --rm --no-deps web pnpm db:seed                                      # 공간·기본 휴관일 (처음 한 번)
$C run --rm --no-deps web pnpm admin:create --login admin --name "담당자 이름" --grade super --email <담당자 이메일>
$C run --rm --no-deps web pnpm mail:test --to 담당자@taeil.org                # 메일 확인
$C run --rm --no-deps web pnpm preflight --smtp                             # 점검
```

- 출력된 임시 비밀번호로 `/admin`에 로그인하고 2단계 인증(OTP 앱)을 등록한다.
- 두 번째 최고 관리자와 담당자 계정은 **계정 관리**에서 만든다.
- 그다음 **정책 설정 → 개요·오픈 준비**의 남은 항목을 채운다: 요금표, 입금 계좌, 환불률, 접수기간, 담당자 알림 주소 등.
- `preflight`에 오류(✗)가 없어질 때까지 반복한다. 남은 절차는 `docs/GO_LIVE_CHECKLIST.md`에 있다.

**구성 옵션** (`.env`의 `COMPOSE_PROFILES`):

- `localdb`(기본): 같은 VM에 PostgreSQL을 둔다.
- 관리형 DB를 쓰려면 `localdb`를 빼고 `DATABASE_URL`을 그 주소로 바꾼다.
- `clamav`를 더하면 첨부파일 악성코드 검사를 한다(`CLAMAV_HOST=clamav`). 메모리가 1.5GB 더 들므로 서버를 8GB로 잡는다.

### 2.5 PG를 붙일 때 (나중에)

1. `.env`에 PortOne 키 4개와 `PORTONE_MODE=live`를 넣는다.
2. PortOne 콘솔에서 웹훅 주소를 `https://<도메인>/api/webhooks/portone`으로 등록한다.
3. `./deploy.sh`로 다시 배포한다.
4. 관리자 화면에서 결제 방식을 PG로 바꾼다. 소액 실결제 점검은 체크리스트 D절대로 한다.

### 2.6 운영 이미지 받기 (GitHub에서 빌드)

작은 서버(2GB)에서 이미지를 빌드하면 메모리가 모자라 수십 분 걸린다. 그래서 이미지는 GitHub가 만들고, 서버는 받기만 한다.

1. PR이 `main`에 병합되면 GitHub Actions의 **Release image** 작업이 이미지를 만들어 올린다. 보통 3~5분 걸린다.
   - 올라가는 곳: `ghcr.io/ictact-coop/taeil-space:<커밋 SHA>` (GitHub 저장소 → Packages)
2. 서버에서 `./deploy.sh`를 실행한다. 서버가 받은 코드의 커밋과 같은 이미지를 받는다.
   - 아직 이미지가 없으면(방금 병합해서 빌드 중) 30초마다 다시 시도하며 최대 15분 기다린다(`PULL_WAIT`, 초 단위).
   - 이미지를 받지 못하면 백업·교체 전에 멈춘다. 운영 중인 사이트는 그대로다.
3. `.env`의 `REGISTRY_IMAGE`가 이 동작을 켠다.
   - `setup-server.sh`가 GitHub 저장소 주소를 보고 자동으로 채운다.
   - 예전에 만든 서버라면 `.env`에 `REGISTRY_IMAGE=ghcr.io/ictact-coop/taeil-space` 한 줄을 넣는다.
   - 비우면 예전처럼 서버에서 빌드한다. 한 번만 서버에서 빌드하려면 `BUILD_ON_SERVER=1 ./deploy.sh`.

**이미지 받기 권한 (처음 한 번)**

GitHub 패키지는 처음 만들어질 때 비공개다. 둘 중 하나를 한다.

- **(권장) 패키지를 공개로 바꾼다.** 저장소가 공개이고 이미지에는 비밀 값이 없다(`.env`는 서버에만 있다).
  - GitHub 조직 → **Packages** → `taeil-space` → **Package settings** → Danger Zone의 **Change visibility** → Public.
  - 조직 설정에서 공개 패키지를 막아 두었다면 조직 소유자가 먼저 허용해야 한다(Organization settings → Packages).
- **비공개로 두고 서버에서 로그인한다.**
  - GitHub → Settings → Developer settings → Personal access tokens (classic)에서 `read:packages` 권한만 있는 토큰을 만든다.
  - 서버에서 한 번 실행한다. 이후 배포는 자동으로 이 로그인을 쓴다.
    ```bash
    echo '<토큰>' | sudo docker login ghcr.io -u <GitHub 아이디> --password-stdin
    ```
  - 토큰에 만료일이 있으면 만료 전에 새로 만들어 다시 로그인한다.

권한이 없으면 `deploy.sh`가 "이미지를 받을 권한이 없습니다"라고 알려 준다.

### 2.7 Docker Hub 다운로드 제한

`postgres`·`caddy` 이미지를 받다가 `429 Too Many Requests`가 나면 `.env`의 `POSTGRES_IMAGE`, `CADDY_IMAGE`를 미러로 바꾼다. 예: `mirror.gcr.io/library/postgres:16`, `mirror.gcr.io/library/caddy:2`.

### 2.8 리허설 결과 (2026-10-01)

이 환경에서 운영 이미지와 compose로 아래를 실제로 해 봤다.

- **첫 배포**: DB → 마이그레이션 → web·worker → Caddy(HTTPS) 순서로 떴고, `/api/health`가 응답했다.
  - HTTP는 HTTPS로 넘어가고, HSTS·CSP 헤더가 붙는다.
  - 컨테이너 안에서 `db:seed`, `admin:create`, `preflight`가 실행됐다.
- **업데이트 배포**: 배포 전 백업(DB 덤프와 업로드 파일)이 만들어지고 새 버전으로 교체됐다.
- **실패 배포**: 응답하지 않는 버전을 배포하자 45초 뒤 직전 버전으로 자동으로 되돌렸고, 서비스는 계속 응답했다.
- **복구**: 백업 이후 추가한 데이터와 지운 업로드 파일이 백업 시점으로 돌아왔고, 작업 큐(pg-boss)도 정상이었다.
- **이미지 받기 배포(2026-10-07)**: 로컬 이미지 저장소로 GHCR을 대신해 해 봤다.
  - 첫 배포가 26초에 끝났다(서버 빌드 없음).
  - 이미지가 아직 없는 커밋을 배포하자 30초마다 다시 시도하다가, 이미지가 올라오자 받아서 백업·교체를 마쳤다.
  - 없는 이미지는 대기 시간이 지나자 백업·교체 전에 멈췄고, 사이트는 계속 응답했다.

## 3. 업데이트 배포

```bash
cd /srv/taeil/deploy
sudo ./deploy.sh            # 현재 브랜치(main)의 최신 코드
sudo ./deploy.sh v1.0.1     # 특정 태그
```

- GitHub가 만든 이미지를 받는다(2.6). 병합 직후라면 GitHub Actions의 **Release image**가 끝날 때까지(3~5분) 기다렸다가 진행한다.

- 배포 전 백업이 자동으로 만들어진다.
- 새 버전이 3분 안에 정상(healthy)이 되지 않으면 직전 버전으로 자동으로 돌아간다.
- 마이그레이션은 되돌리지 않는다(추가 위주로 작성). 데이터까지 되돌려야 하면 배포 전 백업을 `restore.sh`로 복구한다.
- 업무 시간을 피해 배포한다. 교체 중에 몇 초 동안 접속이 끊길 수 있다.

## 4. 백업과 복구

- **매일 백업**: `setup-server.sh`가 cron(매일 03:30)을 등록한다. 기록은 `/var/log/taeil-backup.log`에 남는다.
  - DB는 `pg_dump` custom 형식, 업로드 파일은 tar.gz로 `/srv/taeil-backups`에 30일 동안 둔다(root만 읽기 가능).
  - `.env`에 `BACKUP_S3_URI`(예: `s3://taeil-backup/daily/`)와 키를 넣으면 Object Storage에도 올린다. **서버가 통째로 망가질 때를 대비해 꼭 설정한다.**
- **서버 스냅샷**: 클라우드 콘솔에서 정기 스냅샷을 켠다(AWS Lightsail은 자동 스냅샷, `DEPLOY_AWS.md` 3.4).
- **복구**: `./restore.sh <db-덤프> [uploads-tar]`를 실행한다.
  - 확인 문구(RESTORE)를 입력하면 지금 상태를 먼저 백업하고, web·worker를 멈춘 뒤 복원하고 다시 켠다.
  - 복원은 한 트랜잭션으로 해서, 중간에 실패하면 반영되지 않는다.
- **오픈 전 복구 연습**: 위 명령으로 한 번 복구해 보고, 관리자 화면에서 신청과 첨부가 보이는지 확인한다.
- **꼭 따로 보관할 것**: `.env` 전체, 특히 `APP_ENCRYPTION_KEY`.

## 5. 운영 점검

| 무엇 | 어떻게 |
|---|---|
| 가동 감시 | `https://<도메인>/api/health`를 외부 감시 서비스(UptimeRobot 등 무료 서비스, NCP Cloud Insight)에 등록한다. DB가 끊기면 503을 돌려준다 |
| 작업 프로세스 | `$C logs --tail=100 worker`로 본다. 입금 기한 만료, 입금 기한 임박 알림, 알림 발송, 환불 재시도 처리 건수가 찍힌다 |
| 정기 점검 | 월 1회 `$C run --rm --no-deps web pnpm preflight`로 설정·DB 상태를 확인한다 |
| 연동 상태 | 관리자 **정책 설정 → 연동 상태**에서 결제·메일 설정 여부를 확인한다 |
| 디스크 | `df -h`, `docker system df`로 본다. 컨테이너 로그는 20MB × 5개로 순환한다 |
| 보안 업데이트 | `unattended-upgrades`를 켠다. 앱은 분기마다 의존성을 올려 다시 배포한다 |

## 6. 보안 설정 요약 (단계 4에서 적용)

- **HTTPS**: Caddy가 자동으로 적용한다. 운영 모드에서는 HSTS 헤더를 보낸다.
- **보안 헤더**: CSP(`frame-ancestors 'none'`, `object-src 'none'` 등), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`를 보낸다.
  - 결제창 때문에 스크립트·iframe은 https 출처를 허용한다.
  - 라이브 결제 점검 뒤 실제 사용 도메인으로 좁힐 수 있다(`next.config.ts`).
- **요청 횟수 제한(IP 기준)**: 신청 제출 10회/시간, 첨부 30회/10분, 금액 조회 300회/10분, 확인 코드 요청 20회/시간, 확인 코드 입력 30회/시간, 관리자 로그인·OTP 30회/15분.
  - 계정별 잠금(관리자 5회 실패, 신청자 코드 5회 오입력)과 별도로 동작한다.
- **접속자 IP**: `X-Forwarded-For`에서 오른쪽부터 `TRUST_PROXY_HOPS`번째 값을 쓴다.
  - Caddy만 있으면 1, 로드밸런서 뒤에 Caddy를 두면 2로 설정한다.
- **업로드 토큰**: 서버가 서명해 발급한 토큰으로만 첨부를 올릴 수 있다.
- **CSRF**: 쿠키 인증을 쓰는 업로드 API는 Origin을 검사한다. 서버 액션은 Next.js가 자체적으로 검사한다.
- **컨테이너**: 앱은 root가 아닌 `node` 사용자로 실행한다. DB 포트는 외부에 열지 않는다.
