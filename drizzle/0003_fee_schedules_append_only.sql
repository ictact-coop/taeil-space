-- 요금표 버전도 추가만 가능하다. 예약 취소·되돌리기는 새 버전을 추가한다. (계획서 2.7)
CREATE TRIGGER "fee_schedules_append_only"
  BEFORE UPDATE OR DELETE ON "fee_schedules"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "fee_schedules_no_truncate"
  BEFORE TRUNCATE ON "fee_schedules"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_append_only_mutation"();
--> statement-breakpoint
-- 공연장은 별도 이용 규정 동의가 필요하다. ([요구] 9·12장)
UPDATE "spaces" SET "extra_consents" = '["hallRules"]'::jsonb WHERE "code" = 'hall';
