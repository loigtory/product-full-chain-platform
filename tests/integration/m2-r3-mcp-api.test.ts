import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { McpReadApplicationService } from '../../apps/server/src/mcp-reads/application-service.ts';
import {
  PostgresAuthorizationPort,
  PostgresExecutionEvidenceRepository,
  PostgresMcpReadRepository,
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
} from '../../packages/persistence/src/index.ts';
import { createM2R3TestData } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const fixture = createM2R3TestData(
  process.env.CODEX_TEST_RUN_ID ?? 'MCP_API_009',
);

if (connectionString) {
  describe('M2 R3 MCP browser API', () => {
    const database = createDatabase({ connectionString });
    const scoped = database.withSchema(fixture.schemaName);
    const repository = new PostgresMcpReadRepository(
      database,
      fixture.schemaName,
    );
    const authorization = new RequirementAuthorizationService(
      new PostgresAuthorizationPort(database, fixture.schemaName, {
        includeScopedTransmission: true,
      }),
    );
    let sequence = 0;
    const service = new McpReadApplicationService({
      repository,
      evidence: new PostgresExecutionEvidenceRepository(
        database,
        fixture.schemaName,
      ),
      authorization,
      now: () => fixture.now,
      idFactory: (prefix) => `${fixture.prefix}_${prefix}_${++sequence}`,
    });
    const actor = {
      actorId: fixture.accountId,
      roles: ['PRODUCT_OWNER'] as const,
      teamIds: [fixture.teamId],
      authenticationStatus: 'AUTHENTICATED' as const,
    };
    const server = buildServer({
      mcpReadService: service,
      resolveActor: () => actor,
    });

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
          review_evidence_ref: 'CODEx_TEST R3 design confirmation',
          row_version: 0,
          created_at: fixture.now,
          updated_at: fixture.now,
        })
        .execute();
    });

    afterAll(async () => {
      await server.close();
      await dropLifecycleSchema(database, fixture.schemaName);
      const remaining = await database
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', fixture.schemaName)
        .execute();
      expect(remaining).toEqual([]);
      await database.destroy();
    });

    it('lists only redacted logical capabilities for an authorized requirement', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/mcp-capabilities?requirementId=${fixture.requirementIds[0]}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            schemaVersion: 'mcp-capability-public/1',
            logicalCapabilityId: 'pfc.local.metadata.inspect',
            effect: 'READ_ONLY',
            riskLevel: 'LOW',
            maxInputBytes: 32768,
            maxOutputBytes: 262144,
            timeoutMs: 10000,
            status: 'ACTIVE',
          },
        ],
      });
      expect(response.body).not.toMatch(
        /local-tools|inspect_schema|configFingerprint|schemaHash/,
      );
    });

    it('rejects an MCP evidence target that is not owned by the requirement', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${fixture.sessionId}/mcp-read-requests`,
        headers: {
          'if-match': '"0"',
          'idempotency-key': `${fixture.prefix}_API_MCP_BAD_TARGET`,
        },
        payload: {
          schemaVersion: 'create-mcp-read-request/1',
          turnId: fixture.turnId,
          logicalCapabilityId: 'pfc.local.metadata.inspect',
          artifactVersionId: fixture.versionIds[1],
          input: { query: 'metadata' },
          sensitivity: 'INTERNAL',
          materialRefIds: [],
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'EVIDENCE_ARCHIVE_PENDING',
      });
      await expect(repository.listRequests(fixture.sessionId)).resolves.toEqual(
        [],
      );
    });

    it('queues one bounded request without returning or persisting raw output', async () => {
      const request = {
        method: 'POST',
        url: `/api/v1/work-sessions/${fixture.sessionId}/mcp-read-requests`,
        headers: {
          'if-match': '"0"',
          'idempotency-key': `${fixture.prefix}_API_MCP_REQUEST`,
        },
        payload: {
          schemaVersion: 'create-mcp-read-request/1',
          turnId: fixture.turnId,
          logicalCapabilityId: 'pfc.local.metadata.inspect',
          artifactVersionId: fixture.versionIds[0],
          input: { query: 'metadata' },
          sensitivity: 'INTERNAL',
          materialRefIds: [fixture.materialRefId],
        },
      } as const;
      const response = await server.inject(request);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        schemaVersion: 'mcp-read-request/1',
        sessionId: fixture.sessionId,
        status: 'QUEUED',
        outputSummary: null,
        evidenceId: null,
      });
      expect(response.body).not.toContain('metadata"}');
      const replay = await server.inject(request);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().id).toBe(response.json().id);

      const listed = await server.inject({
        method: 'GET',
        url: `/api/v1/work-sessions/${fixture.sessionId}/mcp-read-requests?requirementId=${fixture.requirementIds[0]}`,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().items).toHaveLength(1);
    });

    it('rejects a second active request before persisting another request', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/work-sessions/${fixture.sessionId}/mcp-read-requests`,
        headers: {
          'if-match': '"1"',
          'idempotency-key': `${fixture.prefix}_API_MCP_OVERSIZED`,
        },
        payload: {
          schemaVersion: 'create-mcp-read-request/1',
          turnId: fixture.turnId,
          logicalCapabilityId: 'pfc.local.metadata.inspect',
          artifactVersionId: fixture.versionIds[0],
          input: { query: 'x'.repeat(33000) },
          sensitivity: 'INTERNAL',
          materialRefIds: [],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'MCP_READ_CONCURRENCY_LIMIT',
      });
      await expect(
        repository.listRequests(fixture.sessionId),
      ).resolves.toHaveLength(1);
    });
  });
}
