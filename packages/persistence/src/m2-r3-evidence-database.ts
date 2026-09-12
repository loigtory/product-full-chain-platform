import type { ColumnType } from 'kysely';

import type {
  ExecutionEvidenceOutcome,
  ExecutionEvidenceSourceType,
  McpCapabilityEffect,
  McpCapabilityStatus,
  McpReadStatus,
  SensitivityLevel,
} from '@pfc/contracts';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface ExecutionEvidenceTable {
  id: string;
  requirement_id: string;
  baseline_id: string;
  source_type: ExecutionEvidenceSourceType;
  source_id: string;
  outcome: ExecutionEvidenceOutcome;
  safe_summary: string;
  content_hash: string;
  sensitivity: SensitivityLevel;
  artifact_version_id: string | null;
  gate_run_id: string | null;
  retention_class: 'PRODUCT_FACT' | 'GATE_EVIDENCE';
  created_at: Timestamp;
}

export interface McpCapabilityRegistrationTable {
  id: string;
  logical_capability_id: string;
  server_name: string;
  tool_name: string;
  input_schema_hash: string;
  config_fingerprint: string;
  effect: McpCapabilityEffect;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  max_input_bytes: number;
  max_output_bytes: number;
  timeout_ms: number;
  allowed_team_ids: unknown;
  allowed_requirement_ids: unknown;
  status: McpCapabilityStatus;
  reviewed_by: string;
  reviewed_at: Timestamp;
  review_evidence_ref: string;
  row_version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface McpReadRequestTable {
  id: string;
  session_id: string;
  turn_id: string;
  requirement_id: string;
  team_id: string;
  capability_id: string;
  artifact_version_id: string;
  input_payload: unknown;
  input_hash: string;
  sensitivity: SensitivityLevel;
  material_ref_ids: unknown;
  status: McpReadStatus;
  bridge_id: string | null;
  external_thread_id: string | null;
  output_summary: string | null;
  output_hash: string | null;
  output_bytes: number | null;
  output_truncated: boolean;
  duration_ms: number | null;
  evidence_id: string | null;
  failure_reason: string | null;
  recovery_action: string | null;
  row_version: number;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  terminal_at: Timestamp | null;
}

export interface M2R3EvidenceDatabaseTables {
  execution_evidence: ExecutionEvidenceTable;
  mcp_capability_registrations: McpCapabilityRegistrationTable;
  mcp_read_requests: McpReadRequestTable;
}
