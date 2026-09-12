import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresAgentApprovalRepository,
  PostgresAgentAuditRepository,
  PostgresAgentControlRepository,
  PostgresAgentRunRepository,
  PostgresBridgePairingRepository,
  PostgresBridgeRuntimeRepository,
  PostgresSkillRepository,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2AgentRunTables,
  createM2ApprovalControlTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createAgentApproval } from '../../packages/domain/src/index.ts';
import {
  createM2R1TestData,
  createM2R2TestData,
} from '../../packages/test-data/src/index.ts';
import { parseBridgeCommand } from '../../packages/protocol/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const testRunId = process.env.CODEX_TEST_RUN_ID ?? 'R1_PERSISTENCE';
const schemaName = `codex_test_m2_${testRunId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM2R1TestData(testRunId);

if (connectionString) {
  describe('M2 R1 AgentRun persistence', () => {
    const database = createDatabase({ connectionString });
    const approvals = new PostgresAgentApprovalRepository(database, schemaName);
    const controls = new PostgresAgentControlRepository(database, schemaName);
    const audit = new PostgresAgentAuditRepository(database, schemaName);
    const skills = new PostgresSkillRepository(database, schemaName);
    const runs = new PostgresAgentRunRepository(database, schemaName);
    const pairings = new PostgresBridgePairingRepository(database, schemaName);
    const bridgeRuntime = new PostgresBridgeRuntimeRepository(
      database,
      schemaName,
    );

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
      await createM2AgentRunTables(database, schemaName);
      await createM2ApprovalControlTables(database, schemaName);
      const scoped = database.withSchema(schemaName);
      await scoped
        .insertInto('accounts')
        .values([
          {
            id: fixture.accountId,
            login_name: `codex_test_${testRunId.toLowerCase()}`,
            display_name: '测试产品负责人',
            password_hash: 'CODEx_TEST_HASH',
            password_salt: 'CODEx_TEST_SALT',
            status: 'ACTIVE',
            row_version: 0,
            created_at: fixture.now,
            updated_at: fixture.now,
          },
          {
            id: `${fixture.accountId}_APPROVER`,
            login_name: `codex_test_${testRunId.toLowerCase()}_approver`,
            display_name: '测试研发审批人',
            password_hash: 'CODEx_TEST_HASH',
            password_salt: 'CODEx_TEST_SALT',
            status: 'ACTIVE',
            row_version: 0,
            created_at: fixture.now,
            updated_at: fixture.now,
          },
        ])
        .execute();
      await scoped
        .insertInto('teams')
        .values({
          id: fixture.teamId,
          name: `CODEx TEST M2 ${testRunId}`,
          status: 'ACTIVE',
          owner_account_id: fixture.accountId,
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('team_memberships')
        .values({
          team_id: fixture.teamId,
          account_id: fixture.accountId,
          role: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          joined_at: fixture.now,
          created_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('requirements')
        .values({
          id: fixture.requirementId,
          name: 'M2 只读产物检查',
          original_idea: '检查当前需求产物的结构完整性。',
          initiator_id: fixture.accountId,
          business_owner_id: fixture.accountId,
          current_stage: 'G1',
          current_baseline_id: null,
          row_version: 0,
          draft_source_type: null,
          draft_source_description: null,
          draft_material_purpose: null,
          draft_sensitivity: null,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('material_baselines')
        .values({
          id: fixture.baselineId,
          requirement_id: fixture.requirementId,
          version_number: 1,
          status: 'CURRENT',
          source_type: 'INTERNAL_IMPROVEMENT',
          source_description: null,
          material_purpose: 'FACT',
          sensitivity: 'INTERNAL',
          confirmed_by: fixture.accountId,
          confirmed_at: fixture.now,
          created_at: fixture.now,
        })
        .execute();
      await scoped
        .updateTable('requirements')
        .set({ current_baseline_id: fixture.baselineId })
        .where('id', '=', fixture.requirementId)
        .execute();
      await scoped
        .insertInto('artifacts')
        .values({
          id: fixture.artifactId,
          requirement_id: fixture.requirementId,
          cap_id: 'CAP-PFC-03',
          stage: 'G1',
          artifact_type: 'REQUIREMENT_SPEC',
          title: 'M2 只读检查产物',
          status: 'ACTIVE',
          current_version_id: null,
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('artifact_versions')
        .values({
          id: fixture.artifactVersionId,
          artifact_id: fixture.artifactId,
          version_label: 'v1',
          source_type: 'WORKSPACE_RELATIVE',
          source_ref: fixture.artifact.sourceRef,
          content_hash: fixture.artifact.contentHash,
          sensitivity: 'INTERNAL',
          created_by: fixture.accountId,
          created_at: fixture.now,
        })
        .execute();
      await scoped
        .updateTable('artifacts')
        .set({ current_version_id: fixture.artifactVersionId })
        .where('id', '=', fixture.artifactId)
        .execute();
      await scoped
        .insertInto('workspaces')
        .values({
          id: fixture.workspaceId,
          team_id: fixture.teamId,
          name: 'M2 test workspace',
          repository_label: 'product-full-chain-platform',
          repository_fingerprint: `sha256:${'b'.repeat(64)}`,
          status: 'ACTIVE',
          verification_status: 'VERIFIED',
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('requirement_assignments')
        .values({
          requirement_id: fixture.requirementId,
          team_id: fixture.teamId,
          account_id: fixture.accountId,
          responsibility: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('requirement_workspaces')
        .values({
          requirement_id: fixture.requirementId,
          team_id: fixture.teamId,
          workspace_id: fixture.workspaceId,
          allowed_relative_path: 'docs/requirements',
          access_level: 'READ',
          created_at: fixture.now,
        })
        .execute();
      await skills.registerRelease({
        id: fixture.skillReleaseId,
        skillKey: fixture.skill.key,
        displayName: '只读产物检查',
        description: '核对已登记产物的结构和证据链。',
        logicalSource: 'project-skill:pfc-readonly-artifact-check',
        version: fixture.skill.version,
        contentHash: fixture.skill.contentHash,
        compatibleHarnesses: ['codex-app-server/0.148'],
        owner: '产品平台组',
        now: fixture.now,
      });
      await scoped
        .insertInto('bridge_registrations')
        .values({
          id: fixture.bridgeId,
          team_id: fixture.teamId,
          credential_digest: `sha256:${'c'.repeat(64)}`,
          protocol_version: 'pfc-bridge/1',
          bridge_version: '0.1.0',
          node_version: '24.20.0',
          codex_version: '0.148.0',
          zed_version: 'e17dc4f9',
          status: 'ONLINE',
          last_heartbeat_at: fixture.now,
          revoked_at: null,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('bridge_workspace_bindings')
        .values({
          bridge_id: fixture.bridgeId,
          workspace_id: fixture.workspaceId,
          repository_fingerprint: `sha256:${'b'.repeat(64)}`,
          allowed_relative_path: 'docs/requirements',
          verification_status: 'VERIFIED',
          current_git_baseline: null,
          verified_at: fixture.now,
          created_at: fixture.now,
        })
        .execute();
      const capabilityRecorded = await bridgeRuntime.recordCapabilitySnapshot({
        id: `${fixture.bridgeId}_CAPABILITY_INITIAL`,
        bridgeId: fixture.bridgeId,
        snapshot: {
          snapshotVersion: 'pfc-bridge-capabilities/1',
          capturedAt: fixture.now,
          runtime: {
            nodeVersion: 'v24.20.0',
            codexAppServer: 'AVAILABLE',
            zedCli: 'UNVERIFIED',
          },
          workspaces: [
            {
              workspaceId: fixture.workspaceId,
              gitBaseline: fixture.gitBaseline,
            },
          ],
          skills: [
            {
              releaseId: fixture.skillReleaseId,
              contentHash: fixture.skill.contentHash,
            },
          ],
        },
        receivedAt: fixture.now,
        expiresAt: '2026-09-06T03:01:30.000Z',
      });
      expect(capabilityRecorded).toBe(true);
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('creates and reads a fixed SkillRelease without local path content', async () => {
      const created = await skills.findRelease(
        fixture.skill.key,
        fixture.skill.version,
      );

      await expect(skills.listActive()).resolves.toEqual([created]);
      expect(created).not.toHaveProperty('absolutePath');
      await expect(
        skills.registerRelease({
          id: `${fixture.skillReleaseId}_DUPLICATE`,
          skillKey: fixture.skill.key,
          displayName: '重复',
          description: '重复版本',
          logicalSource: 'project-skill:duplicate',
          version: fixture.skill.version,
          contentHash: fixture.skill.contentHash,
          compatibleHarnesses: ['codex-app-server/0.148'],
          owner: '产品平台组',
          now: fixture.now,
        }),
      ).rejects.toThrow();
    });

    it('registers ProductWorkTurn as a SkillRelease scope and rejects unknown scopes', async () => {
      const release = await skills.registerRelease({
        id: `${fixture.skillReleaseId}_PRODUCT_WORK`,
        skillKey: `${fixture.skill.key}-product-work`,
        displayName: 'AI product work session',
        description: 'Synthetic ProductWorkTurn compatibility release.',
        logicalSource: 'project-skill:pfc-ai-product-work-session',
        version: 'CODEx_TEST_2026.09.08',
        contentHash: `sha256:${'d'.repeat(64)}`,
        compatibleHarnesses: ['codex-app-server/0.148'],
        requiredCapabilities: ['PRODUCT_WORK_TURN'],
        enabledScopes: ['PRODUCT_WORK_TURN'],
        riskLevel: 'MEDIUM',
        owner: 'CODEx_TEST_SKILL_OWNER',
        now: fixture.now,
      });

      expect(release).toMatchObject({
        requiredCapabilities: ['PRODUCT_WORK_TURN'],
        enabledScopes: ['PRODUCT_WORK_TURN'],
      });
      await expect(
        skills.registerRelease({
          id: `${fixture.skillReleaseId}_UNKNOWN_SCOPE`,
          skillKey: `${fixture.skill.key}-unknown-scope`,
          displayName: 'Unknown scope',
          description: 'Must be rejected before persistence.',
          logicalSource: 'project-skill:unknown',
          version: 'CODEx_TEST_UNKNOWN',
          contentHash: `sha256:${'e'.repeat(64)}`,
          compatibleHarnesses: ['codex-app-server/0.148'],
          requiredCapabilities: ['UNKNOWN_SCOPE'],
          enabledScopes: ['UNKNOWN_SCOPE'],
          owner: 'CODEx_TEST_SKILL_OWNER',
          now: fixture.now,
        }),
      ).rejects.toThrow('SKILL_ENABLED_SCOPE_INVALID');
    });

    it('creates the R2 approval, capsule, outcome, and control-command schema', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', schemaName)
        .where('table_name', 'in', ['approval_requests', 'agent_run_capsules'])
        .orderBy('table_name')
        .execute();
      expect(tables.map((item) => item.table_name)).toEqual([
        'agent_run_capsules',
        'approval_requests',
      ]);
    });

    it('persists a four-eyes approval and queues one exact callback decision', async () => {
      const scoped = database.withSchema(schemaName);
      const runId = `${fixture.runId}_WRITE`;
      const approvalId = `${fixture.runId}_APPROVAL`;
      const executionInstanceId = `${fixture.runId}_EXECUTION`;
      const requestedScope = {
        allowedRelativePaths: ['docs/requirements/acceptance.md'],
        allowedActions: ['EDIT_FILES'] as const,
        networkAccess: false,
        maxChangedFiles: 1,
        maxChangedBytes: 20_000,
      };
      const scopeHash = `sha256:${'a'.repeat(64)}`;
      await scoped
        .insertInto('agent_runs')
        .values({
          id: runId,
          requirement_id: fixture.requirementId,
          baseline_id: fixture.baselineId,
          workspace_id: fixture.workspaceId,
          git_baseline: fixture.gitBaseline,
          skill_release_id: fixture.skillReleaseId,
          operation: 'CONTROLLED_ARTIFACT_EDIT',
          access_mode: 'WORKSPACE_WRITE',
          status: 'RUNNING',
          parent_run_id: null,
          bridge_id: fixture.bridgeId,
          execution_instance_id: executionInstanceId,
          codex_thread_id: 'CODEx_TEST_M2_THREAD_WRITE',
          codex_turn_id: 'CODEx_TEST_M2_TURN_WRITE',
          result_outcome: null,
          run_scope: {
            ...requestedScope,
            expiresAt: '2026-09-06T03:20:00.000Z',
          },
          run_scope_hash: scopeHash,
          execution_started_at: fixture.now,
          cancel_requested_at: null,
          terminal_at: null,
          result_summary: null,
          failure_reason: null,
          row_version: 0,
          created_by: fixture.accountId,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('agent_run_events')
        .values({
          id: `${runId}_RUNNING_EVENT`,
          run_id: runId,
          sequence: 1,
          event_type: 'TURN_STARTED',
          summary: { status: 'RUNNING' },
          source_bridge_id: fixture.bridgeId,
          source_event_id: `${runId}_SOURCE_RUNNING`,
          occurred_at: fixture.now,
          received_at: fixture.now,
        })
        .execute();
      const pending = createAgentApproval({
        id: approvalId,
        runId,
        executionInstanceId,
        appServerRequestId: 'CODEx_TEST_M2_APP_REQUEST_WRITE',
        threadId: 'CODEx_TEST_M2_THREAD_WRITE',
        turnId: 'CODEx_TEST_M2_TURN_WRITE',
        itemId: 'CODEx_TEST_M2_ITEM_WRITE',
        callbackId: null,
        kind: 'FILE_CHANGE',
        requestedScope,
        scopeHash,
        requestedBy: fixture.accountId,
        requestedAt: fixture.now,
        expiresAt: '2026-09-06T03:10:00.000Z',
      });

      await expect(
        approvals.createApproval({
          approval: pending,
          eventId: `${approvalId}_REQUEST_EVENT`,
          mutation: {
            actorId: fixture.accountId,
            eventId: `${approvalId}_REQUEST_TIMELINE`,
            outboxId: `${approvalId}_REQUEST_OUTBOX`,
            auditId: `${approvalId}_REQUEST_AUDIT`,
            requestId: `${approvalId}_REQUEST_HTTP`,
            eventType: 'agent-approval.requested',
            aggregateType: 'agent-approval',
            aggregateId: approvalId,
            aggregateVersion: 0,
            requirementId: fixture.requirementId,
            occurredAt: fixture.now,
            route: `/api/v1/bridge/runs/${runId}/approvals`,
            idempotencyKey: `${approvalId}:request`,
            requestHash: `${approvalId}_REQUEST_HASH`,
            idempotencyId: `${approvalId}_REQUEST_IDEMPOTENCY`,
          },
        }),
      ).resolves.toMatchObject({ status: 'CREATED' });
      await expect(approvals.findApproval(approvalId)).resolves.toMatchObject({
        decision: 'PENDING',
        scopeHash,
      });
      await expect(runs.findRun(runId)).resolves.toMatchObject({
        status: 'WAITING_APPROVAL',
      });

      const decidedAt = '2026-09-06T03:05:00.000Z';
      await expect(
        approvals.decideApproval({
          approvalId,
          expectedRowVersion: 0,
          decision: {
            decision: 'APPROVED',
            approvedScope: { ...requestedScope, maxChangedBytes: 10_000 },
            decidedBy: `${fixture.accountId}_APPROVER`,
            decidedAt,
            reasonCode: 'SCOPE_REVIEWED',
          },
          eventId: `${approvalId}_DECISION_EVENT`,
          command: {
            id: `${approvalId}_DECISION_COMMAND`,
            idempotencyKey: `${approvalId}:decision`,
            payload: { approvalId, decision: 'APPROVED' },
          },
          mutation: {
            actorId: `${fixture.accountId}_APPROVER`,
            eventId: `${approvalId}_DECISION_TIMELINE`,
            outboxId: `${approvalId}_DECISION_OUTBOX`,
            auditId: `${approvalId}_DECISION_AUDIT`,
            requestId: `${approvalId}_DECISION_HTTP`,
            eventType: 'agent-approval.resolved',
            aggregateType: 'agent-approval',
            aggregateId: approvalId,
            aggregateVersion: 1,
            requirementId: fixture.requirementId,
            occurredAt: decidedAt,
            route: `/api/v1/agent-approvals/${approvalId}/decision`,
            idempotencyKey: `${approvalId}:decision`,
            requestHash: `${approvalId}_DECISION_HASH`,
            idempotencyId: `${approvalId}_DECISION_IDEMPOTENCY`,
          },
        }),
      ).resolves.toMatchObject({
        status: 'DECIDED',
        approval: { decision: 'APPROVED', rowVersion: 1 },
      });
      await expect(
        approvals.decideApproval({
          approvalId,
          expectedRowVersion: 0,
          decision: {
            decision: 'REJECTED',
            decidedBy: `${fixture.accountId}_APPROVER`,
            decidedAt,
            reasonCode: 'REPLAY',
          },
          eventId: `${approvalId}_REPLAY_EVENT`,
          command: {
            id: `${approvalId}_REPLAY_COMMAND`,
            idempotencyKey: `${approvalId}:replay`,
            payload: { approvalId, decision: 'REJECTED' },
          },
          mutation: {
            actorId: `${fixture.accountId}_APPROVER`,
            eventId: `${approvalId}_REPLAY_TIMELINE`,
            outboxId: `${approvalId}_REPLAY_OUTBOX`,
            auditId: `${approvalId}_REPLAY_AUDIT`,
            requestId: `${approvalId}_REPLAY_HTTP`,
            eventType: 'agent-approval.resolved',
            aggregateType: 'agent-approval',
            aggregateId: approvalId,
            aggregateVersion: 1,
            requirementId: fixture.requirementId,
            occurredAt: decidedAt,
            route: `/api/v1/agent-approvals/${approvalId}/decision`,
            idempotencyKey: `${approvalId}:replay`,
            requestHash: `${approvalId}_REPLAY_HASH`,
            idempotencyId: `${approvalId}_REPLAY_IDEMPOTENCY`,
          },
        }),
      ).resolves.toMatchObject({ status: 'CONFLICT' });
      const commands = await scoped
        .selectFrom('agent_run_commands')
        .select(['command_type', 'priority'])
        .where('run_id', '=', runId)
        .execute();
      expect(commands).toEqual([
        { command_type: 'RESOLVE_APPROVAL', priority: 0 },
      ]);
    });

    it('pairs once and rejects replayed Bridge transport messages', async () => {
      const pairingId = `${fixture.bridgeId}_PAIRING`;
      const pairedBridgeId = `${fixture.bridgeId}_PAIRED`;
      const pairingCodeDigest = `sha256:${'d'.repeat(64)}`;
      const credentialDigest = `sha256:${'e'.repeat(64)}`;
      await database
        .withSchema(schemaName)
        .updateTable('workspaces')
        .set({ verification_status: 'UNVERIFIED' })
        .where('id', '=', fixture.workspaceId)
        .executeTakeFirstOrThrow();
      const mutation = {
        actorId: fixture.accountId,
        eventId: `${pairingId}_TIMELINE`,
        outboxId: `${pairingId}_OUTBOX`,
        auditId: `${pairingId}_AUDIT`,
        requestId: `${pairingId}_REQUEST`,
        eventType: 'bridge-pairing.created',
        aggregateType: 'bridge-pairing',
        aggregateId: pairingId,
        aggregateVersion: 0,
        occurredAt: fixture.now,
        route: `/api/v1/teams/${fixture.teamId}/bridge-pairings`,
        idempotencyKey: `${pairingId}_KEY`,
        requestHash: `${pairingId}_HASH`,
        idempotencyId: `${pairingId}_IDEMPOTENCY`,
      };
      const created = await pairings.createPairing({
        id: pairingId,
        teamId: fixture.teamId,
        pairingCodeDigest,
        expiresAt: '2026-09-06T03:05:00.000Z',
        createdBy: fixture.accountId,
        createdAt: fixture.now,
        mutation,
      });
      const replayed = await pairings.createPairing({
        id: `${pairingId}_REPLAY`,
        teamId: fixture.teamId,
        pairingCodeDigest: `sha256:${'f'.repeat(64)}`,
        expiresAt: '2026-09-06T03:05:00.000Z',
        createdBy: fixture.accountId,
        createdAt: fixture.now,
        mutation,
      });
      const exchanged = await pairings.exchangePairing({
        pairingCodeDigest,
        bridgeId: pairedBridgeId,
        credentialDigest,
        protocolVersion: 'pfc-bridge/1',
        bridgeVersion: '0.1.0',
        nodeVersion: '24.20.0',
        codexVersion: '0.148.0',
        zedVersion: null,
        workspaces: [
          {
            workspaceId: fixture.workspaceId,
            repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
            allowedRelativePath: 'docs/requirements',
          },
        ],
        exchangedAt: '2026-09-06T03:01:00.000Z',
      });
      const duplicateExchange = await pairings.exchangePairing({
        pairingCodeDigest,
        bridgeId: `${pairedBridgeId}_DUPLICATE`,
        credentialDigest,
        protocolVersion: 'pfc-bridge/1',
        bridgeVersion: '0.1.0',
        nodeVersion: '24.20.0',
        codexVersion: '0.148.0',
        zedVersion: null,
        workspaces: [
          {
            workspaceId: fixture.workspaceId,
            repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
            allowedRelativePath: 'docs/requirements',
          },
        ],
        exchangedAt: '2026-09-06T03:01:01.000Z',
      });
      const message = {
        bridgeId: pairedBridgeId,
        credentialDigest,
        messageId: `${pairedBridgeId}_MESSAGE`,
        nonce: `${pairedBridgeId}_NONCE`,
        sentAt: '2026-09-06T03:01:02.000Z',
        receivedAt: '2026-09-06T03:01:02.000Z',
      };

      expect(created.status).toBe('CREATED');
      expect(replayed).toMatchObject({
        status: 'REPLAYED',
        pairingId,
      });
      expect(exchanged).toMatchObject({
        status: 'EXCHANGED',
        bridgeId: pairedBridgeId,
      });
      await expect(
        database
          .withSchema(schemaName)
          .selectFrom('workspaces')
          .select('verification_status')
          .where('id', '=', fixture.workspaceId)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ verification_status: 'VERIFIED' });
      expect(duplicateExchange.status).toBe('INVALID');
      await expect(bridgeRuntime.authenticateMessage(message)).resolves.toBe(
        true,
      );
      await expect(bridgeRuntime.authenticateMessage(message)).resolves.toBe(
        false,
      );
    });

    it('atomically creates a read-only run, first event, and leased command', async () => {
      await expect(
        runs.resolveCreationContext({
          requirementId: fixture.requirementId,
          baselineId: fixture.baselineId,
          workspaceId: fixture.workspaceId,
          skillKey: fixture.skill.key,
          skillVersion: fixture.skill.version,
          operation: 'ARTIFACT_CHECK',
          activeAfter: '2026-09-06T02:59:00.000Z',
          checkedAt: fixture.now,
        }),
      ).resolves.toMatchObject({
        currentGitBaseline: fixture.gitBaseline,
        artifactVersionId: fixture.artifactVersionId,
        artifactSourceRef: fixture.artifact.sourceRef,
        artifactContentHash: fixture.artifact.contentHash,
      });
      await expect(
        runs.resolveLaunchOptions({
          requirementId: fixture.requirementId,
          activeAfter: '2026-09-06T02:59:00.000Z',
          checkedAt: fixture.now,
        }),
      ).resolves.toMatchObject({
        baselineId: fixture.baselineId,
        workspaces: [
          {
            gitBaseline: fixture.gitBaseline,
            skillReleaseIds: [fixture.skillReleaseId],
          },
        ],
        skills: [{ id: fixture.skillReleaseId }],
      });
      const result = await runs.createRun({
        run: {
          id: fixture.runId,
          requirementId: fixture.requirementId,
          baselineId: fixture.baselineId,
          workspaceId: fixture.workspaceId,
          gitBaseline: fixture.gitBaseline,
          skillReleaseId: fixture.skillReleaseId,
          operation: 'ARTIFACT_CHECK',
          accessMode: 'READ_ONLY',
          status: 'QUEUED',
          parentRunId: null,
          bridgeId: null,
          executionInstanceId: null,
          externalIds: { threadId: null, turnId: null },
          resultOutcome: null,
          runScope: null,
          runScopeHash: null,
          executionStartedAt: null,
          cancelRequestedAt: null,
          terminalAt: null,
          resultSummary: null,
          failureReason: null,
          rowVersion: 0,
          createdBy: fixture.accountId,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
        event: {
          id: fixture.eventIds[0],
          sourceEventId: null,
          eventType: 'RUN_QUEUED',
          summary: { accessMode: 'READ_ONLY' },
          occurredAt: fixture.now,
          receivedAt: fixture.now,
        },
        command: {
          id: fixture.commandId,
          commandType: 'START_READ_ONLY_RUN',
          idempotencyKey: `${fixture.runId}:start`,
          payload: {
            requirementId: fixture.requirementId,
            baselineId: fixture.baselineId,
            workspaceId: fixture.workspaceId,
            gitBaseline: fixture.gitBaseline,
            skillReleaseId: fixture.skillReleaseId,
            skillContentHash: fixture.skill.contentHash,
            artifactVersionId: fixture.artifactVersionId,
            artifactSourceRef: fixture.artifact.sourceRef,
            artifactContentHash: fixture.artifact.contentHash,
            objectiveKey: 'ARTIFACT_STRUCTURE_AND_EVIDENCE_CHECK',
            accessMode: 'READ_ONLY',
          },
          createdAt: fixture.now,
        },
        startApproval: null,
        approvalEvidence: null,
        mutation: {
          actorId: fixture.accountId,
          eventId: `${fixture.eventIds[0]}_TIMELINE`,
          outboxId: `${fixture.eventIds[0]}_OUTBOX`,
          auditId: `${fixture.eventIds[0]}_AUDIT`,
          requestId: `${fixture.eventIds[0]}_REQUEST`,
          eventType: 'agent-run.created',
          aggregateType: 'agent-run',
          aggregateId: fixture.runId,
          aggregateVersion: 0,
          requirementId: fixture.requirementId,
          occurredAt: fixture.now,
          route: `/api/v1/requirements/${fixture.requirementId}/agent-runs`,
          idempotencyKey: `${fixture.runId}:create`,
          requestHash: 'CODEx_TEST_M2_REQUEST_HASH',
          idempotencyId: `${fixture.runId}_IDEMPOTENCY`,
        },
      });

      expect(result.run).toMatchObject({ id: fixture.runId, status: 'QUEUED' });
      expect(result.run).toMatchObject({
        executionInstanceId: null,
        resultOutcome: null,
        runScope: null,
        runScopeHash: null,
      });
      await expect(runs.findRun(fixture.runId)).resolves.toEqual(result.run);
      await expect(runs.listEvents(fixture.runId, 0, 50)).resolves.toEqual([
        expect.objectContaining({ sequence: 1, eventType: 'RUN_QUEUED' }),
      ]);
    });

    it('leases control commands before new runs and then binds the run', async () => {
      const approvalControl = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: fixture.now,
        leaseUntil: '2026-09-06T03:01:00.000Z',
        eventId: `${fixture.eventIds[0]}_BRIDGE_ASSIGNED`,
      });

      expect(approvalControl).toMatchObject({
        runId: `${fixture.runId}_WRITE`,
        commandType: 'RESOLVE_APPROVAL',
      });
      await expect(
        runs.acknowledgeCommand({
          bridgeId: fixture.bridgeId,
          commandId: approvalControl!.commandId,
          runId: approvalControl!.runId,
          status: 'SUCCEEDED',
          reasonCode: 'APPROVAL_RESPONSE_DELIVERED',
          acknowledgedAt: fixture.now,
        }),
      ).resolves.toBe('ACKNOWLEDGED');
      await expect(
        runs.findRun(`${fixture.runId}_WRITE`),
      ).resolves.toMatchObject({ status: 'RUNNING' });

      const lease = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: fixture.now,
        leaseUntil: '2026-09-06T03:01:00.000Z',
        eventId: `${fixture.eventIds[0]}_BRIDGE_ASSIGNED`,
      });

      expect(lease).toMatchObject({
        commandId: fixture.commandId,
        runId: fixture.runId,
        commandType: 'START_READ_ONLY_RUN',
        attempt: 1,
        afterSequence: 2,
        payload: {
          skillContentHash: fixture.skill.contentHash,
          accessMode: 'READ_ONLY',
        },
      });
      await expect(runs.findRun(fixture.runId)).resolves.toMatchObject({
        bridgeId: fixture.bridgeId,
        status: 'STARTING',
      });
    });

    it('leases a bounded workspace-write command to the same verified bridge', async () => {
      const scoped = database.withSchema(schemaName);
      const runId = `${fixture.runId}_WRITE_LEASE`;
      const executionInstanceId = `${runId}_EXECUTION`;
      const commandId = `${runId}_COMMAND`;
      const runScope = {
        allowedRelativePaths: [fixture.artifact.sourceRef],
        allowedActions: ['EDIT_FILES'] as const,
        networkAccess: false as const,
        maxChangedFiles: 1,
        maxChangedBytes: 20_000,
        expiresAt: '2026-09-06T03:20:00.000Z',
      };
      const runScopeHash = `sha256:${'9'.repeat(64)}`;
      await scoped
        .updateTable('requirement_workspaces')
        .set({ access_level: 'WRITE' })
        .where('requirement_id', '=', fixture.requirementId)
        .where('workspace_id', '=', fixture.workspaceId)
        .executeTakeFirstOrThrow();
      await scoped
        .updateTable('skill_releases')
        .set({
          enabled_scopes: JSON.stringify([
            'ARTIFACT_CHECK',
            'CONTROLLED_ARTIFACT_EDIT',
          ]),
        })
        .where('id', '=', fixture.skillReleaseId)
        .executeTakeFirstOrThrow();
      const createInput = {
        run: {
          id: runId,
          requirementId: fixture.requirementId,
          baselineId: fixture.baselineId,
          workspaceId: fixture.workspaceId,
          gitBaseline: fixture.gitBaseline,
          skillReleaseId: fixture.skillReleaseId,
          operation: 'CONTROLLED_ARTIFACT_EDIT',
          accessMode: 'WORKSPACE_WRITE',
          status: 'WAITING_APPROVAL',
          parentRunId: null,
          bridgeId: null,
          executionInstanceId,
          externalIds: { threadId: null, turnId: null },
          resultOutcome: null,
          runScope,
          runScopeHash,
          executionStartedAt: null,
          cancelRequestedAt: null,
          terminalAt: null,
          resultSummary: null,
          failureReason: null,
          rowVersion: 0,
          createdBy: fixture.accountId,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
        event: {
          id: `${runId}_EVENT`,
          sourceEventId: null,
          eventType: 'APPROVAL_REQUESTED',
          summary: { accessMode: 'WORKSPACE_WRITE' },
          occurredAt: fixture.now,
          receivedAt: fixture.now,
        },
        command: null,
        startApproval: createAgentApproval({
          id: `${runId}_START_APPROVAL`,
          runId,
          executionInstanceId,
          appServerRequestId: null,
          threadId: null,
          turnId: null,
          itemId: null,
          callbackId: null,
          kind: 'RUN_START',
          requestedScope: {
            allowedRelativePaths: runScope.allowedRelativePaths,
            allowedActions: runScope.allowedActions,
            networkAccess: false,
            maxChangedFiles: runScope.maxChangedFiles,
            maxChangedBytes: runScope.maxChangedBytes,
          },
          scopeHash: runScopeHash,
          requestedBy: fixture.accountId,
          requestedAt: fixture.now,
          expiresAt: runScope.expiresAt,
        }),
        approvalEvidence: {
          actorId: fixture.accountId,
          eventId: `${runId}_APPROVAL_TIMELINE`,
          outboxId: `${runId}_APPROVAL_OUTBOX`,
          auditId: `${runId}_APPROVAL_AUDIT`,
          requestId: `${runId}_REQUEST`,
          eventType: 'agent-approval.requested',
          aggregateType: 'agent-approval',
          aggregateId: `${runId}_START_APPROVAL`,
          aggregateVersion: 0,
          requirementId: fixture.requirementId,
          occurredAt: fixture.now,
        },
        mutation: {
          actorId: fixture.accountId,
          eventId: `${runId}_TIMELINE`,
          outboxId: `${runId}_OUTBOX`,
          auditId: `${runId}_AUDIT`,
          requestId: `${runId}_REQUEST`,
          eventType: 'agent-run.created',
          aggregateType: 'agent-run',
          aggregateId: runId,
          aggregateVersion: 0,
          requirementId: fixture.requirementId,
          occurredAt: fixture.now,
          route: `/api/v1/requirements/${fixture.requirementId}/agent-runs`,
          idempotencyKey: `${runId}:create`,
          requestHash: `${runId}_HASH`,
          idempotencyId: `${runId}_IDEMPOTENCY`,
        },
      } satisfies Parameters<typeof runs.createRun>[0];

      await expect(
        runs.createRun({
          ...createInput,
          startApproval: {
            ...createInput.startApproval,
            requestedScope: {
              ...createInput.startApproval.requestedScope,
              maxChangedBytes: 10_000,
            },
          },
        }),
      ).rejects.toThrowError('INVALID_AGENT_RUN_START_GATE');
      await runs.createRun(createInput);

      await expect(
        scoped
          .selectFrom('agent_run_commands')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .where('run_id', '=', runId)
          .executeTakeFirstOrThrow(),
      ).resolves.toMatchObject({ count: '0' });
      await expect(runs.findRun(runId)).resolves.toMatchObject({
        status: 'WAITING_APPROVAL',
      });

      await expect(
        approvals.decideApproval({
          approvalId: `${runId}_START_APPROVAL`,
          expectedRowVersion: 0,
          decision: {
            decision: 'APPROVED',
            approvedScope: {
              allowedRelativePaths: runScope.allowedRelativePaths,
              allowedActions: runScope.allowedActions,
              networkAccess: false,
              maxChangedFiles: runScope.maxChangedFiles,
              maxChangedBytes: runScope.maxChangedBytes,
            },
            decidedBy: `${fixture.accountId}_APPROVER`,
            decidedAt: '2026-09-06T03:00:30.000Z',
            reasonCode: 'RUN_SCOPE_REVIEWED',
          },
          eventId: `${runId}_APPROVAL_DECIDED_EVENT`,
          command: {
            id: commandId,
            idempotencyKey: `${runId}:approval-decision`,
            payload: {},
            runQueuedEventId: `${runId}_QUEUED_EVENT`,
          },
          mutation: {
            actorId: `${fixture.accountId}_APPROVER`,
            eventId: `${runId}_APPROVAL_DECIDED_TIMELINE`,
            outboxId: `${runId}_APPROVAL_DECIDED_OUTBOX`,
            auditId: `${runId}_APPROVAL_DECIDED_AUDIT`,
            requestId: `${runId}_APPROVAL_DECIDED_REQUEST`,
            eventType: 'agent-approval.resolved',
            aggregateType: 'agent-approval',
            aggregateId: `${runId}_START_APPROVAL`,
            aggregateVersion: 1,
            requirementId: fixture.requirementId,
            occurredAt: '2026-09-06T03:00:30.000Z',
            route: `/api/v1/agent-approvals/${runId}_START_APPROVAL/decision`,
            idempotencyKey: `${runId}:approval-decision`,
            requestHash: `${runId}_APPROVAL_DECIDED_HASH`,
            idempotencyId: `${runId}_APPROVAL_DECIDED_IDEMPOTENCY`,
          },
        }),
      ).resolves.toMatchObject({
        status: 'DECIDED',
        approval: { decision: 'APPROVED' },
      });
      await expect(
        scoped
          .selectFrom('agent_run_commands')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .where('run_id', '=', runId)
          .where('command_type', '=', 'START_WORKSPACE_WRITE_RUN')
          .executeTakeFirstOrThrow(),
      ).resolves.toMatchObject({ count: '1' });
      await expect(runs.listEvents(runId, 0, 20)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'RUN_QUEUED' }),
        ]),
      );

      const leased = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: fixture.now,
        leaseUntil: '2026-09-06T03:01:00.000Z',
        eventId: `${runId}_ASSIGNED`,
      });
      expect(leased).toMatchObject({
        commandId,
        runId,
        commandType: 'START_WORKSPACE_WRITE_RUN',
        attempt: 1,
        afterSequence: 4,
        payload: {
          executionInstanceId,
          runScope,
          runScopeHash,
          accessMode: 'WORKSPACE_WRITE',
        },
      });
      expect(() => parseBridgeCommand(leased)).not.toThrow();
      await scoped
        .updateTable('agent_run_commands')
        .set({ payload: { ...leased!.payload, runId } })
        .where('id', '=', commandId)
        .executeTakeFirstOrThrow();
      const recovered = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: '2026-09-06T03:01:01.000Z',
        leaseUntil: '2026-09-06T03:01:31.000Z',
        eventId: `${runId}_RECOVERED`,
      });
      expect(recovered).toMatchObject({
        commandId,
        runId,
        commandType: 'START_WORKSPACE_WRITE_RUN',
        attempt: 2,
      });
      expect(() => parseBridgeCommand(recovered)).not.toThrow();
      await expect(
        scoped
          .selectFrom('agent_run_events')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .where('run_id', '=', runId)
          .where('event_type', '=', 'BRIDGE_ASSIGNED')
          .executeTakeFirstOrThrow(),
      ).resolves.toMatchObject({ count: '1' });
      await expect(runs.findRun(runId)).resolves.toMatchObject({
        bridgeId: fixture.bridgeId,
        status: 'STARTING',
      });
    });

    it('creates no start command for rejected or expired approvals and only one under concurrent approval', async () => {
      const scoped = database.withSchema(schemaName);
      const requestedScope = {
        allowedRelativePaths: [fixture.artifact.sourceRef],
        allowedActions: ['EDIT_FILES'] as const,
        networkAccess: false as const,
        maxChangedFiles: 1,
        maxChangedBytes: 20_000,
      };
      const createPending = async (suffix: string, expiresAt: string) => {
        const data = createM2R2TestData({
          runId: suffix,
          now: fixture.now,
          artifactContentHash: fixture.artifact.contentHash,
        });
        const runId = data.run.id;
        const executionInstanceId = data.run.executionInstanceId;
        const approvalId = data.approval.id;
        const runScope = { ...requestedScope, expiresAt };
        const runScopeHash = `sha256:${suffix
          .padEnd(64, suffix[0] ?? 'a')
          .slice(0, 64)
          .replace(/[^a-f0-9]/g, 'a')}`;
        await runs.createRun({
          run: {
            id: runId,
            requirementId: fixture.requirementId,
            baselineId: fixture.baselineId,
            workspaceId: fixture.workspaceId,
            gitBaseline: fixture.gitBaseline,
            skillReleaseId: fixture.skillReleaseId,
            operation: 'CONTROLLED_ARTIFACT_EDIT',
            accessMode: 'WORKSPACE_WRITE',
            status: 'WAITING_APPROVAL',
            parentRunId: null,
            bridgeId: null,
            executionInstanceId,
            externalIds: { threadId: null, turnId: null },
            resultOutcome: null,
            runScope,
            runScopeHash,
            executionStartedAt: null,
            cancelRequestedAt: null,
            terminalAt: null,
            resultSummary: null,
            failureReason: null,
            rowVersion: 0,
            createdBy: fixture.accountId,
            createdAt: fixture.now,
            updatedAt: fixture.now,
          },
          event: {
            id: `${runId}_EVENT`,
            sourceEventId: null,
            eventType: 'APPROVAL_REQUESTED',
            summary: { approvalId, approvalKind: 'RUN_START' },
            occurredAt: fixture.now,
            receivedAt: fixture.now,
          },
          command: null,
          startApproval: createAgentApproval({
            id: approvalId,
            runId,
            executionInstanceId,
            appServerRequestId: null,
            threadId: null,
            turnId: null,
            itemId: null,
            callbackId: null,
            kind: 'RUN_START',
            requestedScope,
            scopeHash: runScopeHash,
            requestedBy: fixture.accountId,
            requestedAt: fixture.now,
            expiresAt,
          }),
          approvalEvidence: {
            actorId: fixture.accountId,
            eventId: `${runId}_APPROVAL_TIMELINE`,
            outboxId: `${runId}_APPROVAL_OUTBOX`,
            auditId: `${runId}_APPROVAL_AUDIT`,
            requestId: `${runId}_REQUEST`,
            eventType: 'agent-approval.requested',
            aggregateType: 'agent-approval',
            aggregateId: approvalId,
            aggregateVersion: 0,
            requirementId: fixture.requirementId,
            occurredAt: fixture.now,
          },
          mutation: {
            actorId: fixture.accountId,
            eventId: `${runId}_TIMELINE`,
            outboxId: `${runId}_OUTBOX`,
            auditId: `${runId}_AUDIT`,
            requestId: `${runId}_REQUEST`,
            eventType: 'agent-run.created',
            aggregateType: 'agent-run',
            aggregateId: runId,
            aggregateVersion: 0,
            requirementId: fixture.requirementId,
            occurredAt: fixture.now,
            route: `/api/v1/requirements/${fixture.requirementId}/agent-runs`,
            idempotencyKey: `${runId}:create`,
            requestHash: `${runId}_HASH`,
            idempotencyId: `${runId}_IDEMPOTENCY`,
          },
        });
        return { runId, approvalId };
      };
      const decide = (
        ids: { runId: string; approvalId: string },
        decision: 'APPROVED' | 'REJECTED',
        suffix: string,
        decidedAt = '2026-09-06T03:00:30.000Z',
      ) =>
        approvals.decideApproval({
          approvalId: ids.approvalId,
          expectedRowVersion: 0,
          decision: {
            decision,
            ...(decision === 'APPROVED'
              ? { approvedScope: requestedScope }
              : {}),
            decidedBy: `${fixture.accountId}_APPROVER`,
            decidedAt,
            reasonCode:
              decision === 'APPROVED' ? 'RUN_SCOPE_REVIEWED' : 'RUN_DECLINED',
          },
          eventId: `${ids.runId}_${suffix}_EVENT`,
          command: {
            id: `${ids.runId}_${suffix}_COMMAND`,
            idempotencyKey: `${ids.runId}:${suffix}:command`,
            payload: {},
            runQueuedEventId: `${ids.runId}_${suffix}_QUEUED_EVENT`,
          },
          mutation: {
            actorId: `${fixture.accountId}_APPROVER`,
            eventId: `${ids.runId}_${suffix}_TIMELINE`,
            outboxId: `${ids.runId}_${suffix}_OUTBOX`,
            auditId: `${ids.runId}_${suffix}_AUDIT`,
            requestId: `${ids.runId}_${suffix}_REQUEST`,
            eventType: 'agent-approval.resolved',
            aggregateType: 'agent-approval',
            aggregateId: ids.approvalId,
            aggregateVersion: 1,
            requirementId: fixture.requirementId,
            occurredAt: decidedAt,
            route: `/api/v1/agent-approvals/${ids.approvalId}/decision`,
            idempotencyKey: `${ids.runId}:${suffix}:decision`,
            requestHash: `${ids.runId}_${suffix}_HASH`,
            idempotencyId: `${ids.runId}_${suffix}_IDEMPOTENCY`,
          },
        });
      const commandCount = async (runId: string) =>
        Number(
          (
            await scoped
              .selectFrom('agent_run_commands')
              .select(({ fn }) => fn.count<number>('id').as('count'))
              .where('run_id', '=', runId)
              .where('command_type', '=', 'START_WORKSPACE_WRITE_RUN')
              .executeTakeFirstOrThrow()
          ).count,
        );

      const rejected = await createPending(
        'REJECTED',
        '2026-09-06T03:20:00.000Z',
      );
      await expect(
        decide(rejected, 'REJECTED', 'reject'),
      ).resolves.toMatchObject({
        status: 'DECIDED',
        approval: { decision: 'REJECTED' },
      });
      expect(await commandCount(rejected.runId)).toBe(0);
      await expect(runs.findRun(rejected.runId)).resolves.toMatchObject({
        status: 'CANCELLED',
      });

      const expired = await createPending(
        'EXPIRED',
        '2026-09-06T03:01:00.000Z',
      );
      await expect(
        approvals.expireDue({
          expiredAt: '2026-09-06T03:02:00.000Z',
          limit: 20,
          idPrefix: `${expired.runId}_EXPIRE`,
        }),
      ).resolves.toBe(1);
      expect(await commandCount(expired.runId)).toBe(0);
      await expect(runs.findRun(expired.runId)).resolves.toMatchObject({
        status: 'FAILED',
        failureReason: 'RUN_START_APPROVAL_EXPIRED',
      });

      const stale = await createPending(
        'STALE_CONTEXT',
        '2026-09-06T03:20:00.000Z',
      );
      await expect(
        decide(stale, 'APPROVED', 'stale', '2026-09-06T03:05:00.000Z'),
      ).rejects.toThrowError('AGENT_RUN_START_CONTEXT_STALE');
      expect(await commandCount(stale.runId)).toBe(0);
      await expect(
        approvals.findApproval(stale.approvalId),
      ).resolves.toMatchObject({ decision: 'PENDING' });
      await expect(runs.findRun(stale.runId)).resolves.toMatchObject({
        status: 'WAITING_APPROVAL',
      });

      const concurrent = await createPending(
        'CONCURRENT',
        '2026-09-06T03:20:00.000Z',
      );
      const outcomes = await Promise.all([
        decide(concurrent, 'APPROVED', 'approve_a'),
        decide(concurrent, 'APPROVED', 'approve_b'),
      ]);
      expect(outcomes.map((item) => item.status).sort()).toEqual([
        'CONFLICT',
        'DECIDED',
      ]);
      expect(await commandCount(concurrent.runId)).toBe(1);
      await scoped
        .updateTable('agent_run_commands')
        .set({ status: 'CANCELLED', updated_at: fixture.now })
        .where('run_id', '=', concurrent.runId)
        .execute();
      await scoped
        .updateTable('agent_runs')
        .set({
          status: 'CANCELLED',
          result_outcome: 'BLOCKED',
          terminal_at: fixture.now,
          updated_at: fixture.now,
        })
        .where('id', '=', concurrent.runId)
        .execute();
    });

    it('cancels and verifies one exact active execution without replaying it', async () => {
      const runId = `${fixture.runId}_WRITE_LEASE`;
      const commandId = `${runId}_COMMAND`;
      const current = await runs.findRun(runId);
      expect(current).not.toBeNull();
      const mutation = (
        suffix: string,
        eventType: string,
        aggregateVersion: number,
      ) => ({
        actorId: fixture.accountId,
        eventId: `${runId}_${suffix}_TIMELINE`,
        outboxId: `${runId}_${suffix}_OUTBOX`,
        auditId: `${runId}_${suffix}_AUDIT`,
        requestId: `${runId}_${suffix}_REQUEST`,
        eventType,
        aggregateType: 'agent-run',
        aggregateId: runId,
        aggregateVersion,
        requirementId: fixture.requirementId,
        occurredAt: fixture.now,
        route: `/api/v1/agent-runs/${runId}/controls`,
        idempotencyKey: `${runId}:${suffix}`,
        requestHash: `${runId}_${suffix}_HASH`,
        idempotencyId: `${runId}_${suffix}_IDEMPOTENCY`,
      });
      const cancelled = await controls.controlRun({
        action: 'CANCEL',
        runId,
        expectedRowVersion: current!.rowVersion,
        reasonCode: 'USER_REQUESTED',
        actorId: fixture.accountId,
        occurredAt: fixture.now,
        commandId: `${runId}_INTERRUPT`,
        eventIdPrefix: `${runId}_CANCEL_EVENT`,
        childRunId: `${runId}_UNUSED_CHILD`,
        childExecutionInstanceId: `${runId}_UNUSED_EXECUTION`,
        childScopeExpiresAt: '2026-09-06T03:20:00.000Z',
        mutation: mutation(
          'CANCEL',
          'agent-run.cancel-requested',
          current!.rowVersion + 1,
        ),
      });
      expect(cancelled).toMatchObject({
        status: 'APPLIED',
        run: { status: 'CANCELLING' },
      });
      const interrupt = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: fixture.now,
        leaseUntil: '2026-09-06T03:01:00.000Z',
        eventId: `${runId}_CONTROL_NO_ASSIGNMENT`,
      });
      expect(interrupt).toMatchObject({
        runId,
        commandType: 'INTERRUPT_RUN',
        payload: {
          executionInstanceId: `${runId}_EXECUTION`,
          threadId: null,
          turnId: null,
        },
      });
      await expect(
        runs.acknowledgeCommand({
          bridgeId: fixture.bridgeId,
          commandId: interrupt!.commandId,
          runId,
          status: 'SUCCEEDED',
          reasonCode: 'INTERRUPT_DISPATCHED',
          acknowledgedAt: fixture.now,
        }),
      ).resolves.toBe('ACKNOWLEDGED');
      await expect(
        runs.acknowledgeCommand({
          bridgeId: fixture.bridgeId,
          commandId,
          runId,
          status: 'UNKNOWN',
          reasonCode: 'PROCESS_EXIT_UNCONFIRMED',
          acknowledgedAt: fixture.now,
        }),
      ).resolves.toBe('ACKNOWLEDGED');
      const unknown = await runs.findRun(runId);
      expect(unknown).toMatchObject({
        status: 'UNKNOWN',
        resultOutcome: 'UNKNOWN',
      });
      const verification = await controls.controlRun({
        action: 'VERIFY_UNKNOWN',
        runId,
        expectedRowVersion: unknown!.rowVersion,
        reasonCode: 'OPERATOR_VERIFICATION',
        actorId: `${fixture.accountId}_APPROVER`,
        occurredAt: fixture.now,
        commandId: `${runId}_VERIFY`,
        eventIdPrefix: `${runId}_VERIFY_EVENT`,
        childRunId: `${runId}_UNUSED_CHILD_2`,
        childExecutionInstanceId: `${runId}_UNUSED_EXECUTION_2`,
        childScopeExpiresAt: '2026-09-06T03:20:00.000Z',
        mutation: {
          ...mutation(
            'VERIFY',
            'agent-run.verify_unknown',
            unknown!.rowVersion + 1,
          ),
          actorId: `${fixture.accountId}_APPROVER`,
        },
      });
      expect(verification).toMatchObject({
        status: 'APPLIED',
        run: { status: 'VERIFYING' },
      });
      const verifyCommand = await runs.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: fixture.now,
        leaseUntil: '2026-09-06T03:01:00.000Z',
        eventId: `${runId}_VERIFY_NO_ASSIGNMENT`,
      });
      expect(verifyCommand).toMatchObject({
        runId,
        commandType: 'VERIFY_RUN_STATE',
      });
      await expect(
        runs.acknowledgeCommand({
          bridgeId: fixture.bridgeId,
          commandId: verifyCommand!.commandId,
          runId,
          status: 'UNKNOWN',
          reasonCode: 'RUN_STILL_ACTIVE',
          acknowledgedAt: fixture.now,
        }),
      ).resolves.toBe('ACKNOWLEDGED');
      await expect(runs.findRun(runId)).resolves.toMatchObject({
        status: 'RUNNING',
      });
      await expect(audit.listRunAudit(runId, 20)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'agent-run.cancel-requested' }),
          expect.objectContaining({ action: 'agent-run.verify_unknown' }),
        ]),
      );
    });

    it('retries only from verified evidence into a new child and cancels it before start', async () => {
      const scoped = database.withSchema(schemaName);
      const runId = `${fixture.runId}_WRITE_LEASE`;
      const original = await runs.findRun(runId);
      expect(original?.runScope).not.toBeNull();
      await scoped
        .insertInto('agent_run_capsules')
        .values({
          id: `${runId}_CAPSULE`,
          run_id: runId,
          execution_instance_id: original!.executionInstanceId!,
          source_git_baseline: original!.gitBaseline,
          scope_hash: original!.runScopeHash!,
          before_manifest_hash: `sha256:${'1'.repeat(64)}`,
          after_manifest_hash: `sha256:${'2'.repeat(64)}`,
          diff_summary: { changedFiles: 0, changedBytes: 0, changedPaths: [] },
          lifecycle: 'VERIFIED',
          created_at: fixture.now,
          verified_at: fixture.now,
          cleaned_at: null,
        })
        .execute();
      await scoped
        .updateTable('agent_runs')
        .set({
          status: 'FAILED',
          result_outcome: 'BLOCKED',
          terminal_at: fixture.now,
          row_version: original!.rowVersion + 1,
          updated_at: fixture.now,
        })
        .where('id', '=', runId)
        .executeTakeFirstOrThrow();
      const failed = await runs.findRun(runId);
      const childRunId = `${runId}_CHILD`;
      const childExecutionInstanceId = `${childRunId}_EXECUTION`;
      const retryMutation = {
        actorId: fixture.accountId,
        eventId: `${childRunId}_TIMELINE`,
        outboxId: `${childRunId}_OUTBOX`,
        auditId: `${childRunId}_AUDIT`,
        requestId: `${childRunId}_REQUEST`,
        eventType: 'agent-run.retry',
        aggregateType: 'agent-run',
        aggregateId: runId,
        aggregateVersion: failed!.rowVersion + 1,
        requirementId: fixture.requirementId,
        occurredAt: fixture.now,
        route: `/api/v1/agent-runs/${runId}/controls`,
        idempotencyKey: `${childRunId}:retry`,
        requestHash: `${childRunId}_HASH`,
        idempotencyId: `${childRunId}_IDEMPOTENCY`,
      };
      const retried = await controls.controlRun({
        action: 'RETRY',
        runId,
        expectedRowVersion: failed!.rowVersion,
        reasonCode: 'OPERATOR_RETRY',
        actorId: fixture.accountId,
        occurredAt: fixture.now,
        commandId: `${childRunId}_COMMAND`,
        eventIdPrefix: `${childRunId}_EVENT`,
        childRunId,
        childExecutionInstanceId,
        childScopeExpiresAt: '2026-09-06T03:20:00.000Z',
        mutation: retryMutation,
      });
      expect(retried).toMatchObject({
        status: 'APPLIED',
        run: { id: runId, status: 'FAILED' },
        childRun: {
          id: childRunId,
          parentRunId: runId,
          executionInstanceId: childExecutionInstanceId,
          status: 'WAITING_APPROVAL',
        },
      });
      await expect(
        scoped
          .selectFrom('agent_run_commands')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .where('run_id', '=', childRunId)
          .executeTakeFirstOrThrow(),
      ).resolves.toMatchObject({ count: '0' });
      await expect(
        scoped
          .selectFrom('approval_requests')
          .select(['kind', 'decision'])
          .where('run_id', '=', childRunId)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ kind: 'RUN_START', decision: 'PENDING' });
      const child = retried.childRun!;
      const cancelled = await controls.controlRun({
        action: 'CANCEL',
        runId: child.id,
        expectedRowVersion: child.rowVersion,
        reasonCode: 'CANCEL_BEFORE_START',
        actorId: fixture.accountId,
        occurredAt: fixture.now,
        commandId: `${childRunId}_UNUSED_INTERRUPT`,
        eventIdPrefix: `${childRunId}_CANCEL_EVENT`,
        childRunId: `${childRunId}_UNUSED_CHILD`,
        childExecutionInstanceId: `${childRunId}_UNUSED_EXECUTION`,
        childScopeExpiresAt: '2026-09-06T03:20:00.000Z',
        mutation: {
          ...retryMutation,
          eventId: `${childRunId}_CANCEL_TIMELINE`,
          outboxId: `${childRunId}_CANCEL_OUTBOX`,
          auditId: `${childRunId}_CANCEL_AUDIT`,
          requestId: `${childRunId}_CANCEL_REQUEST`,
          eventType: 'agent-run.cancel',
          aggregateId: child.id,
          aggregateVersion: child.rowVersion + 1,
          idempotencyKey: `${childRunId}:cancel`,
          requestHash: `${childRunId}_CANCEL_HASH`,
          idempotencyId: `${childRunId}_CANCEL_IDEMPOTENCY`,
        },
      });
      expect(cancelled).toMatchObject({
        status: 'APPLIED',
        run: { id: child.id, status: 'CANCELLED', terminalAt: fixture.now },
      });
      await expect(
        scoped
          .selectFrom('agent_run_commands')
          .select(({ fn }) => fn.count<number>('id').as('count'))
          .where('run_id', '=', child.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ count: '0' });
      await expect(
        scoped
          .selectFrom('approval_requests')
          .select('decision')
          .where('run_id', '=', child.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ decision: 'CANCELLED' });
    });

    it('deduplicates source events and rejects sequence gaps', async () => {
      const appended = await runs.appendEvent({
        id: fixture.eventIds[1],
        commandId: fixture.commandId,
        runId: fixture.runId,
        expectedSequence: 3,
        bridgeId: fixture.bridgeId,
        sourceEventId: fixture.sourceEventIds[0],
        eventType: 'TURN_STARTED',
        summary: {
          status: 'RUNNING',
          threadId: 'CODEx_TEST_M2_THREAD_001',
          turnId: 'CODEx_TEST_M2_TURN_001',
        },
        occurredAt: fixture.now,
        receivedAt: fixture.now,
      });
      const duplicate = await runs.appendEvent({
        id: `${fixture.eventIds[1]}_DUPLICATE`,
        commandId: fixture.commandId,
        runId: fixture.runId,
        expectedSequence: 3,
        bridgeId: fixture.bridgeId,
        sourceEventId: fixture.sourceEventIds[0],
        eventType: 'TURN_STARTED',
        summary: {
          status: 'RUNNING',
          threadId: 'CODEx_TEST_M2_THREAD_001',
          turnId: 'CODEx_TEST_M2_TURN_001',
        },
        occurredAt: fixture.now,
        receivedAt: fixture.now,
      });
      const gap = await runs.appendEvent({
        id: fixture.eventIds[2],
        commandId: fixture.commandId,
        runId: fixture.runId,
        expectedSequence: 5,
        bridgeId: fixture.bridgeId,
        sourceEventId: fixture.sourceEventIds[1],
        eventType: 'AGENT_MESSAGE',
        summary: { text: 'sanitized' },
        occurredAt: fixture.now,
        receivedAt: fixture.now,
      });
      const foreignBridge = await runs.appendEvent({
        id: `${fixture.eventIds[2]}_FOREIGN`,
        commandId: fixture.commandId,
        runId: fixture.runId,
        expectedSequence: 4,
        bridgeId: 'CODEx_TEST_M2_OTHER_BRIDGE',
        sourceEventId: `${fixture.sourceEventIds[1]}_FOREIGN`,
        eventType: 'AGENT_MESSAGE',
        summary: { text: 'sanitized' },
        occurredAt: fixture.now,
        receivedAt: fixture.now,
      });
      const completedMessage = await runs.appendEvent({
        id: `${fixture.eventIds[2]}_RESULT_MESSAGE`,
        commandId: fixture.commandId,
        runId: fixture.runId,
        expectedSequence: 4,
        bridgeId: fixture.bridgeId,
        sourceEventId: `${fixture.sourceEventIds[1]}_RESULT_MESSAGE`,
        eventType: 'AGENT_MESSAGE',
        summary: {
          messageCompleted: true,
          text: 'Checked artifact structure from the registered baseline.',
        },
        occurredAt: fixture.now,
        receivedAt: fixture.now,
      });

      expect(appended.status).toBe('APPENDED');
      expect(duplicate.status).toBe('DUPLICATE');
      expect(gap.status).toBe('SEQUENCE_GAP');
      expect(foreignBridge.status).toBe('COMMAND_INVALID');
      expect(completedMessage.status).toBe('APPENDED');
      await expect(runs.listEvents(fixture.runId, 0, 50)).resolves.toHaveLength(
        4,
      );
      await expect(runs.findRun(fixture.runId)).resolves.toMatchObject({
        status: 'RUNNING',
      });

      await runs.acknowledgeCommand({
        bridgeId: fixture.bridgeId,
        commandId: fixture.commandId,
        runId: fixture.runId,
        status: 'SUCCEEDED',
        acknowledgedAt: '2026-09-06T03:02:00.000Z',
      });
      await expect(runs.findRun(fixture.runId)).resolves.toMatchObject({
        status: 'SUCCEEDED',
        resultSummary:
          'Checked artifact structure from the registered baseline.',
        externalIds: {
          threadId: 'CODEx_TEST_M2_THREAD_001',
          turnId: 'CODEx_TEST_M2_TURN_001',
        },
      });
    });

    it('expires pending approvals into one decline command with audit evidence', async () => {
      const scoped = database.withSchema(schemaName);
      const runId = `${fixture.runId}_EXPIRE`;
      const executionInstanceId = `${runId}_EXECUTION`;
      const approvalId = `${runId}_APPROVAL`;
      const requestedScope = {
        allowedRelativePaths: [fixture.artifact.sourceRef],
        allowedActions: ['EDIT_FILES'] as const,
        networkAccess: false,
        maxChangedFiles: 1,
        maxChangedBytes: 20_000,
      };
      await scoped
        .insertInto('agent_runs')
        .values({
          id: runId,
          requirement_id: fixture.requirementId,
          baseline_id: fixture.baselineId,
          workspace_id: fixture.workspaceId,
          git_baseline: fixture.gitBaseline,
          skill_release_id: fixture.skillReleaseId,
          operation: 'CONTROLLED_ARTIFACT_EDIT',
          access_mode: 'WORKSPACE_WRITE',
          status: 'RUNNING',
          parent_run_id: null,
          bridge_id: fixture.bridgeId,
          execution_instance_id: executionInstanceId,
          codex_thread_id: 'CODEx_TEST_M2_EXPIRE_THREAD',
          codex_turn_id: 'CODEx_TEST_M2_EXPIRE_TURN',
          result_outcome: null,
          run_scope: {
            ...requestedScope,
            expiresAt: '2026-09-06T03:10:00.000Z',
          },
          run_scope_hash: `sha256:${'3'.repeat(64)}`,
          execution_started_at: fixture.now,
          cancel_requested_at: null,
          terminal_at: null,
          result_summary: null,
          failure_reason: null,
          row_version: 0,
          created_by: fixture.accountId,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
      await scoped
        .insertInto('agent_run_events')
        .values({
          id: `${runId}_EVENT`,
          run_id: runId,
          sequence: 1,
          event_type: 'TURN_STARTED',
          summary: { status: 'RUNNING' },
          source_bridge_id: fixture.bridgeId,
          source_event_id: `${runId}_SOURCE`,
          occurred_at: fixture.now,
          received_at: fixture.now,
        })
        .execute();
      const approval = createAgentApproval({
        id: approvalId,
        runId,
        executionInstanceId,
        appServerRequestId: 'CODEx_TEST_M2_EXPIRE_REQUEST',
        threadId: 'CODEx_TEST_M2_EXPIRE_THREAD',
        turnId: 'CODEx_TEST_M2_EXPIRE_TURN',
        itemId: 'CODEx_TEST_M2_EXPIRE_ITEM',
        callbackId: null,
        kind: 'FILE_CHANGE',
        requestedScope,
        scopeHash: `sha256:${'4'.repeat(64)}`,
        requestedBy: fixture.accountId,
        requestedAt: fixture.now,
        expiresAt: '2026-09-06T03:01:00.000Z',
      });
      await approvals.createApproval({
        approval,
        eventId: `${approvalId}_EVENT`,
        mutation: {
          actorId: fixture.accountId,
          eventId: `${approvalId}_TIMELINE`,
          outboxId: `${approvalId}_OUTBOX`,
          auditId: `${approvalId}_AUDIT`,
          requestId: `${approvalId}_REQUEST`,
          eventType: 'agent-approval.requested',
          aggregateType: 'agent-approval',
          aggregateId: approvalId,
          aggregateVersion: 0,
          requirementId: fixture.requirementId,
          occurredAt: fixture.now,
          route: `/bridge/v1/runs/${runId}/approvals`,
          idempotencyKey: `${approvalId}:request`,
          requestHash: `${approvalId}_HASH`,
          idempotencyId: `${approvalId}_IDEMPOTENCY`,
        },
      });

      await expect(
        approvals.expireDue({
          expiredAt: '2026-09-06T03:02:00.000Z',
          limit: 20,
          idPrefix: `${approvalId}_EXPIRED`,
        }),
      ).resolves.toBe(1);
      await expect(approvals.findApproval(approvalId)).resolves.toMatchObject({
        decision: 'EXPIRED',
        reasonCode: 'APPROVAL_EXPIRED',
      });
      const command = await scoped
        .selectFrom('agent_run_commands')
        .select(['id', 'command_type', 'payload'])
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();
      expect(command).toMatchObject({
        command_type: 'RESOLVE_APPROVAL',
        payload: { decision: 'decline', approvalId },
      });
      await expect(audit.listRunAudit(runId, 20)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'agent-approval.expired' }),
        ]),
      );
      await scoped
        .updateTable('agent_run_commands')
        .set({ status: 'ACKNOWLEDGED', updated_at: fixture.now })
        .where('id', '=', command.id)
        .executeTakeFirstOrThrow();
      await scoped
        .updateTable('agent_runs')
        .set({
          status: 'FAILED',
          result_outcome: 'BLOCKED',
          terminal_at: fixture.now,
          row_version: 2,
          updated_at: fixture.now,
        })
        .where('id', '=', runId)
        .executeTakeFirstOrThrow();
    });

    it('revokes the Bridge and interrupts exactly the confirmed active runs', async () => {
      const bridge = await controls.findBridge(fixture.bridgeId);
      expect(bridge).toMatchObject({ status: 'ONLINE', activeRunCount: 1 });
      const mutation = {
        actorId: fixture.accountId,
        eventId: `${fixture.bridgeId}_REVOKE_TIMELINE`,
        outboxId: `${fixture.bridgeId}_REVOKE_OUTBOX`,
        auditId: `${fixture.bridgeId}_REVOKE_AUDIT`,
        requestId: `${fixture.bridgeId}_REVOKE_REQUEST`,
        eventType: 'bridge.revoked',
        aggregateType: 'bridge',
        aggregateId: fixture.bridgeId,
        aggregateVersion: 1,
        occurredAt: fixture.now,
        route: `/api/v1/bridges/${fixture.bridgeId}/revocations`,
        idempotencyKey: `${fixture.bridgeId}:revoke`,
        requestHash: `${fixture.bridgeId}_REVOKE_HASH`,
        idempotencyId: `${fixture.bridgeId}_REVOKE_IDEMPOTENCY`,
      };
      const revoked = await controls.revokeBridge({
        bridgeId: fixture.bridgeId,
        actorId: fixture.accountId,
        reasonCode: 'LOCAL_OWNER_REVOKED',
        expectedActiveRunCount: 1,
        occurredAt: fixture.now,
        commandIdPrefix: `${fixture.bridgeId}_REVOKE_COMMAND`,
        eventIdPrefix: `${fixture.bridgeId}_REVOKE_EVENT`,
        mutation,
      });
      const replayed = await controls.revokeBridge({
        bridgeId: fixture.bridgeId,
        actorId: fixture.accountId,
        reasonCode: 'LOCAL_OWNER_REVOKED',
        expectedActiveRunCount: 1,
        occurredAt: fixture.now,
        commandIdPrefix: `${fixture.bridgeId}_REVOKE_COMMAND_REPLAY`,
        eventIdPrefix: `${fixture.bridgeId}_REVOKE_EVENT_REPLAY`,
        mutation,
      });

      expect(revoked).toEqual({ status: 'REVOKED', affectedRunCount: 1 });
      expect(replayed).toEqual({ status: 'REPLAYED', affectedRunCount: 1 });
      await expect(
        controls.findBridge(fixture.bridgeId),
      ).resolves.toMatchObject({
        status: 'REVOKED',
        activeRunCount: 1,
      });
      await expect(
        runs.findRun(`${fixture.runId}_WRITE`),
      ).resolves.toMatchObject({ status: 'CANCELLING' });
    });
  });
}
