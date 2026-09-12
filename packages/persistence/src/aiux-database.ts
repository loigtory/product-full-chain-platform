import type { ColumnType } from 'kysely';

import type {
  ActionProposalKind,
  ActionProposalStatus,
  ActorRole,
  ContextBindingRole,
  LifecycleStage,
  ProductWorkContextType,
  ProductWorkSessionEventType,
  ProductWorkSessionStatus,
  ProductWorkTurnStatus,
  SensitivityLevel,
  TransmissionTarget,
} from '@pfc/contracts';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface ScopedActionAuthorizationTable {
  id: string;
  actor_id: string;
  requirement_id: string;
  action: 'TRANSMIT_MATERIAL';
  target: TransmissionTarget;
  purpose: string;
  scope_hash: string;
  status: 'GRANTED' | 'REVOKED' | 'UNKNOWN';
  valid_from: Timestamp;
  valid_until: Timestamp;
  granted_by: string;
  granted_at: Timestamp;
  revoked_by: string | null;
  revoked_at: Timestamp | null;
  row_version: number;
}

export interface ScopedActionAuthorizationMaterialRefTable {
  authorization_id: string;
  material_ref_id: string;
}

export interface ProductWorkSessionTable {
  id: string;
  team_id: string;
  requirement_id: string;
  opened_requirement_version: number;
  current_requirement_version: number;
  opened_baseline_id: string | null;
  opened_stage: LifecycleStage;
  status: ProductWorkSessionStatus;
  control_surface: 'WEB';
  active_turn_id: string | null;
  last_sequence: number;
  owner_id: string;
  title: string | null;
  block_reason: string | null;
  row_version: number;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

export interface ProductWorkTurnTable {
  id: string;
  session_id: string;
  sequence: number;
  intent_kind: string;
  input_text: string;
  visible_response: string | null;
  status: ProductWorkTurnStatus;
  skill_release_id: string;
  bridge_id: string | null;
  external_thread_id: string | null;
  external_turn_id: string | null;
  usage_summary: unknown | null;
  failure_reason: string | null;
  recovery_action: string | null;
  content_retention_until: Timestamp | null;
  redacted_at: Timestamp | null;
  row_version: number;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  terminal_at: Timestamp | null;
}

export interface ProductWorkContextBindingTable {
  id: string;
  session_id: string;
  turn_id: string;
  context_type: ProductWorkContextType;
  target_id: string;
  target_version: number | null;
  content_hash: string;
  binding_role: ContextBindingRole;
  sensitivity: SensitivityLevel;
  invalidated_at: Timestamp | null;
  reason_code: string | null;
  created_at: Timestamp;
}

export interface ProductActionProposalTable {
  id: string;
  session_id: string;
  turn_id: string;
  kind: ActionProposalKind;
  schema_version: 'product-action-proposal/1';
  target_type:
    | 'REQUIREMENT'
    | 'QUESTION'
    | 'ARTIFACT'
    | 'AGENT_RUN'
    | 'TRACE_LINK'
    | 'MCP_CAPABILITY';
  target_id: string;
  target_version: number;
  change_set: unknown;
  display_diff: unknown;
  scope_hash: string;
  confirmation_requirement: ActorRole;
  status: ActionProposalStatus;
  confirmed_by: string | null;
  confirmed_at: Timestamp | null;
  reason_code: string | null;
  apply_lease_owner: string | null;
  apply_lease_until: Timestamp | null;
  apply_attempt: number;
  result_type: string | null;
  result_id: string | null;
  result_version: number | null;
  failure_reason: string | null;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProductWorkSessionEventTable {
  id: string;
  session_id: string;
  sequence: number;
  event_type: ProductWorkSessionEventType;
  aggregate_type: string;
  aggregate_id: string;
  safe_summary: unknown;
  source_event_id: string | null;
  occurred_at: Timestamp;
  received_at: Timestamp;
}

export interface ProductWorkTurnCommandTable {
  id: string;
  turn_id: string;
  command_type:
    | 'START_PRODUCT_WORK_TURN'
    | 'INTERRUPT_PRODUCT_WORK_TURN'
    | 'VERIFY_PRODUCT_WORK_TURN'
    | 'EXECUTE_MCP_READ';
  payload_summary: unknown;
  status:
    | 'PENDING'
    | 'LEASED'
    | 'ACKNOWLEDGED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'UNKNOWN'
    | 'FAILED';
  required_capability: string;
  lease_owner: string | null;
  lease_until: Timestamp | null;
  attempt: number;
  idempotency_key: string;
  result_summary: unknown | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AIUXDatabaseTables {
  scoped_action_authorizations: ScopedActionAuthorizationTable;
  scoped_action_authorization_material_refs: ScopedActionAuthorizationMaterialRefTable;
  product_work_sessions: ProductWorkSessionTable;
  product_work_turns: ProductWorkTurnTable;
  product_work_context_bindings: ProductWorkContextBindingTable;
  product_action_proposals: ProductActionProposalTable;
  product_work_session_events: ProductWorkSessionEventTable;
  product_work_turn_commands: ProductWorkTurnCommandTable;
}
