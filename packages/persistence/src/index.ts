export {
  createDatabase,
  type LifecycleDatabase,
  type LifecycleKysely,
} from './database.ts';
export {
  createLifecycleSchema,
  dropLifecycleSchema,
  lifecycleMigration,
} from './migrations/202609040001_create_lifecycle.ts';
export { createM1CollaborationTables } from './migrations/202609050002_create_m1_collaboration_artifacts.ts';
export { createM2AgentRunTables } from './migrations/202609060004_create_m2_agent_run.ts';
export { createM2ApprovalControlTables } from './migrations/202609060005_create_m2_approval_control.ts';
export { createAIUXScopedAuthorizationTables } from './migrations/202609070006_create_scoped_action_authorizations.ts';
export { createAIUXWorkSessionTables } from './migrations/202609070007_create_product_work_sessions.ts';
export { createM2R3ArtifactCollaborationTables } from './migrations/202609080008_create_artifact_review_trace.ts';
export { createM2R3EvidenceMcpTables } from './migrations/202609080009_create_execution_evidence_mcp.ts';
export {
  PostgresIdentityRepository,
  type AccountCredentialRecord,
  type InvitationRecord,
  type SessionActorRecord,
} from './identity-repository.ts';
export { PostgresCollaborationRepository } from './collaboration-repository.ts';
export {
  PostgresArtifactRepository,
  type ArtifactMutationResult,
} from './artifact-repository.ts';
export {
  PostgresArtifactCollaborationRepository,
  type ArtifactCollaborationRepositoryPort,
  type ArtifactVersionContext,
} from './artifact-collaboration-repository.ts';
export { PostgresExecutionEvidenceRepository } from './execution-evidence-repository.ts';
export { PostgresMcpReadRepository } from './mcp-read-repository.ts';
export {
  PostgresAuthorizationPort,
  resolveRequirementActionsForRoles,
  WORK_SESSION_ROLE_ACTIONS,
} from './authorization-port.ts';
export { PostgresScopedAuthorizationRepository } from './scoped-authorization-repository.ts';
export { PostgresWorkSessionRepository } from './work-session-repository.ts';
export { PostgresAgentRunRepository } from './agent-run-repository.ts';
export { PostgresAgentApprovalRepository } from './agent-approval-repository.ts';
export { PostgresAgentControlRepository } from './agent-control-repository.ts';
export { PostgresAgentAuditRepository } from './agent-audit-repository.ts';
export { PostgresBridgeRuntimeRepository } from './bridge-runtime-repository.ts';
export { PostgresBridgePairingRepository } from './bridge-pairing-repository.ts';
export { PostgresSkillRepository } from './skill-repository.ts';
export { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';
export {
  PostgresLifecycleRepository,
  type CompleteG0RequirementWrite,
  type CreateRequirementWrite,
  type IdempotentRequirementWrite,
  type IdempotentRequirementWriteResult,
  type IdempotentQuestionWrite,
  type QuestionMutationWrite,
  type QuestionRecordWrite,
  type TimelineEventWrite,
} from './repository.ts';
