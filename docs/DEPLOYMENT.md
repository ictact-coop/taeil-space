# 운영 배포 안내

전태일기념관 대관 시스템을 운영 서버에 올리고 유지하는 방법을 정리한다.
배포 파일은 `Dockerfile`과 `deploy/` 폴더에 있다.

## 1. 운영 서버 추천

### 결론: 네이버클라우드(NCP) VM 1대 + Docker Compose

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

### 2.1 준비물 (기념관에서 받을 것)

`docs/OPEN_REQUESTS.md`에 정리해 두었다.

- 도메인(예: `rent.taeil.org`)과 DNS를 바꿀 권한
- PortOne 라이브 키 4개
- SMTP 계정
- 오픈 전 필수 설정값

### 2.2 서버 준비

```bash
# Ubuntu 24.04, 공인 IP. 방화벽(ACG)은 22(관리자 IP만), 80, 443만 연다.
curl -fsSL https://get.docker.com | sh
sudo mkdir -p /srv && cd /srv
sudo git clone https://github.com/ictact-coop/taeil-space.git taeil
cd taeil/deploy
cp env.prod.example .env && chmod 600 .env
# .env 채우기. APP_ENCRYPTION_KEY는 openssl rand -base64 32 로 만들고 따로 안전하게 보관한다.
```

DNS에서 `SITE_DOMAIN`의 A 레코드를 서버 공인 IP로 지정한다. Caddy는 이 레코드가 있어야 HTTPS 인증서를 받는다.

### 2.3 실행

같은 VM의 DB를 쓰는 시작안:

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env --profile localdb"
$C build                 # 앱 이미지 빌드 (몇 분)
$C up -d db              # DB 먼저
$C up -d                 # migrate(자동 실행 후 종료) → web, worker, caddy
$C ps                    # web: healthy, worker: running 확인
curl https://rent.taeil.org/api/health   # {"ok":true}
```

관리형 DB를 쓰면 `--profile localdb`를 빼고, `.env`의 `DATABASE_URL`에 관리형 DB 주소를 넣는다.
첨부 파일 악성코드 검사(ClamAV)를 쓰려면 `--profile clamav`를 붙이고 `.env`에 `CLAMAV_HOST=clamav`를 넣는다. ClamAV는 메모리를 1.5GB 정도 더 쓰므로 서버를 8GB로 잡는다.

### 2.4 첫 관리자와 기본 데이터

```bash
$C run --rm web pnpm admin:create --login admin --name "담당자 이름" --role system
# 출력된 임시 비밀번호로 /admin 로그인 → 2단계 인증(OTP 앱) 등록
$C run --rm web pnpm db:seed   # 공간·기본 휴관일 (처음 한 번)
```

다른 담당자 계정은 관리자 화면의 **계정 관리**에서 만든다. 이후에는 **정책 설정 → 개요·오픈 준비**에서 남은 항목을 채운다. 자세한 절차는 `docs/GO_LIVE_CHECKLIST.md`에 있다.

### 2.5 PortOne 웹훅

PortOne 콘솔에서 웹훅 주소를 `https://<도메인>/api/webhooks/portone`으로 등록한다. 발급된 웹훅 시크릿은 `.env`의 `PORTONE_WEBHOOK_SECRET`에 넣는다.

## 3. 업데이트 배포

```bash
cd /srv/taeil && git pull
cd deploy && ./backup.sh                  # 배포 전 백업
$C build && $C up -d                      # migrate가 먼저 돌고 web·worker가 새 이미지로 바뀐다
$C logs --tail=50 web worker
```

마이그레이션은 추가 위주로 작성한다. 되돌려야 하면 이전 커밋으로 이미지를 다시 빌드하고, 필요하면 배포 직전 백업을 복원한다.

## 4. 백업과 복구

- **매일 백업**: crontab에 등록한다.
  ```
  30 3 * * * /srv/taeil/deploy/backup.sh >> /var/log/taeil-backup.log 2>&1
  ```
  - DB는 `pg_dump` custom 형식, 업로드 파일은 tar.gz로 `/srv/taeil-backups`에 30일 동안 둔다.
  - `.env`에 `BACKUP_S3_URI`(예: `s3://taeil-backup/daily/`)와 키를 넣으면 Object Storage에도 올린다.
- **서버 스냅샷**: NCP 콘솔에서 주 1회 만든다.
- **복구**: `./restore.sh <db-덤프> <uploads-tar>`를 실행한다. 확인 문구를 입력하면 web·worker를 멈추고 복원한 뒤 다시 켠다.
- **오픈 전 복구 연습**: 새 VM에 복원해 관리자 화면에서 신청과 첨부가 보이는지 확인한다.
- **꼭 따로 보관할 것**: `.env`의 `APP_ENCRYPTION_KEY`. 잃어버리면 관리자 2단계 인증을 모두 다시 등록해야 한다. 백업 파일에는 들어 있지 않다.

## 5. 운영 점검

| 무엇 | 어떻게 |
|---|---|
| 가동 감시 | `https://<도메인>/api/health`를 외부 감시 서비스(UptimeRobot 등 무료 서비스, NCP Cloud Insight)에 등록한다. DB가 끊기면 503을 돌려준다 |
| 작업 프로세스 | `$C logs --tail=100 worker`로 본다. "결제 만료, 알림 발송, 환불 재시도" 처리 건수가 찍힌다 |
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
