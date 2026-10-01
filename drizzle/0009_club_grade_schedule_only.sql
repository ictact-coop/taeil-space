-- 동아리 운영자 등급은 대관 일정 조회만 (2026-10-01 결정). 권한은 앱에서도 고정한다.
UPDATE "admin_grades"
SET "permissions" = '{calendar.view}',
    "description" = '대관 일정 확인만 (단체명·신청자 정보 비공개)',
    "updated_at" = now()
WHERE "code" = 'club';
