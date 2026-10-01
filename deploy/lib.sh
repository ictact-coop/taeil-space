# deploy/*.sh 공용. source 해서 쓴다.
# .env 값 읽기(따옴표 제거), compose 명령, 프로필.
set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_DIR"
[ -f .env ] || { echo "deploy/.env가 없습니다. env.prod.example을 복사해 채우세요(setup-server.sh가 만들어 줍니다)." >&2; exit 1; }

env_get() { # env_get KEY [기본값]
  local line
  line="$(grep -E "^$1=" .env | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  echo "${line:-${2:-}}"
}

export COMPOSE_PROFILES="$(env_get COMPOSE_PROFILES)"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.prod.yml --env-file $DEPLOY_DIR/.env"
APP_IMAGE="$(env_get APP_IMAGE taeil-space:latest)"
POSTGRES_IMAGE="$(env_get POSTGRES_IMAGE postgres:16)"
uses_local_db() { [[ ",$COMPOSE_PROFILES," == *",localdb,"* ]]; }
log() { echo "[$(date '+%F %T')] $*"; }
