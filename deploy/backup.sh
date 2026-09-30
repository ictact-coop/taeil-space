#!/usr/bin/env bash
# DB와 업로드 파일 백업. cron 예: 30 3 * * * /srv/taeil/deploy/backup.sh >> /var/log/taeil-backup.log 2>&1
# 관리형 DB의 자동 백업과 별도로, 복구 연습이 가능한 논리 백업을 남긴다.
set -euo pipefail
cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-/srv/taeil-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
mkdir -p "$BACKUP_DIR"

# DB: 앱 이미지 안의 pg_dump 대신 postgres:16 이미지로 덤프 (버전 일치)
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
if [[ "$DATABASE_URL" == *"@db:"* ]]; then  # 같은 VM의 DB(--profile localdb)
  $COMPOSE exec -T db pg_dump --format=custom --no-owner -U taeil taeil > "$BACKUP_DIR/db-$STAMP.dump"
else
  docker run --rm --network host postgres:16 pg_dump --format=custom --no-owner "$DATABASE_URL" > "$BACKUP_DIR/db-$STAMP.dump"
fi

# 업로드 파일 (첨부·공간 사진)
$COMPOSE run --rm --no-deps -v "$BACKUP_DIR:/backup" --entrypoint tar web czf "/backup/uploads-$STAMP.tar.gz" -C /data uploads

# 서버 밖 보관: S3 호환 오브젝트 스토리지(NCP Object Storage 등). .env에 BACKUP_S3_URI 등을 두면 올린다.
BACKUP_S3_URI="$(grep -E '^BACKUP_S3_URI=' .env | cut -d= -f2- || true)"
if [ -n "$BACKUP_S3_URI" ]; then
  docker run --rm -e AWS_ACCESS_KEY_ID="$(grep -E '^BACKUP_S3_ACCESS_KEY=' .env | cut -d= -f2-)" \
    -e AWS_SECRET_ACCESS_KEY="$(grep -E '^BACKUP_S3_SECRET_KEY=' .env | cut -d= -f2-)" \
    -v "$BACKUP_DIR:/backup:ro" amazon/aws-cli s3 cp /backup "$BACKUP_S3_URI" --recursive \
    --exclude "*" --include "db-$STAMP.dump" --include "uploads-$STAMP.tar.gz" \
    --endpoint-url "$(grep -E '^BACKUP_S3_ENDPOINT=' .env | cut -d= -f2-)"
fi

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "[$(date)] 백업 완료: db-$STAMP.dump uploads-$STAMP.tar.gz"
