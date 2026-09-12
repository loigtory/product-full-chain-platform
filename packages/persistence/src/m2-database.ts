import type { ColumnType } from 'kysely';

import type {
  AgentApprovalKind,
  AgentRunAccessMode,
  AgentRunResultOutcome,
  AgentRunEventType,
  AgentRunOperation,
  AgentRunStatus,
  SkillEvaluationStatus,
  SkillReleaseStatus,
  SkillRiskLevel,
  SkillSourceType,
} from '@pfc/contracts';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface SkillReleaseTable {
  id: string;
  skill_key: string;
  display_name: string;
  description: string;
  source_type: SkillSourceType;
  logical_source: string;
  version: string;
  content_hash: string;
  license: string | null;
  compatible_harnesses: unknown;
  required_capabilities: unknown;
  risk_level: SkillRiskLevel;
  owner: string;
  evaluation_status: SkillEvaluationStatus;
  enabled_scopes: unknown;
  context_cost: number | null;
  status: SkillReleaseStatus;
  created_at: Timestamp;
}

export interface BridgeRegistrationTable {
  id: string;
  team_id: string;
  credential_digest: string;
  protocol_version: string;
  bridge_version: string;
  node_version: string;
  codex_version: string | null;
  zed_version: string | null;
  status: 'OFFLINE' | 'ONLINE' | 'DEGRADED' | 'REVOKED';
  last_heartbeat_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface BridgePairingTable {
  id: string;
  team_id: string;
  code_digest: string;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_by: string;
  created_at: Timestamp;
}

export interface BridgeWorkspaceBindingTable {
  bridge_id: string;
  workspace_id: string;
  repository_fingerprint: string;
  allowed_relative_path: string;
  verification_status: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  current_git_baseline: string | null;
  verified_at: Timestamp | null;
  created_at: Timestamp;
}

export interface BridgeCapabilitySnapshotTable {
  id: string;
  bridge_id: string;
  capabilities: unknown;
  captured_at: Timestamp;
  expires_at: Timestamp;
}

export interface BridgeMessageReceiptTable {
  bridge_id: string;
  message_id: string;
  nonce: string;
  sent_at: Timestamp;
  received_at: Timestamp;
}

export interface AgentRunTable {
  id: string;
  requirement_id: string;
  baseline_id: string;
  workspace_id: string;
  git_baseline: string;
  skill_release_id: string;
  operation: AgentRunOperation;
  access_mode: AgentRunAccessMode;
  status: AgentRunStatus;
  parent_run_id: string | null;
  bridge_id: string | null;
  execution_instance_id: string | null;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  result_outcome: AgentRunResultOutcome | null;
  run_scope: unknown | null;
  run_scope_hash: string | null;
  execution_started_at: Timestamp | null;
  cancel_requested_at: Timestamp | null;
  terminal_at: Timestamp | null;
  result_summary: string | null;
  failure_reason: string | null;
  row_version: number;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AgentRunEventTable {
  id: string;
  run_id: string;
  sequence: number;
  event_type: AgentRunEventType;
  summary: unknown;
  source_bridge_id: string | null;
  source_event_id: string | null;
  occurred_at: Timestamp;
  received_at: Timestamp;
}

export interface AgentRunCommandTable {
  id: string;
  run_id: string;
  command_type:
    | 'START_READ_ONLY_RUN'
    | 'START_WORKSPACE_WRITE_RUN'
    | 'RESOLVE_APPROVAL'
    | 'INTERRUPT_RUN'
    | 'VERIFY_RUN_STATE';
  payload: unknown;
  status:
    | 'PENDING'
    | 'LEASED'
    | 'ACKNOWLEDGED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'UNKNOWN'
    | 'FAILED';
  priority: number;
  execution_instance_id: string | null;
  lease_owner: string | null;
  lease_until: Timestamp | null;
  attempt: number;
  idempotency_key: string;
  result_summary: unknown | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ApprovalRequestTable {
  id: string;
  run_id: string;
  execution_instance_id: string;
  app_server_request_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  item_id: string | null;
  callback_id: string | null;
  kind: AgentApprovalKind;
  requested_scope: unknown;
  approved_scope: unknown | null;
  scope_hash: string;
  outside_capsule: boolean;
  decision:
    'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | 'CANCELLED';
  requested_by: string;
  requested_at: Timestamp;
  expires_at: Timestamp;
  decided_by: string | null;
  decided_at: Timestamp | null;
  reason_code: string | null;
  row_version: number;
}

export interface AgentRunCapsuleTable {
  id: string;
  run_id: string;
  execution_instance_id: string;
  source_git_baseline: string;
  scope_hash: string;
  before_manifest_hash: string;
  after_manifest_hash: string | null;
  diff_summary: unknown | null;
  lifecycle: 'MATERIALIZED' | 'RUNNING' | 'VERIFIED' | 'CLEANED' | 'UNKNOWN';
  created_at: Timestamp;
  verified_at: Timestamp | null;
  cleaned_at: Timestamp | null;
}

export interface M2DatabaseTables {
  skill_releases: SkillReleaseTable;
  bridge_pairings: BridgePairingTable;
  bridge_registrations: BridgeRegistrationTable;
  bridge_workspace_bindings: BridgeWorkspaceBindingTable;
  bridge_capability_snapshots: BridgeCapabilitySnapshotTable;
  bridge_message_receipts: BridgeMessageReceiptTable;
  agent_runs: AgentRunTable;
  agent_run_events: AgentRunEventTable;
  agent_run_commands: AgentRunCommandTable;
  approval_requests: ApprovalRequestTable;
  agent_run_capsules: AgentRunCapsuleTable;
}
