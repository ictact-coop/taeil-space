#!/usr/bin/env bash
# 배포·업데이트. 서버의 /srv/taeil/deploy 에서 실행한다.
#   ./deploy.sh             현재 브랜치의 최신 코드로 배포
#   ./deploy.sh v1.0.0      태그·브랜치·커밋을 지정해 배포
#   ./deploy.sh --no-pull   코드를 받지 않고 지금 작업 트리로 배포(리허설용)
#   SKIP_BUILD=1 ./deploy.sh  이미 있는 APP_IMAGE로 배포(다른 곳에서 빌드한 이미지를 쓸 때)
#   BUILD_ON_SERVER=1 ./deploy.sh  REGISTRY_IMAGE가 있어도 서버에서 빌드(GitHub 이미지를 못 받을 때)
# 이미지: .env에 REGISTRY_IMAGE(예: ghcr.io/ictact-coop/taeil-space)가 있으면 GitHub Actions가 빌드한
#   그 커밋의 이미지를 받는다(서버에서 빌드하지 않음, 작은 서버 권장). 없으면 서버에서 빌드한다.
# 순서: 설정 검사 → 코드 받기 → 이미지 준비(받기 또는 빌드) → 배포 전 백업 → 마이그레이션 → web·worker 교체 → 상태 확인.
# 새 web이 정상(healthy)이 되지 않으면 직전 이미지로 되돌린다. 마이그레이션은 되돌리지 않으므로(추가 위주로 작성)
# 데이터까지 되돌려야 하면 배포 전 백업을 restore.sh로 복구한다.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
REF="${1:-}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

# 1. 설정 검사
for k in SITE_DOMAIN APP_BASE_URL DATABASE_URL APP_ENCRYPTION_KEY; do
  [ -n "$(env_get "$k")" ] || { echo "deploy/.env의 $k가 비어 있습니다." >&2; exit 1; }
done
if uses_local_db; then
  pw="$(env_get LOCAL_DB_PASSWORD)"
  [ -n "$pw" ] && [ "$pw" != "CHANGE_ME" ] || { echo "LOCAL_DB_PASSWORD를 설정하세요(DATABASE_URL의 비밀번호와 같게)." >&2; exit 1; }
  [[ "$(env_get DATABASE_URL)" == *"@db:5432/"* ]] || echo "경고: localdb를 쓰는데 DATABASE_URL이 @db:5432를 가리키지 않습니다." >&2
fi
[ "$(env_get PAYMENT_FAKE)" != "1" ] || { echo "PAYMENT_FAKE=1은 운영에서 쓸 수 없습니다." >&2; exit 1; }

# 2. 코드 받기
cd "$DEPLOY_DIR/.."
if [ "$REF" != "--no-pull" ]; then
  git fetch --tags --prune origin
  if [ -n "$REF" ]; then git checkout --quiet "$REF"; fi
  if git symbolic-ref -q HEAD >/dev/null; then git pull --ff-only --quiet; fi
fi
VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
log "배포 버전: $VERSION ($(git log -1 --format=%s 2>/dev/null || true))"
cd "$DEPLOY_DIR"

# 3. 이미지 준비. 되돌리기용으로 지금 실행 중인 web의 이미지를 :previous로 보관한다
PREVIOUS="${APP_IMAGE%%:*}:previous"
running_web="$($COMPOSE ps -q web 2>/dev/null || true)"
if [ -n "$running_web" ]; then
  docker tag "$(docker inspect --format '{{.Image}}' "$running_web")" "$PREVIOUS"
fi
REGISTRY_IMAGE="$(env_get REGISTRY_IMAGE)"
PULL_WAIT="${PULL_WAIT:-900}"
if [ "${SKIP_BUILD:-}" = "1" ]; then
  docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || { echo "SKIP_BUILD=1인데 이미지 $APP_IMAGE가 없습니다." >&2; exit 1; }
  log "빌드 건너뜀: $APP_IMAGE 사용"
elif [ -n "$REGISTRY_IMAGE" ] && [ "${BUILD_ON_SERVER:-}" != "1" ] && [ "$REF" != "--no-pull" ]; then
  # main에 병합되면 GitHub Actions(Release image)가 몇 분 안에 이 커밋의 이미지를 올린다. 아직이면 기다린다.
  src="$REGISTRY_IMAGE:$(git -C "$DEPLOY_DIR/.." rev-parse HEAD)"
  log "이미지 받기: $src"
  err="$(mktemp)"
  deadline=$((SECONDS + PULL_WAIT))
  until docker pull --quiet "$src" >/dev/null 2>"$err"; do
    if grep -qiE "denied|unauthorized|authentication required" "$err"; then
      cat "$err" >&2
      echo "이미지를 받을 권한이 없습니다. GitHub에서 패키지를 공개로 바꾸거나, 서버에서 한 번 docker login ghcr.io를 하세요(docs/DEPLOYMENT.md 2.6)." >&2
      rm -f "$err"; exit 1
    fi
    if [ $SECONDS -ge $deadline ]; then
      cat "$err" >&2
      echo "이미지가 아직 없습니다. GitHub Actions의 'Release image' 실행 결과를 확인하세요." >&2
      echo "급하면 서버에서 빌드할 수 있습니다(느림): BUILD_ON_SERVER=1 ./deploy.sh" >&2
      rm -f "$err"; exit 1
    fi
    log "아직 이미지가 없습니다(GitHub에서 빌드 중일 수 있음). 30초 뒤 다시 시도합니다."
    sleep 30
  done
  rm -f "$err"
  docker tag "$src" "$APP_IMAGE"
else
  log "이미지 빌드(서버)"
  $COMPOSE build migrate
fi
docker tag "$APP_IMAGE" "${APP_IMAGE%%:*}:$VERSION"

# 4. 배포 전 백업 (처음 배포라 DB가 아직 없으면 건너뜀)
if [ -n "$running_web" ]; then
  log "배포 전 백업"
  ./backup.sh || { echo "백업에 실패했습니다. 원인을 확인한 뒤 다시 배포하세요(SKIP_BACKUP=1로 건너뛸 수 있음)." >&2; [ "${SKIP_BACKUP:-}" = "1" ] || exit 1; }
fi

# 5. 실행 (migrate가 먼저 돌고 끝나야 web·worker가 뜬다)
log "마이그레이션과 서비스 교체"
if ! $COMPOSE up -d --no-build --remove-orphans; then
  echo "서비스 시작에 실패했습니다. 마이그레이션 로그:" >&2
  $COMPOSE logs --tail=50 migrate >&2 || true
  exit 1
fi

# 6. 상태 확인
wait_healthy() { # wait_healthy 초 → 마지막 상태를 status에 남긴다
  local deadline=$((SECONDS + $1)) cid
  status="starting"
  while [ $SECONDS -lt $deadline ]; do
    cid="$($COMPOSE ps -q web)"
    status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)"
    [ "$status" = "healthy" ] && return 0
    sleep 3
  done
  return 1
}
log "web 상태 확인(최대 ${HEALTH_TIMEOUT}초)"
if ! wait_healthy "$HEALTH_TIMEOUT"; then
  echo "새 버전이 정상 상태가 되지 않았습니다(상태: $status)." >&2
  $COMPOSE logs --tail=60 web >&2 || true
  if [ -n "$running_web" ] && docker image inspect "$PREVIOUS" >/dev/null 2>&1; then
    echo "직전 이미지로 되돌립니다." >&2
    docker tag "$PREVIOUS" "$APP_IMAGE"
    $COMPOSE up -d --no-build --no-deps --force-recreate web worker
    if wait_healthy "$HEALTH_TIMEOUT"; then
      echo "되돌렸습니다(직전 버전이 정상 동작 중). 데이터까지 되돌려야 하면 restore.sh로 배포 전 백업을 복구하세요." >&2
    else
      echo "되돌린 버전도 정상 상태가 아닙니다(상태: $status). 로그를 확인하세요: $COMPOSE logs web" >&2
    fi
  fi
  exit 1
fi
$COMPOSE ps
log "배포 완료: $VERSION — https://$(env_get SITE_DOMAIN)/api/health"
log "점검: $COMPOSE run --rm --no-deps web pnpm preflight"
docker image prune -f --filter "until=720h" >/dev/null 2>&1 || true
