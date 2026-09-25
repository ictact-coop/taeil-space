import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** PostgreSQL tstzrange. 값은 '[2026-10-22 05:00:00+00,2026-10-22 08:00:00+00)' 형태의 문자열. */
const tstzrange = customType<{ data: string }>({
  dataType: () => "tstzrange",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── 관리자·인증 ─────────────────────────────────────────────

/** 대관 담당자 / 회계 담당자 / 시스템 관리자 ([요구] 5장) */
export const adminRole = pgEnum("admin_role", ["rental", "accounting", "system"]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginId: text("login_id").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: adminRole("role").notNull(),
  /** AES-256-GCM으로 암호화한 TOTP 비밀키 */
  totpSecretEnc: text("totp_secret_enc"),
  /** 등록 확인 전의 TOTP 비밀키 */
  totpPendingSecretEnc: text("totp_pending_secret_enc"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** 마지막으로 사용한 TOTP 시간 단계. 같은 코드 재사용을 막는다. */
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** 세션 토큰의 SHA-256 해시. 원문 토큰은 쿠키에만 있다. */
    id: text("id").primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("admin_sessions_user_idx").on(t.adminUserId)],
);

// ─── 감사 로그 (추가만 가능, 트리거로 수정·삭제 차단) ─────────────

export const auditActorType = pgEnum("audit_actor_type", ["admin", "system", "applicant"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: auditActorType("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

// ─── 정책 설정 (값 버전, 추가만 가능) ────────────────────────────

export const policyValues = pgTable(
  "policy_values",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("policy_values_key_effective_idx").on(t.key, t.effectiveFrom.desc(), t.id.desc())],
);

// ─── 공간·운영 일정 ─────────────────────────────────────────────

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    /** 최소 인원(공연장 20명, BR-08). 없으면 제한 없음. */
    minHeadcount: integer("min_headcount"),
    description: text("description").notNull().default(""),
    equipment: jsonb("equipment").$type<string[]>().notNull().default([]),
    notice: text("notice").notNull().default(""),
    /** 신청기한: 이용일 며칠 전까지. null이면 접수기간(booking_windows)으로 관리(교육실). */
    leadDays: integer("lead_days"),
    slotMinutes: integer("slot_minutes").notNull().default(60),
    minDurationMinutes: integer("min_duration_minutes").notNull().default(60),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    /** 공간별 추가 동의 항목 키 (예: hallRules). 목록은 src/domain/spaces/consents.ts */
    extraConsents: jsonb("extra_consents").$type<string[]>().notNull().default([]),
    isPublic: boolean("is_public").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("spaces_capacity_positive", sql`${t.capacity} > 0`),
    check("spaces_slot_positive", sql`${t.slotMinutes} > 0`),
  ],
);

/**
 * 휴관 규칙 (계획서 2.6).
 * weekly: 매주 weekday(0=일~6=토) / annual: 매년 month-day / date_range: start_date~end_date
 * open_exception: start_date~end_date는 다른 규칙과 상관없이 개관
 */
export const closureRuleType = pgEnum("closure_rule_type", [
  "weekly",
  "annual",
  "date_range",
  "open_exception",
]);

export const closureRules = pgTable(
  "closure_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: closureRuleType("type").notNull(),
    name: text("name").notNull(),
    /** 이용자에게 보여줄 안내 문구 */
    publicMessage: text("public_message").notNull(),
    /** null이면 전체 공간 */
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    weekday: smallint("weekday"),
    month: smallint("month"),
    day: smallint("day"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** 규칙 자체의 유효기간(예: 2027년부터 화요일 휴관). null이면 무기한. */
    activeFrom: date("active_from"),
    activeUntil: date("active_until"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    ...timestamps,
  },
  (t) => [
    check(
      "closure_rules_shape",
      sql`(
        (${t.type} = 'weekly' and ${t.weekday} between 0 and 6)
        or (${t.type} = 'annual' and ${t.month} between 1 and 12 and ${t.day} between 1 and 31)
        or (${t.type} in ('date_range', 'open_exception') and ${t.startDate} is not null and ${t.endDate} is not null and ${t.startDate} <= ${t.endDate})
      )`,
    ),
  ],
);

export const scheduleBlockKind = pgEnum("schedule_block_kind", ["event", "maintenance", "temporary"]);

/** 자체행사·시설점검·임시차단 (시간 단위). 등록 시 공간별로 slot_occupancies(kind=block)를 만든다. */
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: scheduleBlockKind("kind").notNull(),
    /** null이면 전체 공간 */
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    ...timestamps,
  },
  (t) => [check("schedule_blocks_range", sql`${t.startsAt} < ${t.endsAt}`)],
);

/** 교육실처럼 관리자가 공개한 기간 안에서만 신청받는 공간의 접수기간. 가장 최근 행이 유효하다. */
export const bookingWindows = pgTable(
  "booking_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    opensFrom: date("opens_from").notNull(),
    opensUntil: date("opens_until").notNull(),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("booking_windows_range", sql`${t.opensFrom} <= ${t.opensUntil}`)],
);

// ─── 요금·감면 ──────────────────────────────────────────────────

/**
 * 요금표 버전 (추가만 가능, 트리거로 수정·삭제 차단).
 * 적용 시각이 가장 늦으면서 기준 시각 이전인 행이 적용된다. 같은 시각이면 id가 큰 행.
 * items 형식은 src/domain/pricing/fee-schedule.ts
 */
export const feeSchedules = pgTable(
  "fee_schedules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    items: jsonb("items").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fee_schedules_effective_idx").on(t.effectiveFrom.desc(), t.id.desc())],
);

export const discountKind = pgEnum("discount_kind", ["percent", "amount"]);

/** 감면 규칙. 신청 건에는 적용 당시 규칙 내용을 스냅샷으로 남긴다. */
export const discountRules = pgTable(
  "discount_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: discountKind("kind").notNull(),
    /** percent: 1~100, amount: 원 */
    value: integer("value").notNull(),
    proofRequired: boolean("proof_required").notNull().default(true),
    /** 증빙 안내 문구 (예: 비영리단체 고유번호증 사본) */
    proofGuide: text("proof_guide").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => adminUsers.id),
    ...timestamps,
  },
  (t) => [
    check(
      "discount_rules_value_range",
      sql`(${t.kind} = 'percent' and ${t.value} between 1 and 100) or (${t.kind} = 'amount' and ${t.value} > 0)`,
    ),
  ],
);

// ─── 단체·신청 ──────────────────────────────────────────────────

export const orgRegType = pgEnum("org_reg_type", ["unique_no", "business_no"]);

/** 고유번호·사업자등록번호로 판별한 단체 (계획서 2.5) */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  regType: orgRegType("reg_type").notNull(),
  /** 하이픈을 뺀 숫자 10자리 */
  regNo: text("reg_no").notNull().unique(),
  latestName: text("latest_name").notNull(),
  ...timestamps,
});

/** 계획서 2.3 상태 모델 */
export const applicationStatus = pgEnum("application_status", [
  "draft",
  "pending_payment",
  "payment_expired",
  "submitted",
  "reviewing",
  "revision_requested",
  "closed_revision_expired",
  "rejected",
  "withdrawn",
  "confirmed",
  "cancel_requested",
  "cancelled",
  "refunded",
  "completed",
]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 예: R202610-00125 */
    applicationNo: text("application_no").notNull().unique(),
    status: applicationStatus("status").notNull().default("draft"),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    orgName: text("org_name").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email").notNull(),
    eventTitle: text("event_title").notNull(),
    eventPurpose: text("event_purpose").notNull(),
    expectedHeadcount: integer("expected_headcount").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    nightManagerName: text("night_manager_name"),
    nightManagerPhone: text("night_manager_phone"),
    /** 결제 시점의 요금 계산 항목 */
    priceSnapshot: jsonb("price_snapshot"),
    /** 결제 시점의 요금표·감면·환불 규정 버전 등 (계획서 2.7) */
    policySnapshot: jsonb("policy_snapshot"),
    totalAmount: integer("total_amount"),
    consents: jsonb("consents").$type<Record<string, string>>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => adminUsers.id),
    decisionReason: text("decision_reason"),
    ...timestamps,
  },
  (t) => [
    check("applications_range", sql`${t.startsAt} < ${t.endsAt}`),
    check("applications_headcount_positive", sql`${t.expectedHeadcount} > 0`),
    index("applications_status_idx").on(t.status),
    index("applications_org_idx").on(t.organizationId, t.startsAt),
    index("applications_space_idx").on(t.spaceId, t.startsAt),
  ],
);

export const applicationStatusHistory = pgTable(
  "application_status_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: applicationStatus("from_status"),
    toStatus: applicationStatus("to_status").notNull(),
    actorType: auditActorType("actor_type").notNull(),
    actorId: text("actor_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_status_history_app_idx").on(t.applicationId)],
);

// ─── 일정 점유 (이중 예약 방지의 핵심, 배제 제약은 SQL 마이그레이션) ───

export const occupancyKind = pgEnum("occupancy_kind", [
  "pending_payment",
  "held",
  "confirmed",
  "block",
]);

export const slotOccupancies = pgTable(
  "slot_occupancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** 준비·철수 완충시간을 포함한 점유 범위 */
    during: tstzrange("during").notNull(),
    kind: occupancyKind("kind").notNull(),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    scheduleBlockId: uuid("schedule_block_id").references(() => scheduleBlocks.id, {
      onDelete: "cascade",
    }),
    /** pending_payment의 결제 유효시간 */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "slot_occupancies_owner",
      sql`(
        (${t.kind} = 'block' and ${t.scheduleBlockId} is not null and ${t.applicationId} is null)
        or (${t.kind} <> 'block' and ${t.applicationId} is not null and ${t.scheduleBlockId} is null)
      )`,
    ),
    check(
      "slot_occupancies_expiry",
      sql`(${t.kind} = 'pending_payment') = (${t.expiresAt} is not null)`,
    ),
    uniqueIndex("slot_occupancies_application_uq").on(t.applicationId),
  ],
);

// ─── 결제·환불 ──────────────────────────────────────────────────

export const paymentMethod = pgEnum("payment_method", ["pg", "bank_transfer", "free"]);
export const paymentStatus = pgEnum("payment_status", ["ready", "paid", "failed", "cancelled"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    /** 멱등성 키. PG에 넘기는 주문번호. */
    orderId: text("order_id").notNull().unique(),
    method: paymentMethod("method").notNull(),
    amount: integer("amount").notNull(),
    status: paymentStatus("status").notNull().default("ready"),
    providerTxId: text("provider_tx_id"),
    providerRaw: jsonb("provider_raw"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("payments_amount_nonnegative", sql`${t.amount} >= 0`),
    index("payments_application_idx").on(t.applicationId),
  ],
);

export const refundBasis = pgEnum("refund_basis", [
  "rejected",
  "revision_expired",
  "withdrawn",
  "cancelled",
  "venue_fault",
  "late_payment",
]);
export const refundStatus = pgEnum("refund_status", ["requested", "succeeded", "failed"]);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    basis: refundBasis("basis").notNull(),
    ratePercent: integer("rate_percent").notNull(),
    amount: integer("amount").notNull(),
    status: refundStatus("status").notNull().default("requested"),
    reason: text("reason"),
    providerRaw: jsonb("provider_raw"),
    failureReason: text("failure_reason"),
    attemptCount: integer("attempt_count").notNull().default(0),
    requestedBy: uuid("requested_by").references(() => adminUsers.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("refunds_amount_positive", sql`${t.amount} > 0`),
    check("refunds_rate_range", sql`${t.ratePercent} between 0 and 100`),
    index("refunds_status_idx").on(t.status),
  ],
);
