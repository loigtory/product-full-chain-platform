import { createHash } from 'node:crypto';

import type {
  ActionProposalDisplayDiffDto,
  ActionProposalTargetDto,
  ActorRole,
  ContextBindingDto,
  ProductWorkSessionEventDto,
  ProductWorkSessionEventType,
} from '@pfc/contracts';
import type { LifecycleKysely } from '@pfc/persistence';

const scenarioIds = [
  'AIUX-DATA-01',
  'AIUX-DATA-02',
  'AIUX-DATA-03',
  'AIUX-DATA-04',
  'AIUX-DATA-05',
  'AIUX-DATA-06',
  'AIUX-DATA-07',
  'AIUX-DATA-08',
  'AIUX-DATA-09',
  'AIUX-DATA-10',
  'AIUX-DATA-11',
  'AIUX-DATA-12',
] as const;

const accountRoles = {
  productManager: 'PRODUCT_MANAGER',
  productOwner: 'PRODUCT_OWNER',
  businessOwner: 'BUSINESS_OWNER',
  engineeringOwner: 'ENGINEERING_OWNER',
  testOwner: 'TEST_OWNER',
  releaseOwner: 'RELEASE_OWNER',
  teamAdmin: 'TEAM_ADMIN',
} as const satisfies Readonly<Record<string, ActorRole>>;

function normalizeRunId(runId: string): { id: string; schema: string } {
  const id = runId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  const schema = runId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40);
  if (!id || !schema) throw new Error('AIUX_TEST_RUN_ID_REQUIRED');
  return { id, schema };
}

export function createAIWorkSessionTestData(runId: string) {
  const normalized = normalizeRunId(runId);
  const prefix = `CODEx_TEST_AIUX_${normalized.id}_`;
  const makeId = (suffix: string) => `${prefix}${suffix}`;
  const now = '2026-09-07T03:00:00.000Z';
  const turnAt = '2026-09-07T03:05:00.000Z';
  const materialContent = '完全合成的 AI 产品作业材料正文。';
  const materialContentHash = `sha256:${createHash('sha256')
    .update(materialContent)
    .digest('hex')}`;
  const skillContentHash = `sha256:${'e'.repeat(64)}`;
  const grantExpiresAt = '2026-09-07T03:30:00.000Z';
  const accounts = Object.fromEntries(
    Object.entries(accountRoles).map(([key, role]) => [
      key,
      { id: makeId(`ACTOR_${role}`), role },
    ]),
  ) as {
    [Key in keyof typeof accountRoles]: Readonly<{
      id: string;
      role: (typeof accountRoles)[Key];
    }>;
  };
  const teamId = makeId('TEAM_1');
  const requirementId = makeId('REQ_1');
  const baselineId = makeId('BASELINE_1');
  const materialRefId = makeId('MATERIAL_1');
  const questionId = makeId('QUESTION_1');
  const artifactId = makeId('ARTIFACT_1');
  const artifactVersionId = makeId('ARTIFACT_VERSION_1');
  const workspaceId = makeId('WORKSPACE_1');
  const skillReleaseId = makeId('SKILL_RELEASE_1');
  const bridgeId = makeId('BRIDGE_1');
  const authorizationId = makeId('AUTHORIZATION_1');
  const sessionId = makeId('SESSION_1');
  const turnId = makeId('TURN_1');
  const contextBindingId = makeId('CONTEXT_1');
  const proposalId = makeId('PROPOSAL_1');
  const commandId = makeId('COMMAND_1');
  const createdIds = [
    ...Object.values(accounts).map((account) => account.id),
    teamId,
    requirementId,
    baselineId,
    materialRefId,
    questionId,
    artifactId,
    artifactVersionId,
    workspaceId,
    skillReleaseId,
    bridgeId,
    authorizationId,
    sessionId,
    turnId,
    contextBindingId,
    proposalId,
    commandId,
  ];

  return {
    prefix,
    schemaName: `codex_test_aiux_${normalized.schema}`,
    now,
    turnAt,
    grantExpiresAt,
    skillContentHash,
    accounts,
    teamId,
    requirementId,
    baselineId,
    materialRefId,
    questionId,
    artifactId,
    artifactVersionId,
    workspaceId,
    skillReleaseId,
    bridgeId,
    authorizationId,
    sessionId,
    turnId,
    contextBindingId,
    proposalId,
    commandId,
    scenarioIds,
    createdIds,
    sessionEvent(
      type: ProductWorkSessionEventType,
      sequence: number,
    ): ProductWorkSessionEventDto {
      return {
        schemaVersion: 'product-work-session-event/1',
        eventId: makeId(`SESSION_EVENT_${sequence}`),
        sessionId,
        sequence,
        type,
        aggregateRef: { type: 'product-work-session', id: sessionId },
        safeSummary: { type, sequence },
        occurredAt: turnAt,
        receivedAt: turnAt,
      };
    },
    contextBinding(): ContextBindingDto {
      return {
        schemaVersion: 'product-work-context-binding/1',
        id: contextBindingId,
        sessionId,
        turnId,
        contextType: 'MATERIAL_REF',
        targetId: materialRefId,
        targetVersion: 1,
        contentHash: materialContentHash,
        bindingRole: 'SOURCE',
        sensitivity: 'INTERNAL',
        invalidatedAt: null,
        reasonCode: null,
        createdAt: turnAt,
      };
    },
    startCommand() {
      return {
        id: commandId,
        turnId,
        commandType: 'START_PRODUCT_WORK_TURN' as const,
        payloadSummary: {
          sessionId,
          turnId,
          contextBindingIds: [contextBindingId],
          contextHash: `sha256:${'b'.repeat(64)}`,
        },
        requiredCapability: 'product-work-turn/1',
        idempotencyKey: `${turnId}:start:v1`,
        createdAt: turnAt,
      };
    },
    actionProposalInput() {
      const target: ActionProposalTargetDto = {
        aggregateType: 'QUESTION',
        aggregateId: questionId,
        rowVersion: 0,
      };
      const displayDiff: readonly ActionProposalDisplayDiffDto[] = [
        {
          field: 'answer',
          before: null,
          after: '以材料基线版本作为评审依据。',
        },
      ];
      return {
        id: proposalId,
        sessionId,
        turnId,
        kind: 'ANSWER_QUESTION' as const,
        target,
        changeSet: {
          kind: 'ANSWER_QUESTION' as const,
          questionId,
          answer: '以材料基线版本作为评审依据。',
        },
        displayDiff,
        confirmationRequirement: 'PRODUCT_MANAGER' as const,
        createdAt: turnAt,
      };
    },
    async seedPrerequisites(database: LifecycleKysely): Promise<void> {
      const db = database.withSchema(`codex_test_aiux_${normalized.schema}`);
      await db
        .insertInto('accounts')
        .values(
          Object.values(accounts).map((account, index) => ({
            id: account.id,
            login_name: `codex_test_aiux_${normalized.schema}_${index}`,
            display_name: `AIUX synthetic ${account.role}`,
            password_hash: 'CODEx_TEST_HASH',
            password_salt: 'CODEx_TEST_SALT',
            status: 'ACTIVE' as const,
            row_version: 0,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();
      await db
        .insertInto('teams')
        .values({
          id: teamId,
          name: `CODEx TEST AIUX ${normalized.id}`,
          status: 'ACTIVE',
          owner_account_id: accounts.productOwner.id,
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('team_memberships')
        .values(
          Object.values(accounts).map((account) => ({
            team_id: teamId,
            account_id: account.id,
            role: account.role,
            status: 'ACTIVE' as const,
            joined_at: now,
            created_at: now,
          })),
        )
        .execute();
      await db
        .insertInto('requirements')
        .values({
          id: requirementId,
          name: 'AI 原生产品作业空间合成需求',
          original_idea: '通过连续会话梳理材料、问题、产物与执行证据。',
          initiator_id: accounts.productManager.id,
          business_owner_id: accounts.businessOwner.id,
          current_stage: 'G0',
          current_baseline_id: null,
          row_version: 0,
          draft_source_type: 'INTERNAL_IMPROVEMENT',
          draft_source_description: '完全合成的本地验证材料。',
          draft_material_purpose: 'FACT',
          draft_sensitivity: 'INTERNAL',
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('requirement_assignments')
        .values(
          Object.values(accounts).map((account) => ({
            requirement_id: requirementId,
            team_id: teamId,
            account_id: account.id,
            responsibility: account.role,
            status: 'ACTIVE' as const,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();
      await db
        .insertInto('material_baselines')
        .values({
          id: baselineId,
          requirement_id: requirementId,
          version_number: 1,
          status: 'CURRENT',
          source_type: 'INTERNAL_IMPROVEMENT',
          source_description: null,
          material_purpose: 'FACT',
          sensitivity: 'INTERNAL',
          confirmed_by: accounts.productOwner.id,
          confirmed_at: now,
          created_at: now,
        })
        .execute();
      await db
        .updateTable('requirements')
        .set({ current_baseline_id: baselineId })
        .where('id', '=', requirementId)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('material_refs')
        .values({
          id: materialRefId,
          baseline_id: baselineId,
          reference_type: 'SYNTHETIC_TEXT',
          source: materialContent,
          version: '1',
          content_hash: materialContentHash,
          location: 'synthetic://aiux/material-1',
          sensitivity: 'INTERNAL',
          validity: 'VALID',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('questions')
        .values({
          id: questionId,
          requirement_id: requirementId,
          baseline_id: baselineId,
          prompt: '评审应绑定哪个材料版本？',
          reason: '验证建议确认链路。',
          candidates: JSON.stringify([]),
          owner_id: accounts.productManager.id,
          close_by_stage: 'G1',
          status: 'OPEN',
          current_decision_id: null,
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('artifacts')
        .values({
          id: artifactId,
          requirement_id: requirementId,
          cap_id: 'CAP-PFC-02',
          stage: 'G0',
          artifact_type: 'PRD',
          title: 'AIUX 合成 PRD',
          status: 'ACTIVE',
          current_version_id: null,
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('artifact_versions')
        .values({
          id: artifactVersionId,
          artifact_id: artifactId,
          version_label: 'V0.1',
          source_type: 'CONTROLLED_REFERENCE',
          source_ref: 'synthetic://aiux/artifact-v1',
          content_hash: `sha256:${'c'.repeat(64)}`,
          sensitivity: 'INTERNAL',
          created_by: accounts.productManager.id,
          created_at: now,
        })
        .execute();
      await db
        .updateTable('artifacts')
        .set({ current_version_id: artifactVersionId })
        .where('id', '=', artifactId)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('workspaces')
        .values({
          id: workspaceId,
          team_id: teamId,
          name: 'AIUX synthetic workspace',
          repository_label: 'synthetic-local-repository',
          repository_fingerprint: `sha256:${'d'.repeat(64)}`,
          status: 'ACTIVE',
          verification_status: 'VERIFIED',
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('requirement_workspaces')
        .values({
          requirement_id: requirementId,
          team_id: teamId,
          workspace_id: workspaceId,
          allowed_relative_path: 'synthetic/aiux',
          access_level: 'READ',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('skill_releases')
        .values({
          id: skillReleaseId,
          skill_key: 'pfc-ai-product-work-session',
          display_name: 'AI 产品作业会话',
          description: '使用合成上下文生成类型化产品建议。',
          source_type: 'LOCAL_ALLOWLIST',
          logical_source: 'project-skill:pfc-ai-product-work-session',
          version: '2026.09.07-r1',
          content_hash: skillContentHash,
          license: null,
          compatible_harnesses: JSON.stringify(['codex-app-server/0.153']),
          required_capabilities: JSON.stringify(['PRODUCT_WORK_TURN']),
          risk_level: 'LOW',
          owner: '产品平台组',
          evaluation_status: 'PASSED',
          enabled_scopes: JSON.stringify(['PRODUCT_WORK_TURN']),
          context_cost: null,
          status: 'ACTIVE',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('bridge_registrations')
        .values({
          id: bridgeId,
          team_id: teamId,
          credential_digest: `sha256:${'f'.repeat(64)}`,
          protocol_version: 'pfc-bridge/1',
          bridge_version: '0.1.0',
          node_version: '24.20.0',
          codex_version: '0.153.4',
          zed_version: null,
          status: 'ONLINE',
          last_heartbeat_at: turnAt,
          revoked_at: null,
          created_at: now,
          updated_at: turnAt,
        })
        .execute();
      await db
        .insertInto('bridge_workspace_bindings')
        .values({
          bridge_id: bridgeId,
          workspace_id: workspaceId,
          repository_fingerprint: `sha256:${'d'.repeat(64)}`,
          allowed_relative_path: 'synthetic/aiux',
          verification_status: 'VERIFIED',
          current_git_baseline: null,
          verified_at: now,
          created_at: now,
        })
        .execute();
      await db
        .insertInto('bridge_capability_snapshots')
        .values({
          id: makeId('BRIDGE_CAPABILITY_1'),
          bridge_id: bridgeId,
          capabilities: JSON.stringify({
            snapshotVersion: 'pfc-bridge-capabilities/1',
            capturedAt: turnAt,
            runtime: {
              nodeVersion: '24.20.0',
              codexAppServer: 'AVAILABLE',
              zedCli: 'UNAVAILABLE',
            },
            workspaces: [
              {
                workspaceId,
                gitBaseline: 'd'.repeat(64),
              },
            ],
            skills: [
              { releaseId: skillReleaseId, contentHash: skillContentHash },
            ],
            productWorkTurn: {
              state: 'AVAILABLE',
              protocolVersion: 'product-work-turn/1',
            },
          }),
          captured_at: turnAt,
          expires_at: grantExpiresAt,
        })
        .execute();
    },
  } as const;
}
