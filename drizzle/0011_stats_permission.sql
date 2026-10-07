-- 통계 조회 권한을 기념관 내부 임직원 기본 등급에 더한다(최고 관리자는 자동으로 모든 권한).
UPDATE "admin_grades"
SET "permissions" = array_append("permissions", 'stats.view'),
    "description" = "description" || ', 통계 조회',
    "updated_at" = now()
WHERE "code" = 'staff' AND NOT ('stats.view' = ANY ("permissions"));
