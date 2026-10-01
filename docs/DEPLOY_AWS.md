# AWS 배포 안내 (Lightsail, 서울 리전)

전태일기념관 대관 시스템을 AWS에 처음 올리는 절차다. 순서대로 따라 하면 된다.
일반적인 배포·업데이트·백업 설명은 `docs/DEPLOYMENT.md`, 오픈 전 점검은 `docs/GO_LIVE_CHECKLIST.md`에 있다.

## 0. 구성과 비용

```
이용자·관리자 ──HTTPS──▶ Lightsail 인스턴스 (서울, Ubuntu 24.04, 2GB)
                          └ Docker Compose: Caddy(HTTPS) → web(Next.js) · worker(작업) · db(PostgreSQL 16)
                          ├─ 메일 ──▶ Amazon SES (서울, SMTP)
                          └─ 매일 백업 ──▶ Amazon S3 (서울) + Lightsail 자동 스냅샷
```

| 항목 | 선택 | 대략의 비용 (콘솔에서 확인) |
|---|---|---|
| 서버 | **Lightsail** Linux 2GB(2 vCPU, 60GB SSD, 전송량 3TB, IPv4 포함) | 월 $12 안팎 |
| 고정 IP | Lightsail 고정 IP(인스턴스에 연결해 두면 추가 요금 없음) | 0 |
| 서버 스냅샷 | Lightsail 자동 스냅샷(매일, 최근 7개 보관) | 저장 용량만큼(월 수 달러 이하) |
| 메일 | Amazon SES | 발송량 기준(대관 알림 규모면 월 몇백 원 수준) |
| 백업 보관 | Amazon S3 | 몇 GB 수준이면 월 몇백 원 |

- **합계**: 대략 월 $13~15다.
- **데이터 위치**: 모두 서울 리전이라 국내에 보관된다.
- **Lightsail을 고른 이유**: 월 고정 요금에 전송량과 고정 IP가 포함되고, 방화벽과 스냅샷을 콘솔에서 쉽게 다룰 수 있다. EC2로 하는 경우는 10장을 본다.
- **사양**: 실제로 재 보니 이 시스템 전체가 메모리를 약 410MB 쓴다. 2GB면 서버에서 이미지를 빌드할 때도 여유가 있다. 1GB 플랜은 빌드 중 메모리가 부족할 수 있다.

## 1. AWS 계정 (기념관 명의)

1. **계정 만들기**: https://aws.amazon.com 에서 기념관 대표 메일로 계정을 만든다.
   - 가입할 때 **유료 플랜(Paid plan)** 을 고른다.
   - 무료 플랜(Free plan)은 6개월이 지나거나 크레딧을 다 쓰면 계정이 닫히고 자원이 지워진다. 신규 가입 크레딧은 유료 플랜에도 똑같이 준다.
2. **root 계정 보호**: 우측 위 계정 이름 → **보안 자격 증명** → MFA를 등록한다. 평소에는 root로 일하지 않는다.
3. **담당자 계정**: **IAM Identity Center**(또는 IAM)에서 담당자 계정을 만들고 관리자 권한을 준다. 이후 작업은 이 계정으로 한다.
4. **요금 알림**: **Billing and Cost Management → Budgets → 예산 생성**에서 월 $20 예산을 만들고 메일 알림을 켠다.
5. **리전**: 콘솔 우측 위 리전을 **아시아 태평양(서울) ap-northeast-2**로 고정한다. 이후 모든 자원을 서울에 만든다.

## 2. 메일(SES) — 승인에 하루쯤 걸리므로 가장 먼저

### 2.1 도메인 인증

1. **Amazon SES → 구성: 자격 증명(Identities) → 자격 증명 생성**을 누른다.
2. 다음과 같이 입력한다.
   - 자격 증명 유형: **도메인**
   - 도메인: `taeil.org`
   - 고급 DKIM 설정: **Easy DKIM**, RSA 2048비트
3. 생성하면 **CNAME 레코드 3개**가 나온다. taeil.org의 DNS 관리 화면(도메인 등록업체나 호스팅 업체)에 그대로 추가한다.
4. 몇 분에서 몇 시간 뒤 SES 화면의 상태가 **확인됨(Verified)** 으로 바뀐다.
5. (권장) 스팸 판정을 줄이려면 DMARC TXT 레코드도 추가한다.
   ```
   이름: _dmarc.taeil.org   값: v=DMARC1; p=none; rua=mailto:admin@taeil.org
   ```
   이미 DMARC 레코드가 있으면 그대로 둔다.

### 2.2 샌드박스 해제 요청 (프로덕션 액세스)

새 계정의 SES는 **샌드박스** 상태다. 이 상태에서는 인증한 주소로만 보낼 수 있고, 하루 200통까지만 보낼 수 있다.

1. **SES → 계정 대시보드 → 프로덕션 액세스 요청**을 누른다.
2. 다음과 같이 적는다.
   - 메일 유형: **트랜잭션(Transactional)**
   - 웹사이트 URL: `https://rent.taeil.org` (아직 열리지 않았으면 `https://taeil.org`)
   - 사용 사례 설명(예시):
     > 전태일기념관(비영리) 공간 대관 신청 시스템의 알림 메일입니다. 신청자가 직접 신청서를 제출할 때 입력한 주소로만 보냅니다. 보내는 메일은 신청 접수·입금 안내, 입금 기한 알림, 심사 결과(승인·반려·보완 요청), 본인 확인 코드입니다. 마케팅 메일은 보내지 않습니다. 예상 발송량은 하루 수십 통 이하입니다. 반송·수신 거부는 SES 대시보드로 확인하고 해당 주소로는 다시 보내지 않습니다.
3. 보통 하루 안에 결과 메일이 온다. 추가 질문이 오면 같은 내용으로 답한다.

### 2.3 SMTP 자격 증명

1. **SES → SMTP 설정 → SMTP 자격 증명 생성**을 누른다. IAM 사용자가 하나 만들어진다.
2. 표시되는 **SMTP 사용자 이름**과 **SMTP 비밀번호**를 저장한다. 비밀번호는 이때 한 번만 보이니 비밀번호 관리자에 바로 옮긴다.
3. SMTP 엔드포인트는 `email-smtp.ap-northeast-2.amazonaws.com`, 포트는 `465`다.
4. 이 값은 7장에서 `.env`에 그대로 넣는다. 비밀번호에 `+`, `/`가 있어도 따옴표 없이 그대로 넣으면 된다.

## 3. 서버(Lightsail)

### 3.1 인스턴스 만들기

1. **Lightsail 콘솔 → 인스턴스 생성**을 누른다.
2. 다음과 같이 고른다.

| 항목 | 값 |
|---|---|
| 위치 | 서울 (ap-northeast-2), 가용 영역 a |
| 플랫폼 | Linux/Unix |
| 블루프린트 | **운영 체제(OS) 전용 → Ubuntu 24.04 LTS** |
| SSH 키 | 기본 키를 쓰거나 새 키를 만들어 내려받는다(분실 주의) |
| 플랜 | **2GB RAM, 2 vCPU, 60GB SSD** (듀얼스택) |
| 이름 | `taeil-prod` |

3. **인스턴스 생성**을 누르고, 상태가 "실행 중"이 될 때까지 1~2분 기다린다.

### 3.2 고정 IP

1. **네트워킹 → 고정 IP 생성**에서 서울을 고르고, `taeil-prod`에 연결한 뒤 이름을 `taeil-ip`로 짓는다.
2. 나온 IP를 적어 둔다. 4장의 DNS와 이후 접속에 쓴다.
   - 인스턴스에 연결해 둔 고정 IP는 요금이 없다. 연결을 끊고 방치하면 요금이 나온다.

### 3.3 방화벽

인스턴스 → **네트워킹** 탭 → **IPv4 방화벽**에서 규칙을 다음만 남긴다. IPv6 방화벽도 같게 맞춘다.

| 애플리케이션 | 포트 | 허용 대상 |
|---|---|---|
| SSH | TCP 22 | **사무실 공인 IP만** |
| HTTP | TCP 80 | 모든 IP (HTTPS 인증서 발급·전환에 필요) |
| HTTPS | TCP 443 | 모든 IP |
| (선택) 사용자 지정 | UDP 443 | 모든 IP (HTTP/3) |

- SSH를 사무실 IP로만 제한하면 Lightsail 콘솔의 **브라우저 SSH** 버튼이 동작하지 않는다.
- 브라우저 SSH를 쓰려면 SSH 규칙에 "Lightsail 브라우저 SSH/RDP 허용"을 체크한다.

### 3.4 자동 스냅샷

인스턴스 → **스냅샷** 탭 → **자동 스냅샷 활성화**를 켠다. 시간은 새벽 4시(KST)로 하고, 최근 7개를 보관한다.

## 4. DNS

taeil.org DNS 관리 화면에 아래 레코드를 추가한다.

```
유형 A   이름 rent   값 <고정 IP>   TTL 300
```

확인(내 PC에서):

```bash
nslookup rent.taeil.org     # 또는 dig +short rent.taeil.org → 고정 IP가 나오면 된다
```

DNS가 서버를 가리켜야 HTTPS 인증서가 발급된다. 8장(첫 배포) 전에 끝낸다.

## 5. 백업 보관소(S3)

### 5.1 버킷

1. **S3 → 버킷 만들기**를 누르고 다음과 같이 만든다.
   - 리전: 서울
   - 이름: `taeil-rent-backup`처럼 전 세계에서 겹치지 않는 이름
   - 퍼블릭 액세스 차단: **모두 차단(기본값 유지)**
   - 버킷 버전 관리: 사용
   - 기본 암호화: SSE-S3(기본값)
2. 버킷 → **관리 → 수명 주기 규칙 생성**에서 접두사 `daily/` 객체를 **90일 뒤 만료**(이전 버전도 30일 뒤 삭제)하도록 정한다.

### 5.2 백업 전용 IAM 사용자 (올리기만 가능)

1. **IAM → 사용자 → 사용자 생성**에서 이름을 `taeil-backup`으로 하고, 콘솔 접근은 주지 않는다.
2. **권한 → 인라인 정책 생성 → JSON**에 아래를 넣는다. 버킷 이름은 실제 이름으로 바꾼다.
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": "arn:aws:s3:::taeil-rent-backup/daily/*" }
     ]
   }
   ```
   서버가 탈취되더라도 기존 백업을 지우거나 읽을 수 없게, 올리기 권한만 준다.
3. **보안 자격 증명 → 액세스 키 만들기**에서 용도를 "AWS 외부에서 실행되는 애플리케이션"으로 고르고, 액세스 키와 비밀 키를 저장한다.

## 6. 서버 준비 (한 번)

내 PC에서 SSH로 접속한다(Windows는 PowerShell, macOS는 터미널).

```bash
chmod 600 ~/Downloads/LightsailDefaultKey-ap-northeast-2.pem      # 내려받은 키
ssh -i ~/Downloads/LightsailDefaultKey-ap-northeast-2.pem ubuntu@<고정 IP>
```

서버에서 준비 스크립트를 실행한다. 저장소가 공개라 주소만 있으면 된다.

```bash
curl -fsSL https://raw.githubusercontent.com/ictact-coop/taeil-space/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh https://github.com/ictact-coop/taeil-space.git main
```

몇 분 걸린다. 끝나면 아래가 모두 되어 있다.

- 시간대가 서울이다.
- 자동 보안 업데이트가 켜져 있다.
- 서버 방화벽(ufw)이 22, 80, 443만 연다.
- Docker가 설치되어 있다.
- 코드가 `/srv/taeil`에 있다.
- `/srv/taeil/deploy/.env`가 만들어져 있다. 암호화 키와 DB 비밀번호는 자동 생성된다.
- 매일 03:30 백업이 등록되어 있다.
- 2GB 스왑이 추가되어 있다.

## 7. 환경 설정 (`.env`)

```bash
sudo nano /srv/taeil/deploy/.env
```

아래 값을 채운다. 나머지는 그대로 둔다.

| 항목 | 값 |
|---|---|
| `SITE_DOMAIN` | `rent.taeil.org` |
| `ACME_EMAIL` | 인증서 만료 알림을 받을 주소(예: `admin@taeil.org`) |
| `APP_BASE_URL` | `https://rent.taeil.org` |
| `EMAIL_FROM` | `"전태일기념관 대관 <rent@taeil.org>"` (SES에서 인증한 도메인 주소) |
| `SMTP_HOST` | `email-smtp.ap-northeast-2.amazonaws.com` (기본값) |
| `SMTP_USER`, `SMTP_PASS` | 2.3의 SMTP 사용자 이름·비밀번호 |
| `BACKUP_S3_URI` | `s3://taeil-rent-backup/daily/` |
| `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | 5.2의 액세스 키 |

저장(Ctrl+O, Enter)하고 나간다(Ctrl+X).

- `APP_ENCRYPTION_KEY`와 `.env` 전체를 **비밀번호 관리자 등 서버 밖에 보관**한다. 확인은 `sudo cat /srv/taeil/deploy/.env`.
  - 이 키를 잃어버리면 관리자 2단계 인증을 모두 다시 등록해야 하고, 백업에도 들어 있지 않다.
- 결제(PortOne) 값은 비워 둔다. 계좌이체로 운영한다.

## 8. 첫 배포

```bash
cd /srv/taeil/deploy
sudo ./deploy.sh
```

처음에는 이미지를 빌드하느라 5~10분 걸린다. `web ... (healthy)`와 `배포 완료`가 나오면 성공이다.

- 브라우저에서 `https://rent.taeil.org`가 열리고 주소창에 자물쇠가 보이는지 확인한다.
- 인증서는 첫 접속 때 자동으로 발급된다. 몇십 초 걸릴 수 있다.

## 9. 기본 데이터·관리자·점검

```bash
C="sudo docker compose -f /srv/taeil/deploy/docker-compose.prod.yml --env-file /srv/taeil/deploy/.env"
$C run --rm --no-deps web pnpm db:seed                                           # 공간·기본 휴관일 (처음 한 번)
$C run --rm --no-deps web pnpm admin:create --login admin --name "담당자 이름" --grade super
$C run --rm --no-deps web pnpm mail:test --to 담당자@taeil.org                     # 시험 메일
$C run --rm --no-deps web pnpm preflight --smtp                                  # 점검
sudo /srv/taeil/deploy/backup.sh                                                 # 백업 한 번 → S3 버킷 daily/에 파일 확인
```

- **시험 메일**: SES가 아직 샌드박스면 SES에서 인증한 주소(자격 증명에 이메일 주소로 추가)로만 받을 수 있다. 샌드박스가 풀리면 아무 주소로나 보내진다.
- **첫 로그인**: `https://rent.taeil.org/admin`에 출력된 임시 비밀번호로 로그인하고 2단계 인증(OTP 앱)을 등록한다.
- **나머지 준비**: 두 번째 최고 관리자와 담당자 계정은 **계정 관리**에서 만든다. 그다음 **정책 설정 → 개요·오픈 준비**의 남은 항목을 채운다: 요금표, 입금 계좌, 환불률, 교육실 접수기간, 담당자 알림 주소 등.
- `preflight`에 오류(✗)가 없어질 때까지 반복한다. 이후 절차는 `docs/GO_LIVE_CHECKLIST.md`를 따른다.

## 10. EC2로 하는 경우 (선택)

Lightsail 대신 EC2를 쓰면 다음만 다르다. 나머지 절차는 같다.

- **인스턴스**:
  - Ubuntu 24.04, `t4g.small`(ARM, 2GB) 또는 `t3.small`(x86, 2GB)
  - 스토리지: gp3 30GB 이상
  - ARM이어도 이 시스템은 그대로 빌드된다(필요한 ARM용 파일이 있음).
- **네트워크**:
  - 보안 그룹은 3.3과 같은 규칙으로 만든다.
  - **탄력적 IP**를 할당해 연결한다. 공인 IPv4는 시간당 요금이 붙는다.
- **백업 인증**: IAM 역할(5.2의 정책)을 인스턴스에 연결하면 `.env`에 액세스 키를 넣지 않아도 된다. `BACKUP_S3_ACCESS_KEY`를 비워 둔다.
- **스냅샷**: 서버 스냅샷은 **Amazon Data Lifecycle Manager**로 EBS 스냅샷을 매일 만들도록 정한다.
- **비용**: 인스턴스, 디스크, IPv4, 전송량이 따로 청구되어 Lightsail보다 계산이 복잡하다.

## 11. 운영

| 할 일 | 방법 |
|---|---|
| 업데이트 배포 | `cd /srv/taeil/deploy && sudo ./deploy.sh` (배포 전 백업, 실패 시 자동 되돌리기) |
| 백업 확인 | S3 버킷 `daily/`에 날짜별 파일이 쌓이는지 주 1회 본다. 서버 기록은 `/var/log/taeil-backup.log` |
| 복구 | `sudo ./restore.sh /srv/taeil-backups/db-…dump /srv/taeil-backups/uploads-….tar.gz`. 서버를 통째로 잃었으면 스냅샷에서 새 인스턴스를 만들거나, 새 서버에 6~8장을 다시 한 뒤 S3 백업으로 복구한다 |
| 가동 감시 | UptimeRobot 등에 `https://rent.taeil.org/api/health`를 등록한다. Lightsail 인스턴스 → **지표**에서 CPU·상태 확인 경보도 켠다 |
| 메일 상태 | SES → 계정 대시보드에서 반송률·수신거부율을 월 1회 본다(높으면 SES가 발송을 막는다) |
| 비용 | Billing → Bills에서 월 1회 확인한다(1장의 예산 알림) |

## 12. 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| HTTPS가 안 열리고 인증서 오류 | DNS A 레코드가 고정 IP를 가리키는지(4장), Lightsail 방화벽에 80·443이 열려 있는지 확인한다. `$C logs caddy`에 원인이 나온다 |
| SSH가 안 된다 | Lightsail 방화벽의 SSH 허용 IP에 지금 내 공인 IP가 있는지 확인한다(사무실 밖이면 바뀜) |
| 메일이 안 간다 | ① SES가 아직 샌드박스인지(2.2) ② `EMAIL_FROM` 도메인이 SES에서 '확인됨'인지 ③ SMTP 사용자명·비밀번호 오타(`preflight --smtp`로 확인) ④ SES 리전이 서울인지 |
| 메일이 스팸함으로 간다 | DKIM CNAME 3개가 확인됨인지, DMARC 레코드가 있는지 확인한다 |
| 빌드 중 멈추거나 메모리 부족 | 1GB 플랜이면 2GB로 올린다(Lightsail은 스냅샷으로 더 큰 플랜에 새로 만든다). 스왑이 켜져 있는지 `swapon --show`로 본다 |
| `429 Too Many Requests` (이미지 다운로드) | `.env`의 `POSTGRES_IMAGE`·`CADDY_IMAGE`가 `public.ecr.aws/...`인지 확인한다(기본값) |
| 백업이 S3에 안 올라간다 | `BACKUP_S3_URI`의 버킷 이름·`daily/` 접두사가 IAM 정책과 같은지, 액세스 키가 맞는지 확인한다. `sudo ./backup.sh`로 직접 실행하면 오류가 보인다 |
