#!/usr/bin/env bash
# 백업 복구. 사용: ./restore.sh /srv/taeil-backups/db-YYYYmmdd-HHMMSS.dump [/srv/taeil-backups/uploads-YYYYmmdd-HHMMSS.tar.gz]
# 주의: 대상 DB의 기존 데이터를 덮어쓴다. web·worker를 멈췄다가 다시 켠다.
# 확인 질문 없이 실행하려면 RESTORE_CONFIRM=RESTORE (복구 연습 자동화용)
set -euo pipefail
[ $# -ge 1 ] || { echo "사용법: $0 <db-덤프> [uploads-tar]" >&2; exit 1; }
DB_DUMP="$(realpath "$1")"; UPLOADS_TAR="${2:+$(realpath "$2")}"
source "$(dirname "$0")/lib.sh"
[ -f "$DB_DUMP" ] || { echo "덤프 파일이 없습니다: $DB_DUMP" >&2; exit 1; }

answer="${RESTORE_CONFIRM:-}"
[ -n "$answer" ] || read -r -p "DB를 $DB_DUMP 로 덮어씁니다. 계속하려면 RESTORE 입력: " answer
[ "$answer" = "RESTORE" ] || { echo "취소했습니다."; exit 1; }

# 덮어쓰기 전에 지금 상태를 한 번 더 백업해 둔다(복구를 되돌릴 수 있게)
log "복구 전 안전 백업"
./backup.sh

log "web·worker 중지"
$COMPOSE stop web worker
# 중간에 실패해도 서비스는 다시 켠다
trap '$COMPOSE up -d web worker >/dev/null 2>&1 || true' EXIT
# --clean은 작업 큐(pg-boss)의 분할 테이블에서 실패하므로, 스키마를 비운 뒤 한 트랜잭션으로 복원한다
RESET_SQL="drop schema if exists pgboss cascade; drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;"
if uses_local_db; then
  $COMPOSE exec -T db psql -U taeil -d taeil -v ON_ERROR_STOP=1 -q -c "$RESET_SQL"
  $COMPOSE exec -T db pg_restore --no-owner --single-transaction --exit-on-error -U taeil -d taeil < "$DB_DUMP"
else
  url="$(env_get DATABASE_URL)"
  docker run --rm --network host "$POSTGRES_IMAGE" psql "$url" -v ON_ERROR_STOP=1 -q -c "$RESET_SQL"
  docker run --rm --network host -v "$DB_DUMP:/backup.dump:ro" "$POSTGRES_IMAGE" \
    pg_restore --no-owner --single-transaction --exit-on-error --dbname "$url" /backup.dump
fi
log "DB 복구 완료"
if [ -n "$UPLOADS_TAR" ]; then
  # 백업 파일은 root 전용(600)이라 컨테이너에 표준입력으로 넘긴다
  $COMPOSE run --rm --no-deps -T --entrypoint sh web -c 'rm -rf /data/uploads/* && tar xzf - -C /data' < "$UPLOADS_TAR"
  log "업로드 파일 복구 완료"
fi
$COMPOSE up -d web worker
trap - EXIT
log "복구 완료. 관리자 화면에서 최근 신청·첨부가 보이는지 확인하세요."
