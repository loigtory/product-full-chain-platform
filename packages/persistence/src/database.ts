import {
  Kysely,
  PostgresDialect,
  type ColumnType,
  type Generated,
} from 'kysely';
import pg from 'pg';

import type { M1DatabaseTables } from './m1-database.ts';
import type { M2DatabaseTables } from './m2-database.ts';
import type { M2R3DatabaseTables } from './m2-r3-database.ts';
import type { M2R3EvidenceDatabaseTables } from './m2-r3-evidence-database.ts';
import type { AIUXDatabaseTables } from './aiux-database.ts';

import type {
  EventSummary,
  GateResult,
  GateConfirmationRole,
  GateRunResult,
  LifecycleStage,
  MaterialImpactConfirmationRole,
  MaterialImpactDecision,
  MaterialImpactStatus,
  MaterialPurpose,
  MaterialSourceType,
  QuestionConfirmationRole,
  QuestionDecisionKind,
  QuestionStatus,
  SensitivityLevel,
} from '@pfc/contracts';

const { Pool } = pg;

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedTimestamp = ColumnType<Date, Date | string | undefined, never>;

export interface RequirementTable {
  id: string;
  name: string;
  original_idea: string;
  initiator_id: string;
  business_owner_id: string | null;
  current_stage: LifecycleStage;
  current_baseline_id: string | null;
  row_version: number;
  draft_source_type: MaterialSourceType | null;
  draft_source_description: string | null;
  draft_material_purpose: MaterialPurpose | null;
  draft_sensitivity: SensitivityLevel | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MaterialBaselineTable {
  id: string;
  requirement_id: string;
  version_number: number;
  status: 'CURRENT' | 'HISTORICAL' | 'CANDIDATE';
  source_type: MaterialSourceType;
  source_description: string | null;
  material_purpose: MaterialPurpose;
  sensitivity: SensitivityLevel;
  confirmed_by: string;
  confirmed_at: Timestamp;
  created_at: Timestamp;
}

export interface MaterialRefTable {
  id: string;
  baseline_id: string;
  reference_type: string;
  source: string;
  version: string | null;
  content_hash: string | null;
  location: string;
  sensitivity: SensitivityLevel;
  validity: 'VALID' | 'INVALIDATED';
  created_at: CreatedTimestamp;
}

export interface MaterialImpactAssessmentTable {
  id: string;
  requirement_id: string;
  original_baseline_id: string;
  candidate_baseline_id: string;
  recommended_stage: LifecycleStage;
  selected_stage: LifecycleStage | null;
  decision: MaterialImpactDecision | null;
  reason: string | null;
  status: MaterialImpactStatus;
  confirmed_role: MaterialImpactConfirmationRole | null;
  confirmed_by: string | null;
  confirmed_at: Timestamp | null;
  invalidated_gate_run_ids: ColumnType<unknown, unknown | undefined, unknown>;
  created_at: CreatedTimestamp;
}

export interface QuestionTable {
  id: string;
  requirement_id: string;
  baseline_id: string;
  prompt: string;
  reason: string | null;
  candidates: unknown;
  owner_id: string;
  close_by_stage: LifecycleStage;
  status: QuestionStatus;
  current_decision_id: string | null;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DecisionTable {
  id: string;
  question_id: string;
  decision_kind: QuestionDecisionKind;
  raw_answer: string;
  explanation: string | null;
  scope: unknown;
  version_number: number;
  confirmed_role: QuestionConfirmationRole | null;
  confirmed_by: string | null;
  confirmed_at: Timestamp | null;
  validity: 'CURRENT' | 'SUPERSEDED';
  supersedes_decision_id: string | null;
  created_at: CreatedTimestamp;
}

export interface GateRunTable {
  id: string;
  requirement_id: string;
  baseline_id: string;
  stage: LifecycleStage;
  mode: 'AUTOMATIC' | 'MANUAL';
  status: 'IN_PROGRESS' | 'COMPLETED';
  result: GateRunResult | null;
  validity: 'CURRENT' | 'INVALIDATED' | 'STALE_BASELINE';
  owner_id: string;
  confirmed_role: GateConfirmationRole | null;
  confirmed_by: string | null;
  confirmed_at: Timestamp | null;
  started_at: Timestamp;
  completed_at: Timestamp | null;
  failure_reason: string | null;
  unknown_reason: string | null;
  registration_note: string | null;
  created_at: CreatedTimestamp;
}

export interface GateCheckTable {
  id: string;
  gate_run_id: string;
  check_key: string;
  result: GateResult;
  reason: string | null;
  owner_id: string | null;
  close_point: string | null;
  created_at: CreatedTimestamp;
}

export interface GateRunEvidenceTable {
  gate_run_id: string;
  baseline_id: string;
  evidence_ref_id: string;
  access_decision: 'ALLOWED' | 'DENIED' | 'UNKNOWN';
  action_authorization_ref: string | null;
  created_at: CreatedTimestamp;
}

export interface StageAdvancementTable {
  id: string;
  gate_run_id: string;
  requirement_id: string;
  baseline_id: string;
  from_stage: LifecycleStage;
  to_stage: LifecycleStage;
  advanced_at: Timestamp;
}

export interface TimelineEventTable {
  sequence: Generated<number>;
  id: string;
  requirement_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  actor_id: string;
  before_summary: EventSummary | null;
  after_summary: EventSummary;
  aggregate_version: number;
  occurred_at: Timestamp;
}

export interface OutboxEventTable {
  sequence: Generated<string>;
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload_summary: EventSummary;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  occurred_at: Timestamp;
  published_at: Timestamp | null;
}

export interface AuditEventTable {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  decision: string;
  reason: string | null;
  scope_summary: EventSummary;
  request_id: string;
  occurred_at: Timestamp;
}

export interface IdempotencyRecordTable {
  id: string;
  actor_id: string;
  route: string;
  idempotency_key: string;
  request_hash: string;
  result_reference: string | null;
  response_summary: EventSummary | null;
  created_at: CreatedTimestamp;
}

export interface InformationSchemaTables {
  table_schema: string;
  table_name: string;
}

export interface LifecycleDatabase
  extends
    M1DatabaseTables,
    M2DatabaseTables,
    M2R3DatabaseTables,
    M2R3EvidenceDatabaseTables,
    AIUXDatabaseTables {
  requirements: RequirementTable;
  material_baselines: MaterialBaselineTable;
  material_refs: MaterialRefTable;
  material_impact_assessments: MaterialImpactAssessmentTable;
  questions: QuestionTable;
  decisions: DecisionTable;
  gate_runs: GateRunTable;
  gate_checks: GateCheckTable;
  gate_run_evidence: GateRunEvidenceTable;
  stage_advancements: StageAdvancementTable;
  timeline_events: TimelineEventTable;
  outbox_events: OutboxEventTable;
  audit_events: AuditEventTable;
  idempotency_records: IdempotencyRecordTable;
  'information_schema.tables': InformationSchemaTables;
}

export function createDatabase(input: {
  connectionString: string;
  maxConnections?: number;
}): Kysely<LifecycleDatabase> {
  return new Kysely<LifecycleDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: input.connectionString,
        max: input.maxConnections ?? 2,
        connectionTimeoutMillis: 3_000,
        idleTimeoutMillis: 1_000,
      }),
    }),
  });
}

export type LifecycleKysely = Kysely<LifecycleDatabase>;
