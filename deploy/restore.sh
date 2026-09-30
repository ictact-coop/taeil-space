#!/usr/bin/env bash
# 백업 복구. 사용: ./restore.sh /srv/taeil-backups/db-YYYYmmdd-HHMMSS.dump /srv/taeil-backups/uploads-YYYYmmdd-HHMMSS.tar.gz
# 주의: 대상 DB의 기존 데이터를 덮어쓴다. 먼저 web·worker를 멈춘다.
set -euo pipefail
cd "$(dirname "$0")"
DB_DUMP="$1"; UPLOADS_TAR="${2:-}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"

read -r -p "DB를 $DB_DUMP 로 덮어씁니다. 계속하려면 RESTORE 입력: " answer
[ "$answer" = "RESTORE" ] || { echo "취소했습니다."; exit 1; }

$COMPOSE stop web worker
if [[ "$DATABASE_URL" == *"@db:"* ]]; then
  $COMPOSE exec -T db pg_restore --clean --if-exists --no-owner -U taeil -d taeil < "$DB_DUMP"
else
  docker run --rm --network host -v "$(realpath "$DB_DUMP"):/backup.dump:ro" postgres:16 \
    pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" /backup.dump
fi
if [ -n "$UPLOADS_TAR" ]; then
  $COMPOSE run --rm --no-deps -v "$(realpath "$UPLOADS_TAR"):/backup.tar.gz:ro" --entrypoint sh web \
    -c 'rm -rf /data/uploads/* && tar xzf /backup.tar.gz -C /data'
fi
$COMPOSE up -d web worker
echo "복구 완료. 관리자 화면에서 최근 신청·첨부가 보이는지 확인하세요."
