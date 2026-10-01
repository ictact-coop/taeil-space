-- 같은 공간의 점유 범위(결제대기·심사중·확정·자체행사)가 겹치지 않도록 DB가 직접 막는다. ([요구] 8장, AT-10)
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "slot_occupancies"
  ADD CONSTRAINT "slot_occupancies_no_overlap"
  EXCLUDE USING gist ("space_id" WITH =, "during" WITH &&);
--> statement-breakpoint
ALTER TABLE "slot_occupancies"
  ADD CONSTRAINT "slot_occupancies_during_valid"
  CHECK (NOT isempty("during") AND lower_inc("during") AND NOT upper_inc("during") AND NOT lower_inf("during") AND NOT upper_inf("during"));
--> statement-breakpoint
-- 감사 로그와 정책 설정 값은 추가만 가능하다. (계획서 2.7, NFR-06)
CREATE FUNCTION "forbid_append_only_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "policy_values_append_only"
  BEFORE UPDATE OR DELETE ON "policy_values"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
--> statement-breakpoint
CREATE TRIGGER "policy_values_no_truncate"
  BEFORE TRUNCATE ON "policy_values"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_append_only_mutation"();
