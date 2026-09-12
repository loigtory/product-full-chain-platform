import type {
  McpCapabilityRegistrationDto,
  McpReadRequestDto,
  MutationEvidence,
  SensitivityLevel,
} from '@pfc/contracts';
import {
  MCP_READ_COMMAND_VERSION,
  MCP_READ_CONTEXT_VERSION,
  parseBridgeCapabilitySnapshot,
  type McpReadCommand,
  type McpReadContext,
  type McpReadEvent,
} from '@pfc/protocol';

import type { LifecycleKysely } from './database.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function capabilityDto(row: {
  id: string;
  logical_capability_id: string;
  server_name: string;
  tool_name: string;
  input_schema_hash: string;
  config_fingerprint: string;
  effect: McpCapabilityRegistrationDto['effect'];
  risk_level: McpCapabilityRegistrationDto['riskLevel'];
  max_input_bytes: number;
  max_output_bytes: number;
  timeout_ms: number;
  allowed_team_ids: unknown;
  allowed_requirement_ids: unknown;
  status: McpCapabilityRegistrationDto['status'];
  reviewed_by: string;
  reviewed_at: Date | string;
  review_evidence_ref: string;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}): McpCapabilityRegistrationDto {
  return {
    schemaVersion: 'mcp-capability-registration/1',
    id: row.id,
    logicalCapabilityId: row.logical_capability_id,
    serverName: row.server_name,
    toolName: row.tool_name,
    inputSchemaHash: row.input_schema_hash,
    configFingerprint: row.config_fingerprint,
    effect: row.effect,
    riskLevel: row.risk_level,
    maxInputBytes: row.max_input_bytes,
    maxOutputBytes: row.max_output_bytes,
    timeoutMs: row.timeout_ms,
    allowedTeamIds: stringArray(row.allowed_team_ids),
    allowedRequirementIds: stringArray(row.allowed_requirement_ids),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: timestamp(row.reviewed_at),
    reviewEvidenceRef: row.review_evidence_ref,
    rowVersion: row.row_version,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function requestDto(
  row: {
    id: string;
    session_id: string;
    turn_id: string;
    requirement_id: string;
    team_id: string;
    capability_id: string;
    artifact_version_id: string;
    input_hash: string;
    sensitivity: SensitivityLevel;
    status: McpReadRequestDto['status'];
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
    created_at: Date | string;
    updated_at: Date | string;
    terminal_at: Date | string | null;
  },
  logicalCapabilityId: string,
): McpReadRequestDto {
  return {
    schemaVersion: 'mcp-read-request/1',
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    requirementId: row.requirement_id,
    teamId: row.team_id,
    capabilityId: row.capability_id,
    logicalCapabilityId,
    artifactVersionId: row.artifact_version_id,
    inputHash: row.input_hash,
    sensitivity: row.sensitivity,
    status: row.status,
    bridgeId: row.bridge_id,
    externalThreadId: row.external_thread_id,
    outputSummary: row.output_summary,
    outputHash: row.output_hash,
    outputBytes: row.output_bytes,
    outputTruncated: row.output_truncated,
    durationMs: row.duration_ms,
    evidenceId: row.evidence_id,
    failureReason: row.failure_reason,
    recoveryAction: row.recovery_action,
    rowVersion: row.row_version,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    terminalAt: row.terminal_at ? timestamp(row.terminal_at) : null,
  };
}

export class PostgresMcpReadRepository {
  private readonly db;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async findSessionContext(sessionId: string, turnId: string) {
    return (
      (await this.db
        .selectFrom('product_work_sessions')
        .innerJoin(
          'product_work_turns',
          'product_work_turns.session_id',
          'product_work_sessions.id',
        )
        .select([
          'product_work_sessions.id as session_id',
          'product_work_sessions.requirement_id',
          'product_work_sessions.team_id',
          'product_work_sessions.opened_baseline_id',
          'product_work_sessions.status as session_status',
          'product_work_sessions.row_version as session_row_version',
          'product_work_sessions.last_sequence',
          'product_work_turns.id as turn_id',
          'product_work_turns.status as turn_status',
        ])
        .where('product_work_sessions.id', '=', sessionId)
        .where('product_work_turns.id', '=', turnId)
        .executeTakeFirst()) ?? null
    );
  }

  async findCapability(logicalCapabilityId: string) {
    const row = await this.db
      .selectFrom('mcp_capability_registrations')
      .selectAll()
      .where('logical_capability_id', '=', logicalCapabilityId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row ? capabilityDto(row) : null;
  }

  async evidenceTargetBelongsToRequirement(input: {
    artifactVersionId: string;
    requirementId: string;
  }): Promise<boolean> {
    const row = await this.db
      .selectFrom('artifact_versions')
      .innerJoin('artifacts', 'artifacts.id', 'artifact_versions.artifact_id')
      .select('artifact_versions.id')
      .where('artifact_versions.id', '=', input.artifactVersionId)
      .where('artifacts.requirement_id', '=', input.requirementId)
      .where('artifacts.status', '=', 'ACTIVE')
      .executeTakeFirst();
    return Boolean(row);
  }

  async listCapabilities(input: {
    requirementId: string;
    teamIds: readonly string[];
  }): Promise<readonly McpCapabilityRegistrationDto[]> {
    const rows = await this.db
      .selectFrom('mcp_capability_registrations')
      .selectAll()
      .where('status', '=', 'ACTIVE')
      .orderBy('logical_capability_id')
      .limit(100)
      .execute();
    return rows
      .map(capabilityDto)
      .filter(
        (item) =>
          item.allowedRequirementIds.includes(input.requirementId) &&
          item.allowedTeamIds.some((teamId) => input.teamIds.includes(teamId)),
      );
  }

  async resolveRuntime(input: {
    capability: McpCapabilityRegistrationDto;
    teamId: string;
    at: string;
  }) {
    const rows = await this.db
      .selectFrom('bridge_registrations')
      .innerJoin(
        'bridge_capability_snapshots',
        'bridge_capability_snapshots.bridge_id',
        'bridge_registrations.id',
      )
      .select([
        'bridge_registrations.id as bridge_id',
        'bridge_capability_snapshots.capabilities',
      ])
      .where('bridge_registrations.team_id', '=', input.teamId)
      .where('bridge_registrations.status', 'in', ['ONLINE', 'DEGRADED'])
      .where('bridge_registrations.revoked_at', 'is', null)
      .where('bridge_capability_snapshots.expires_at', '>', new Date(input.at))
      .orderBy('bridge_capability_snapshots.captured_at', 'desc')
      .limit(20)
      .execute();
    for (const row of rows) {
      try {
        const snapshot = parseBridgeCapabilitySnapshot(
          typeof row.capabilities === 'string'
            ? (JSON.parse(row.capabilities) as unknown)
            : row.capabilities,
        );
        if (snapshot.snapshotVersion !== 'pfc-bridge-capabilities/2') continue;
        const server = snapshot.mcp.servers.find(
          (item) => item.name === input.capability.serverName,
        );
        const tool = server?.tools.find(
          (item) => item.name === input.capability.toolName,
        );
        if (!server || !tool) continue;
        return {
          bridgeId: row.bridge_id,
          state: snapshot.mcp.state,
          serverName: server.name,
          toolName: tool.name,
          inputSchemaHash: tool.inputSchemaHash,
          configFingerprint: snapshot.mcp.configFingerprint,
          runtimeStatus: server.runtimeStatus,
          authStatus: server.authStatus,
          readOnlyHint: tool.readOnlyHint,
        } as const;
      } catch {
        continue;
      }
    }
    return null;
  }

  async countActiveRequests(sessionId: string): Promise<number> {
    const result = await this.db
      .selectFrom('mcp_read_requests')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('session_id', '=', sessionId)
      .where('status', 'in', ['REQUESTED', 'QUEUED', 'LEASED', 'RUNNING'])
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async findIdempotentRequest(input: {
    actorId: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    | { status: 'REPLAYED'; request: McpReadRequestDto }
    | { status: 'CONFLICT' | 'UNKNOWN'; request: null }
    | null
  > {
    const record = await this.db
      .selectFrom('idempotency_records')
      .select(['request_hash', 'result_reference'])
      .where('actor_id', '=', input.actorId)
      .where('route', '=', input.route)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    if (!record) return null;
    if (record.request_hash !== input.requestHash) {
      return { status: 'CONFLICT', request: null };
    }
    if (!record.result_reference) return { status: 'UNKNOWN', request: null };
    const request = await this.findRequest(record.result_reference);
    return request
      ? { status: 'REPLAYED', request }
      : { status: 'UNKNOWN', request: null };
  }

  async createRequest(input: {
    request: McpReadRequestDto;
    rawInput: Readonly<Record<string, unknown>>;
    materialRefIds: readonly string[];
    commandId: string;
    expectedSessionVersion: number;
    evidence: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT' | 'VERSION_CONFLICT';
    request: McpReadRequestDto | null;
  }> {
    return this.db
      .transaction()
      .execute(async (transaction) => {
        const claim = await claimMutation(transaction, input.evidence);
        if (claim.status !== 'NEW') {
          const replay = claim.resultReference
            ? await transaction
                .selectFrom('mcp_read_requests')
                .selectAll()
                .where('id', '=', claim.resultReference)
                .executeTakeFirst()
            : null;
          return {
            status:
              claim.status === 'REPLAYED'
                ? ('REPLAYED' as const)
                : ('CONFLICT' as const),
            request: replay
              ? requestDto(replay, input.request.logicalCapabilityId)
              : null,
          };
        }
        const session = await transaction
          .selectFrom('product_work_sessions')
          .select(['row_version', 'last_sequence'])
          .where('id', '=', input.request.sessionId)
          .forUpdate()
          .executeTakeFirst();
        if (!session || session.row_version !== input.expectedSessionVersion) {
          throw new Error('MCP_READ_SESSION_VERSION_CONFLICT');
        }
        const row = await transaction
          .insertInto('mcp_read_requests')
          .values({
            id: input.request.id,
            session_id: input.request.sessionId,
            turn_id: input.request.turnId,
            requirement_id: input.request.requirementId,
            team_id: input.request.teamId,
            capability_id: input.request.capabilityId,
            artifact_version_id: input.request.artifactVersionId,
            input_payload: input.rawInput,
            input_hash: input.request.inputHash,
            sensitivity: input.request.sensitivity,
            material_ref_ids: JSON.stringify(input.materialRefIds),
            status: 'QUEUED',
            bridge_id: input.request.bridgeId,
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
            created_by: input.request.createdBy,
            created_at: input.request.createdAt,
            updated_at: input.request.updatedAt,
            terminal_at: null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('product_work_turn_commands')
          .values({
            id: input.commandId,
            turn_id: input.request.turnId,
            command_type: 'EXECUTE_MCP_READ',
            payload_summary: {
              requestId: input.request.id,
              inputHash: input.request.inputHash,
            },
            status: 'PENDING',
            required_capability: 'mcp-read/1',
            lease_owner: null,
            lease_until: null,
            attempt: 0,
            idempotency_key: `${input.evidence.idempotencyKey}:mcp-command`,
            result_summary: null,
            created_at: input.request.createdAt,
            updated_at: input.request.updatedAt,
          })
          .execute();
        const sequence = session.last_sequence + 1;
        await transaction
          .insertInto('product_work_session_events')
          .values({
            id: input.evidence.eventId,
            session_id: input.request.sessionId,
            sequence,
            event_type: 'MCP_READ_REQUESTED',
            aggregate_type: 'MCP_READ_REQUEST',
            aggregate_id: input.request.id,
            safe_summary: {
              logicalCapabilityId: input.evidence.aggregateType,
              status: 'QUEUED',
            },
            source_event_id: null,
            occurred_at: input.request.createdAt,
            received_at: input.request.createdAt,
          })
          .execute();
        await transaction
          .updateTable('product_work_sessions')
          .set({
            last_sequence: sequence,
            row_version: session.row_version + 1,
            updated_at: input.request.updatedAt,
          })
          .where('id', '=', input.request.sessionId)
          .where('row_version', '=', session.row_version)
          .executeTakeFirstOrThrow();
        await appendMutationEvidence(transaction, {
          ...input.evidence,
          eventId: `${input.evidence.eventId}_TIMELINE`,
        });
        return {
          status: 'CREATED' as const,
          request: requestDto(row, input.request.logicalCapabilityId),
        };
      })
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message === 'MCP_READ_SESSION_VERSION_CONFLICT'
        ) {
          return { status: 'VERSION_CONFLICT' as const, request: null };
        }
        throw error;
      });
  }

  async findRequest(requestId: string): Promise<McpReadRequestDto | null> {
    const row = await this.db
      .selectFrom('mcp_read_requests')
      .innerJoin(
        'mcp_capability_registrations',
        'mcp_capability_registrations.id',
        'mcp_read_requests.capability_id',
      )
      .selectAll('mcp_read_requests')
      .select('mcp_capability_registrations.logical_capability_id')
      .where('mcp_read_requests.id', '=', requestId)
      .executeTakeFirst();
    return row ? requestDto(row, row.logical_capability_id) : null;
  }

  async listRequests(sessionId: string): Promise<readonly McpReadRequestDto[]> {
    const rows = await this.db
      .selectFrom('mcp_read_requests')
      .innerJoin(
        'mcp_capability_registrations',
        'mcp_capability_registrations.id',
        'mcp_read_requests.capability_id',
      )
      .selectAll('mcp_read_requests')
      .select('mcp_capability_registrations.logical_capability_id')
      .where('mcp_read_requests.session_id', '=', sessionId)
      .orderBy('mcp_read_requests.created_at')
      .limit(100)
      .execute();
    return rows.map((row) => requestDto(row, row.logical_capability_id));
  }

  async leaseNextCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
  }): Promise<McpReadCommand | null> {
    return this.db.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('product_work_turn_commands')
        .innerJoin(
          'mcp_read_requests',
          'mcp_read_requests.turn_id',
          'product_work_turn_commands.turn_id',
        )
        .innerJoin(
          'mcp_capability_registrations',
          'mcp_capability_registrations.id',
          'mcp_read_requests.capability_id',
        )
        .select([
          'product_work_turn_commands.id as command_id',
          'product_work_turn_commands.attempt',
          'mcp_read_requests.id as request_id',
          'mcp_read_requests.session_id',
          'mcp_read_requests.turn_id',
          'mcp_read_requests.input_hash',
          'mcp_read_requests.team_id',
          'mcp_capability_registrations.id as capability_id',
          'mcp_capability_registrations.logical_capability_id',
          'mcp_capability_registrations.server_name',
          'mcp_capability_registrations.tool_name',
          'mcp_capability_registrations.input_schema_hash',
          'mcp_capability_registrations.config_fingerprint',
        ])
        .where(
          'product_work_turn_commands.command_type',
          '=',
          'EXECUTE_MCP_READ',
        )
        .where('product_work_turn_commands.status', '=', 'PENDING')
        .where('product_work_turn_commands.attempt', '=', 0)
        .where('mcp_read_requests.status', '=', 'QUEUED')
        .where('mcp_read_requests.bridge_id', '=', input.bridgeId)
        .where('mcp_capability_registrations.status', '=', 'ACTIVE')
        .orderBy('product_work_turn_commands.created_at')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;
      const capability = await transaction
        .selectFrom('mcp_capability_registrations')
        .selectAll()
        .where('id', '=', candidate.capability_id)
        .executeTakeFirstOrThrow();
      const runtime = await this.resolveRuntime({
        capability: capabilityDto(capability),
        teamId: candidate.team_id,
        at: input.leasedAt,
      });
      if (
        runtime?.bridgeId !== input.bridgeId ||
        runtime.state !== 'AVAILABLE' ||
        runtime.runtimeStatus !== 'CONNECTED' ||
        runtime.inputSchemaHash.toLowerCase() !==
          candidate.input_schema_hash.toLowerCase() ||
        runtime.configFingerprint.toLowerCase() !==
          candidate.config_fingerprint.toLowerCase()
      ) {
        return null;
      }
      await transaction
        .updateTable('product_work_turn_commands')
        .set({
          status: 'LEASED',
          lease_owner: input.bridgeId,
          lease_until: input.leaseUntil,
          attempt: 1,
          updated_at: input.leasedAt,
        })
        .where('id', '=', candidate.command_id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('mcp_read_requests')
        .set({
          status: 'LEASED',
          row_version: 1,
          updated_at: input.leasedAt,
        })
        .where('id', '=', candidate.request_id)
        .where('status', '=', 'QUEUED')
        .executeTakeFirstOrThrow();
      return {
        schemaVersion: MCP_READ_COMMAND_VERSION,
        commandId: candidate.command_id,
        commandType: 'EXECUTE_MCP_READ',
        leaseUntil: input.leaseUntil,
        attempt: 1,
        payload: {
          requestId: candidate.request_id,
          sessionId: candidate.session_id,
          turnId: candidate.turn_id,
          capabilityId: candidate.capability_id,
          serverName: candidate.server_name,
          toolName: candidate.tool_name,
          inputSchemaHash: candidate.input_schema_hash,
          configFingerprint: candidate.config_fingerprint,
          inputHash: candidate.input_hash,
        },
      };
    });
  }

  async readLeasedContext(input: {
    bridgeId: string;
    commandId: string;
    readAt: string;
  }): Promise<McpReadContext | null> {
    const row = await this.db
      .selectFrom('product_work_turn_commands')
      .innerJoin(
        'mcp_read_requests',
        'mcp_read_requests.turn_id',
        'product_work_turn_commands.turn_id',
      )
      .innerJoin(
        'mcp_capability_registrations',
        'mcp_capability_registrations.id',
        'mcp_read_requests.capability_id',
      )
      .select([
        'mcp_read_requests.id as request_id',
        'mcp_read_requests.input_payload',
        'mcp_read_requests.sensitivity',
        'mcp_capability_registrations.timeout_ms',
        'mcp_capability_registrations.max_output_bytes',
      ])
      .where('product_work_turn_commands.id', '=', input.commandId)
      .where('product_work_turn_commands.command_type', '=', 'EXECUTE_MCP_READ')
      .where('product_work_turn_commands.status', '=', 'LEASED')
      .where('product_work_turn_commands.lease_owner', '=', input.bridgeId)
      .where(
        'product_work_turn_commands.lease_until',
        '>',
        new Date(input.readAt),
      )
      .where('mcp_read_requests.bridge_id', '=', input.bridgeId)
      .where('mcp_read_requests.status', '=', 'LEASED')
      .executeTakeFirst();
    if (!row) return null;
    const raw =
      typeof row.input_payload === 'string'
        ? (JSON.parse(row.input_payload) as unknown)
        : row.input_payload;
    if (!record(raw)) return null;
    return {
      schemaVersion: MCP_READ_CONTEXT_VERSION,
      commandId: input.commandId,
      requestId: row.request_id,
      input: raw,
      sensitivity: row.sensitivity,
      limits: {
        timeoutMs: row.timeout_ms,
        maxOutputBytes: row.max_output_bytes,
      },
    };
  }

  async appendEvent(input: {
    bridgeId: string;
    commandId: string;
    event: McpReadEvent;
    receivedAt: string;
    sessionEventId: string;
    evidenceId: string;
    operation: Omit<
      MutationEvidence,
      'aggregateId' | 'aggregateVersion' | 'occurredAt'
    >;
  }): Promise<'APPENDED' | 'DUPLICATE' | 'COMMAND_INVALID'> {
    return this.db.transaction().execute(async (transaction) => {
      const request = await transaction
        .selectFrom('product_work_turn_commands')
        .innerJoin(
          'mcp_read_requests',
          'mcp_read_requests.turn_id',
          'product_work_turn_commands.turn_id',
        )
        .innerJoin(
          'mcp_capability_registrations',
          'mcp_capability_registrations.id',
          'mcp_read_requests.capability_id',
        )
        .select([
          'mcp_read_requests.id',
          'mcp_read_requests.session_id',
          'mcp_read_requests.requirement_id',
          'mcp_read_requests.artifact_version_id',
          'mcp_read_requests.sensitivity',
          'mcp_read_requests.status',
          'mcp_read_requests.created_by',
          'mcp_read_requests.row_version',
          'mcp_capability_registrations.max_output_bytes',
        ])
        .where('product_work_turn_commands.id', '=', input.commandId)
        .where(
          'product_work_turn_commands.command_type',
          '=',
          'EXECUTE_MCP_READ',
        )
        .where('product_work_turn_commands.lease_owner', '=', input.bridgeId)
        .where('mcp_read_requests.bridge_id', '=', input.bridgeId)
        .where('mcp_read_requests.id', '=', input.event.payload.requestId)
        .forUpdate()
        .executeTakeFirst();
      if (!request) return 'COMMAND_INVALID';
      const duplicate = await transaction
        .selectFrom('product_work_session_events')
        .select('id')
        .where('session_id', '=', request.session_id)
        .where('source_event_id', '=', input.event.sourceEventId)
        .executeTakeFirst();
      if (duplicate) return 'DUPLICATE';
      const session = await transaction
        .selectFrom('product_work_sessions')
        .select(['last_sequence', 'row_version'])
        .where('id', '=', request.session_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const sequence = session.last_sequence + 1;
      let eventType:
        | 'MCP_READ_STARTED'
        | 'MCP_READ_COMPLETED'
        | 'MCP_READ_FAILED'
        | 'MCP_READ_UNKNOWN';
      let safeSummary: Record<string, string | number | boolean | null>;
      if (input.event.eventType === 'MCP_READ_STARTED') {
        if (request.status !== 'LEASED') return 'COMMAND_INVALID';
        await transaction
          .updateTable('mcp_read_requests')
          .set({
            status: 'RUNNING',
            external_thread_id: input.event.payload.threadId,
            row_version: request.row_version + 1,
            updated_at: input.event.occurredAt,
          })
          .where('id', '=', request.id)
          .where('status', '=', 'LEASED')
          .executeTakeFirstOrThrow();
        eventType = 'MCP_READ_STARTED';
        safeSummary = { status: 'RUNNING' };
      } else if (input.event.eventType === 'MCP_READ_COMPLETED') {
        if (
          request.status !== 'RUNNING' ||
          input.event.payload.outputBytes > request.max_output_bytes
        ) {
          return 'COMMAND_INVALID';
        }
        if (
          /(?:authorization|cookie|password|secret|token)\s*[:=]/i.test(
            input.event.payload.outputSummary,
          )
        ) {
          throw new Error('MCP_OUTPUT_UNSAFE');
        }
        const binding = await transaction
          .selectFrom('requirements')
          .innerJoin(
            'material_baselines',
            'material_baselines.id',
            'requirements.current_baseline_id',
          )
          .select('requirements.current_baseline_id as baseline_id')
          .where('requirements.id', '=', request.requirement_id)
          .executeTakeFirst();
        if (!binding?.baseline_id) {
          throw new Error('EVIDENCE_ARCHIVE_PENDING');
        }
        await transaction
          .insertInto('execution_evidence')
          .values({
            id: input.evidenceId,
            requirement_id: request.requirement_id,
            baseline_id: binding.baseline_id,
            source_type: 'MCP_READ_RESULT',
            source_id: request.id,
            outcome: 'SUCCEEDED',
            safe_summary: input.event.payload.outputSummary,
            content_hash: input.event.payload.outputHash,
            sensitivity: request.sensitivity,
            artifact_version_id: request.artifact_version_id,
            gate_run_id: null,
            retention_class: 'PRODUCT_FACT',
            created_at: input.event.occurredAt,
          })
          .execute();
        await transaction
          .updateTable('mcp_read_requests')
          .set({
            status: 'COMPLETED',
            external_thread_id: input.event.payload.threadId,
            output_summary: input.event.payload.outputSummary,
            output_hash: input.event.payload.outputHash,
            output_bytes: input.event.payload.outputBytes,
            output_truncated: input.event.payload.truncated,
            duration_ms: input.event.payload.durationMs,
            evidence_id: input.evidenceId,
            row_version: request.row_version + 1,
            updated_at: input.event.occurredAt,
            terminal_at: input.event.occurredAt,
          })
          .where('id', '=', request.id)
          .where('status', '=', 'RUNNING')
          .executeTakeFirstOrThrow();
        eventType = 'MCP_READ_COMPLETED';
        safeSummary = {
          status: 'COMPLETED',
          durationMs: input.event.payload.durationMs,
          outputBytes: input.event.payload.outputBytes,
          evidenceId: input.evidenceId,
        };
      } else {
        if (!['LEASED', 'RUNNING'].includes(request.status))
          return 'COMMAND_INVALID';
        const unknown = input.event.eventType === 'MCP_READ_UNKNOWN';
        await transaction
          .updateTable('mcp_read_requests')
          .set({
            status: unknown ? 'UNKNOWN' : 'FAILED',
            external_thread_id: input.event.payload.threadId,
            failure_reason: input.event.payload.reasonCode,
            recovery_action: unknown
              ? 'VERIFY_MCP_RESULT'
              : 'RETRY_AFTER_CORRECTION',
            row_version: request.row_version + 1,
            updated_at: input.event.occurredAt,
            terminal_at: input.event.occurredAt,
          })
          .where('id', '=', request.id)
          .executeTakeFirstOrThrow();
        eventType = unknown ? 'MCP_READ_UNKNOWN' : 'MCP_READ_FAILED';
        safeSummary = {
          status: unknown ? 'UNKNOWN' : 'FAILED',
          reasonCode: input.event.payload.reasonCode,
        };
      }
      await transaction
        .updateTable('product_work_turn_commands')
        .set({
          status:
            eventType === 'MCP_READ_UNKNOWN'
              ? 'UNKNOWN'
              : eventType === 'MCP_READ_FAILED'
                ? 'FAILED'
                : eventType === 'MCP_READ_COMPLETED'
                  ? 'ACKNOWLEDGED'
                  : 'LEASED',
          result_summary: safeSummary,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.commandId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('product_work_session_events')
        .values({
          id: input.sessionEventId,
          session_id: request.session_id,
          sequence,
          event_type: eventType,
          aggregate_type: 'MCP_READ_REQUEST',
          aggregate_id: request.id,
          safe_summary: safeSummary,
          source_event_id: input.event.sourceEventId,
          occurred_at: input.event.occurredAt,
          received_at: input.receivedAt,
        })
        .execute();
      await transaction
        .updateTable('product_work_sessions')
        .set({
          last_sequence: sequence,
          row_version: session.row_version + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', request.session_id)
        .where('row_version', '=', session.row_version)
        .executeTakeFirstOrThrow();
      if (eventType !== 'MCP_READ_STARTED') {
        await appendMutationEvidence(transaction, {
          ...input.operation,
          actorId: request.created_by,
          aggregateId: request.id,
          aggregateVersion: request.row_version + 1,
          requirementId: request.requirement_id,
          occurredAt: input.event.occurredAt,
        });
      }
      return 'APPENDED';
    });
  }
}
