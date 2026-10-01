#!/usr/bin/env bash
# DB와 업로드 파일 백업. cron 예: 30 3 * * * /srv/taeil/deploy/backup.sh >> /var/log/taeil-backup.log 2>&1
# 관리형 DB의 자동 백업과 별도로, 복구 연습이 가능한 논리 백업을 남긴다.
source "$(dirname "$0")/lib.sh"
BACKUP_DIR="${BACKUP_DIR:-/srv/taeil-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# DB: 앱 이미지 안의 pg_dump 대신 postgres 이미지로 덤프 (버전 일치)
DATABASE_URL="$(env_get DATABASE_URL)"
if uses_local_db; then  # 같은 VM의 DB
  $COMPOSE exec -T db pg_dump --format=custom --no-owner -U taeil taeil > "$BACKUP_DIR/db-$STAMP.dump"
else
  docker run --rm --network host "$POSTGRES_IMAGE" pg_dump --format=custom --no-owner "$DATABASE_URL" > "$BACKUP_DIR/db-$STAMP.dump"
fi

# 업로드 파일 (첨부·공간 사진)
# (컨테이너 사용자는 호스트 백업 폴더에 쓸 수 없으므로 표준출력으로 받는다)
$COMPOSE run --rm --no-deps -T --entrypoint tar web czf - -C /data uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz"
chmod 600 "$BACKUP_DIR/db-$STAMP.dump" "$BACKUP_DIR/uploads-$STAMP.tar.gz"

# 서버 밖 보관: S3 호환 오브젝트 스토리지(NCP Object Storage 등). .env에 BACKUP_S3_URI 등을 두면 올린다.
BACKUP_S3_URI="$(env_get BACKUP_S3_URI)"
if [ -n "$BACKUP_S3_URI" ]; then
  docker run --rm -e AWS_ACCESS_KEY_ID="$(env_get BACKUP_S3_ACCESS_KEY)" \
    -e AWS_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_KEY)" \
    -v "$BACKUP_DIR:/backup:ro" amazon/aws-cli s3 cp /backup "$BACKUP_S3_URI" --recursive \
    --exclude "*" --include "db-$STAMP.dump" --include "uploads-$STAMP.tar.gz" \
    --endpoint-url "$(env_get BACKUP_S3_ENDPOINT)"
fi

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "[$(date)] 백업 완료: db-$STAMP.dump uploads-$STAMP.tar.gz"
