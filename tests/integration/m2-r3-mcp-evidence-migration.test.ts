import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAIUXScopedAuthorizationTables,
  createAIUXWorkSessionTables,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  createM2AgentRunTables,
  createM2ApprovalControlTables,
  createM2R3ArtifactCollaborationTables,
  createM2R3EvidenceMcpTables,
  dropLifecycleSchema,
  PostgresMcpReadRepository,
  PostgresWorkSessionRepository,
} from '../../packages/persistence/src/index.ts';
import { createM2R3TestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const fixture = createM2R3TestData(
  process.env.CODEX_TEST_RUN_ID ?? 'MCP_EVIDENCE_009',
);

if (connectionString) {
  describe('M2 R3 MCP evidence isolated migration', () => {
    const database = createDatabase({ connectionString });
    const scoped = database.withSchema(fixture.schemaName);
    const repository = new PostgresMcpReadRepository(
      database,
      fixture.schemaName,
    );
    const workSessionRepository = new PostgresWorkSessionRepository(
      database,
      fixture.schemaName,
    );

    beforeAll(async () => {
      await dropLifecycleSchema(database, fixture.schemaName);
      await createLifecycleSchema(database, fixture.schemaName);
      await createM1CollaborationTables(database, fixture.schemaName);
      await createM2AgentRunTables(database, fixture.schemaName);
      await createM2ApprovalControlTables(database, fixture.schemaName);
      await createAIUXScopedAuthorizationTables(database, fixture.schemaName);
      await createAIUXWorkSessionTables(database, fixture.schemaName);
      await createM2R3ArtifactCollaborationTables(database, fixture.schemaName);
      await createM2R3EvidenceMcpTables(database, fixture.schemaName);
      await fixture.seedR3bPrerequisites(database);
      await scoped
        .insertInto('mcp_capability_registrations')
        .values({
          id: fixture.capabilityId,
          logical_capability_id: 'pfc.local.metadata.inspect',
          server_name: 'local-tools',
          tool_name: 'inspect_schema',
          input_schema_hash: fixture.hashes.schema,
          config_fingerprint: fixture.hashes.config,
          effect: 'READ_ONLY',
          risk_level: 'LOW',
          max_input_bytes: 32768,
          max_output_bytes: 262144,
          timeout_ms: 10000,
          allowed_team_ids: JSON.stringify([fixture.teamId]),
          allowed_requirement_ids: JSON.stringify([fixture.requirementIds[0]]),
          status: 'ACTIVE',
          reviewed_by: fixture.accountId,
          reviewed_at: fixture.now,
          review_evidence_ref:
            'docs/implementation/POD-PFC-001-M2-R3-design.md',
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
    });

    afterAll(async () => {
      await dropLifecycleSchema(database, fixture.schemaName);
      const remaining = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .execute();
      expect(remaining).toEqual([]);
      await database.destroy();
    });

    it('creates the three MCP evidence tables', async () => {
      const tables = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .where('table_name', 'in', [
          'execution_evidence',
          'mcp_capability_registrations',
          'mcp_read_requests',
        ])
        .orderBy('table_name')
        .execute();

      expect(tables.map((row) => row.table_name)).toEqual([
        'execution_evidence',
        'mcp_capability_registrations',
        'mcp_read_requests',
      ]);
    });

    it('persists immutable execution evidence bound to an exact artifact version', async () => {
      await scoped
        .insertInto('execution_evidence')
        .values({
          id: fixture.evidenceId,
          requirement_id: fixture.requirementIds[0],
          baseline_id: fixture.baselineId,
          source_type: 'MCP_READ_RESULT',
          source_id: fixture.mcpRequestId,
          outcome: 'SUCCEEDED',
          safe_summary: 'CODEx_TEST metadata query completed.',
          content_hash: fixture.hashes.first,
          sensitivity: 'INTERNAL',
          artifact_version_id: fixture.versionIds[0],
          gate_run_id: null,
          retention_class: 'PRODUCT_FACT',
          created_at: fixture.now,
        })
        .execute();

      await expect(
        scoped
          .updateTable('execution_evidence')
          .set({ safe_summary: 'Mutation must be rejected.' })
          .where('id', '=', fixture.evidenceId)
          .execute(),
      ).rejects.toThrow(/EXECUTION_EVIDENCE_IMMUTABLE/);
      await expect(
        scoped
          .deleteFrom('execution_evidence')
          .where('id', '=', fixture.evidenceId)
          .execute(),
      ).rejects.toThrow(/EXECUTION_EVIDENCE_IMMUTABLE/);
    });

    it('enforces one active MCP read per product work session', async () => {
      const request = {
        id: fixture.mcpRequestId,
        session_id: fixture.sessionId,
        turn_id: fixture.turnId,
        requirement_id: fixture.requirementIds[0],
        team_id: fixture.teamId,
        capability_id: fixture.capabilityId,
        input_payload: JSON.stringify({ query: 'metadata' }),
        input_hash: fixture.hashes.input,
        sensitivity: 'INTERNAL' as const,
        material_ref_ids: JSON.stringify([fixture.materialRefId]),
        status: 'QUEUED' as const,
        bridge_id: fixture.bridgeId,
        external_thread_id: null,
        output_summary: null,
        output_hash: null,
        output_bytes: null,
        output_truncated: false,
        duration_ms: null,
        evidence_id: null,
        failure_reason: null,
        recovery_action: null,
        row_version: 0,
        created_by: fixture.accountId,
        created_at: fixture.now,
        updated_at: fixture.now,
        terminal_at: null,
      };
      await scoped.insertInto('mcp_read_requests').values(request).execute();

      await expect(
        scoped
          .insertInto('mcp_read_requests')
          .values({ ...request, id: `${fixture.mcpRequestId}_DUPLICATE` })
          .execute(),
      ).rejects.toThrow();
      await expect(
        scoped
          .selectFrom('mcp_read_requests')
          .select(['id', 'status'])
          .where('session_id', '=', fixture.sessionId)
          .execute(),
      ).resolves.toEqual([{ id: fixture.mcpRequestId, status: 'QUEUED' }]);
      await scoped
        .updateTable('mcp_read_requests')
        .set({
          status: 'FAILED',
          failure_reason: 'CODEx_TEST_CONCURRENCY_COMPLETE',
          recovery_action: 'NONE',
          terminal_at: fixture.now,
          updated_at: fixture.now,
        })
        .where('id', '=', fixture.mcpRequestId)
        .execute();
    });

    it('reports only exact registered read capabilities and exposes drift', async () => {
      await expect(
        workSessionRepository.resolveWorkspaceEvidence({
          teamId: fixture.teamId,
          requirementId: fixture.requirementIds[0],
          bridgeId: fixture.bridgeId,
          at: fixture.now,
        }),
      ).resolves.toMatchObject({
        mcp: {
          state: 'AVAILABLE',
          status: 'AVAILABLE',
          registeredReadCapabilityCount: 1,
        },
      });

      await scoped
        .updateTable('mcp_capability_registrations')
        .set({ config_fingerprint: fixture.hashes.second })
        .where('id', '=', fixture.capabilityId)
        .executeTakeFirstOrThrow();
      try {
        await expect(
          workSessionRepository.resolveWorkspaceEvidence({
            teamId: fixture.teamId,
            requirementId: fixture.requirementIds[0],
            bridgeId: fixture.bridgeId,
            at: fixture.now,
          }),
        ).resolves.toMatchObject({
          mcp: { status: 'DRIFTED', registeredReadCapabilityCount: 0 },
        });
      } finally {
        await scoped
          .updateTable('mcp_capability_registrations')
          .set({ config_fingerprint: fixture.hashes.config })
          .where('id', '=', fixture.capabilityId)
          .executeTakeFirstOrThrow();
      }
    });

    it('persists one capability-matched Bridge execution and immutable evidence', async () => {
      const requestId = `${fixture.mcpRequestId}_FLOW`;
      const commandId = `${fixture.mcpCommandId}_FLOW`;
      const capability = await repository.findCapability(
        'pfc.local.metadata.inspect',
      );
      expect(capability).not.toBeNull();
      const runtime = await repository.resolveRuntime({
        capability: capability!,
        teamId: fixture.teamId,
        at: fixture.now,
      });
      expect(runtime).toMatchObject({
        bridgeId: fixture.bridgeId,
        state: 'AVAILABLE',
        runtimeStatus: 'CONNECTED',
      });
      const created = await repository.createRequest({
        request: {
          schemaVersion: 'mcp-read-request/1',
          id: requestId,
          sessionId: fixture.sessionId,
          turnId: fixture.turnId,
          requirementId: fixture.requirementIds[0],
          teamId: fixture.teamId,
          capabilityId: fixture.capabilityId,
          logicalCapabilityId: 'pfc.local.metadata.inspect',
          inputHash: fixture.hashes.input,
          sensitivity: 'INTERNAL',
          status: 'QUEUED',
          bridgeId: fixture.bridgeId,
          externalThreadId: null,
          outputSummary: null,
          outputHash: null,
          outputBytes: null,
          outputTruncated: false,
          durationMs: null,
          evidenceId: null,
          failureReason: null,
          recoveryAction: null,
          rowVersion: 0,
          createdBy: fixture.accountId,
          createdAt: fixture.now,
          updatedAt: fixture.now,
          terminalAt: null,
        },
        rawInput: { query: 'metadata' },
        materialRefIds: [fixture.materialRefId],
        commandId,
        expectedSessionVersion: 0,
        evidence: {
          actorId: fixture.accountId,
          eventId: `${fixture.prefix}_REQUEST_EVENT`,
          outboxId: `${fixture.prefix}_REQUEST_OUTBOX`,
          auditId: `${fixture.prefix}_REQUEST_AUDIT`,
          requestId: `${fixture.prefix}_HTTP_REQUEST`,
          eventType: 'mcp.read.requested',
          aggregateType: 'pfc.local.metadata.inspect',
          aggregateId: requestId,
          aggregateVersion: 0,
          requirementId: fixture.requirementIds[0],
          occurredAt: fixture.now,
          route: `/api/v1/work-sessions/${fixture.sessionId}/mcp-read-requests`,
          idempotencyKey: `${fixture.prefix}_MCP_IDEMPOTENCY`,
          requestHash: fixture.hashes.input,
          idempotencyId: `${fixture.prefix}_MCP_IDEMPOTENCY_ROW`,
        },
      });
      expect(created).toMatchObject({
        status: 'CREATED',
        request: { status: 'QUEUED' },
      });

      const leaseAt = new Date(Date.parse(fixture.now) + 1_000).toISOString();
      const command = await repository.leaseNextCommand({
        bridgeId: fixture.bridgeId,
        leasedAt: leaseAt,
        leaseUntil: new Date(Date.parse(leaseAt) + 30_000).toISOString(),
      });
      expect(command).toMatchObject({
        commandId,
        commandType: 'EXECUTE_MCP_READ',
        payload: { requestId, inputHash: fixture.hashes.input },
      });
      await expect(
        repository.readLeasedContext({
          bridgeId: fixture.bridgeId,
          commandId,
          readAt: leaseAt,
        }),
      ).resolves.toMatchObject({
        requestId,
        input: { query: 'metadata' },
        limits: { timeoutMs: 10000, maxOutputBytes: 262144 },
      });

      const startedAt = new Date(Date.parse(fixture.now) + 2_000).toISOString();
      await expect(
        repository.appendEvent({
          bridgeId: fixture.bridgeId,
          commandId,
          event: {
            schemaVersion: 'mcp-read-event/1',
            sourceEventId: `${fixture.prefix}_SOURCE_STARTED`,
            eventType: 'MCP_READ_STARTED',
            occurredAt: startedAt,
            payload: { requestId, threadId: `${fixture.prefix}_THREAD` },
          },
          receivedAt: startedAt,
          sessionEventId: `${fixture.prefix}_SESSION_STARTED`,
          evidenceId: `${fixture.evidenceId}_FLOW`,
          operation: {
            actorId: fixture.accountId,
            eventId: `${fixture.prefix}_RESULT_TIMELINE_STARTED`,
            outboxId: `${fixture.prefix}_RESULT_OUTBOX_STARTED`,
            auditId: `${fixture.prefix}_RESULT_AUDIT_STARTED`,
            requestId: `${fixture.prefix}_BRIDGE_STARTED`,
            eventType: 'mcp.read.started',
            aggregateType: 'mcp_read_request',
            route: '/bridge/v1/mcp-read-requests/events',
            idempotencyKey: `${fixture.prefix}_STARTED_KEY`,
            requestHash: fixture.hashes.input,
            idempotencyId: `${fixture.prefix}_STARTED_IDEMPOTENCY`,
          },
        }),
      ).resolves.toBe('APPENDED');

      const completedAt = new Date(
        Date.parse(fixture.now) + 3_000,
      ).toISOString();
      const flowEvidenceId = `${fixture.evidenceId}_FLOW`;
      await expect(
        repository.appendEvent({
          bridgeId: fixture.bridgeId,
          commandId,
          event: {
            schemaVersion: 'mcp-read-event/1',
            sourceEventId: `${fixture.prefix}_SOURCE_COMPLETED`,
            eventType: 'MCP_READ_COMPLETED',
            occurredAt: completedAt,
            payload: {
              requestId,
              outputSummary: 'CODEx_TEST 3 metadata rows',
              outputHash: fixture.hashes.second,
              outputBytes: 128,
              truncated: false,
              durationMs: 42,
              threadId: `${fixture.prefix}_THREAD`,
            },
          },
          receivedAt: completedAt,
          sessionEventId: `${fixture.prefix}_SESSION_COMPLETED`,
          evidenceId: flowEvidenceId,
          operation: {
            actorId: fixture.accountId,
            eventId: `${fixture.prefix}_RESULT_TIMELINE`,
            outboxId: `${fixture.prefix}_RESULT_OUTBOX`,
            auditId: `${fixture.prefix}_RESULT_AUDIT`,
            requestId: `${fixture.prefix}_BRIDGE_COMPLETED`,
            eventType: 'mcp.read.completed',
            aggregateType: 'mcp_read_request',
            route: '/bridge/v1/mcp-read-requests/events',
            idempotencyKey: `${fixture.prefix}_COMPLETED_KEY`,
            requestHash: fixture.hashes.second,
            idempotencyId: `${fixture.prefix}_COMPLETED_IDEMPOTENCY`,
          },
        }),
      ).resolves.toBe('APPENDED');
      await expect(repository.findRequest(requestId)).resolves.toMatchObject({
        status: 'COMPLETED',
        evidenceId: flowEvidenceId,
        outputSummary: 'CODEx_TEST 3 metadata rows',
      });
      await expect(
        scoped
          .selectFrom('execution_evidence')
          .select(['id', 'source_id', 'safe_summary'])
          .where('id', '=', flowEvidenceId)
          .executeTakeFirst(),
      ).resolves.toEqual({
        id: flowEvidenceId,
        source_id: requestId,
        safe_summary: 'CODEx_TEST 3 metadata rows',
      });
    });
  });
}
