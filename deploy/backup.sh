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

# 서버 밖 보관: AWS S3 또는 S3 호환 저장소(NCP Object Storage 등). .env에 BACKUP_S3_URI를 두면 올린다.
# - AWS S3: BACKUP_S3_ENDPOINT는 비우고 BACKUP_S3_REGION(기본 ap-northeast-2)과 키를 넣는다.
#   EC2에서 IAM 역할을 쓰면 키도 비워 둔다(인스턴스 메타데이터로 인증).
# - S3 호환 저장소: BACKUP_S3_ENDPOINT에 주소를 넣는다.
BACKUP_S3_URI="$(env_get BACKUP_S3_URI)"
if [ -n "$BACKUP_S3_URI" ]; then
  aws_env=(-e AWS_DEFAULT_REGION="$(env_get BACKUP_S3_REGION ap-northeast-2)")
  access_key="$(env_get BACKUP_S3_ACCESS_KEY)"
  if [ -n "$access_key" ]; then
    aws_env+=(-e AWS_ACCESS_KEY_ID="$access_key" -e AWS_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_KEY)")
  fi
  endpoint="$(env_get BACKUP_S3_ENDPOINT)"
  endpoint_arg=()
  if [ -n "$endpoint" ]; then endpoint_arg=(--endpoint-url "$endpoint"); fi
  docker run --rm --network host "${aws_env[@]}" -v "$BACKUP_DIR:/backup:ro" \
    "$(env_get BACKUP_CLI_IMAGE public.ecr.aws/aws-cli/aws-cli:latest)" \
    s3 cp /backup "$BACKUP_S3_URI" --recursive --only-show-errors \
    --exclude "*" --include "db-$STAMP.dump" --include "uploads-$STAMP.tar.gz" \
    ${endpoint_arg[@]+"${endpoint_arg[@]}"}
  echo "[$(date)] 서버 밖 보관 완료: $BACKUP_S3_URI"
fi

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "[$(date)] 백업 완료: db-$STAMP.dump uploads-$STAMP.tar.gz"
