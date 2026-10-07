#!/usr/bin/env bash
# 새 서버(Ubuntu 22.04/24.04) 준비. root로 한 번 실행한다.
#   curl -fsSL https://raw.githubusercontent.com/<저장소>/<브랜치>/deploy/setup-server.sh -o setup-server.sh
#   sudo bash setup-server.sh <저장소 git 주소> [브랜치]
# 하는 일: 시간대·자동 보안 업데이트·방화벽·Docker 설치, 코드 받기, deploy/.env 만들기(비밀 값 자동 생성),
#          매일 백업 cron 등록, 메모리가 작으면 스왑 추가. 여러 번 실행해도 안전하다.
set -euo pipefail
REPO="${1:-}"
BRANCH="${2:-}"
APP_DIR="${APP_DIR:-/srv/taeil}"
BACKUP_DIR="${BACKUP_DIR:-/srv/taeil-backups}"
[ "$(id -u)" -eq 0 ] || { echo "root로 실행하세요: sudo bash $0 ..." >&2; exit 1; }
log() { echo "[setup] $*"; }

log "기본 패키지·시간대(Asia/Seoul)·자동 보안 업데이트"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw unattended-upgrades openssl >/dev/null
timedatectl set-timezone Asia/Seoul || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

log "방화벽: SSH, 80, 443만 허용"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
echo "  (클라우드 콘솔의 방화벽/ACG에서도 22는 관리자 IP만, 80·443은 전체 허용으로 맞추세요)"

if ! command -v docker >/dev/null 2>&1; then
  log "Docker 설치"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null

mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 6000 ] && ! swapon --show | grep -q .; then
  log "스왑 2GB 추가 (메모리 ${mem_mb}MB, 이미지 빌드 대비)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [ ! -d "$APP_DIR/.git" ]; then
  [ -n "$REPO" ] || { echo "처음 실행할 때는 저장소 주소가 필요합니다: sudo bash $0 <git 주소> [브랜치]" >&2; exit 1; }
  log "코드 받기: $REPO ${BRANCH:+($BRANCH)}"
  git clone ${BRANCH:+--branch "$BRANCH"} "$REPO" "$APP_DIR"
else
  log "코드가 이미 있습니다: $APP_DIR"
fi
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"

ENV_FILE="$APP_DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "deploy/.env 만들기 (암호화 키·DB 비밀번호 자동 생성)"
  cp "$APP_DIR/deploy/env.prod.example" "$ENV_FILE"
  key="$(openssl rand -base64 32)"
  dbpw="$(openssl rand -hex 24)"
  sed -i "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$key|" "$ENV_FILE"
  # GitHub 저장소면 그 저장소의 이미지(ghcr.io/<owner>/<repo>)를 받도록, 아니면 서버에서 빌드하도록
  gh_repo="$(echo "$REPO" | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/.]+)(\.git)?/?$#\2#p' | tr 'A-Z' 'a-z')"
  sed -i "s|^REGISTRY_IMAGE=.*|REGISTRY_IMAGE=${gh_repo:+ghcr.io/$gh_repo}|" "$ENV_FILE"
  sed -i "s|^LOCAL_DB_PASSWORD=.*|LOCAL_DB_PASSWORD=$dbpw|" "$ENV_FILE"
  sed -i "s|^DATABASE_URL=postgres://taeil:CHANGE_ME@db:5432/taeil|DATABASE_URL=postgres://taeil:$dbpw@db:5432/taeil|" "$ENV_FILE"
  unset key dbpw
fi
chmod 600 "$ENV_FILE"

CRON_LINE="30 3 * * * $APP_DIR/deploy/backup.sh >> /var/log/taeil-backup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qF "$APP_DIR/deploy/backup.sh"; then
  log "매일 03:30 백업 cron 등록"
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
fi

cat <<MSG

[setup] 완료. 다음 순서로 진행하세요.
  1) DNS: SITE_DOMAIN의 A 레코드를 이 서버 공인 IP로 지정
  2) $ENV_FILE 편집: SITE_DOMAIN, ACME_EMAIL, APP_BASE_URL, EMAIL_FROM, SMTP_URL
     ※ APP_ENCRYPTION_KEY는 자동 생성됐습니다. 이 값을 비밀번호 관리자 등 서버 밖에 꼭 따로 보관하세요.
  3) cd $APP_DIR/deploy && ./deploy.sh
  4) 첫 관리자·기본 데이터·점검은 docs/DEPLOYMENT.md 2.4절
MSG
