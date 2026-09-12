import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorContext,
  CreateMcpReadRequest,
  ExecutionEvidenceSourceType,
  McpReadRequestDto,
} from '@pfc/contracts';
import { assertMcpReadAllowed, DomainRuleViolation } from '@pfc/domain';

import type { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  ExecutionEvidenceRepositoryPort,
  McpReadRepositoryPort,
} from './repository-port.ts';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export class McpReadApplicationService {
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(
    private readonly input: {
      repository: McpReadRepositoryPort;
      evidence: ExecutionEvidenceRepositoryPort;
      authorization: RequirementAuthorizationService;
      now?: () => string;
      idFactory?: (prefix: string) => string;
    },
  ) {
    this.now = input.now ?? (() => new Date().toISOString());
    this.idFactory =
      input.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async authorize(
    actor: ActorContext,
    requirementId: string,
    action: 'READ_MCP' | 'VIEW_ARTIFACT',
  ): Promise<void> {
    const decision = await this.input.authorization.authorize(actor, {
      requirementId,
      action,
      sensitivity: 'INTERNAL',
      materialRefIds: [],
      requestedAt: this.now(),
    });
    if (decision.decision !== 'ALLOW') {
      throw new DomainRuleViolation(
        decision.code ?? 'PERMISSION_DENIED',
        'MCP evidence access denied.',
        { reasonCode: decision.reasonCode },
      );
    }
  }

  async listEvidence(input: {
    actor: ActorContext;
    requirementId: string;
    sourceType?: ExecutionEvidenceSourceType;
    cursor?: string;
    limit: number;
  }) {
    await this.authorize(input.actor, input.requirementId, 'VIEW_ARTIFACT');
    return this.input.evidence.list(input);
  }

  async listCapabilities(actor: ActorContext, requirementId: string) {
    await this.authorize(actor, requirementId, 'READ_MCP');
    const registrations = await this.input.repository.listCapabilities({
      requirementId,
      teamIds: actor.teamIds,
    });
    return {
      items: registrations.map((item) => ({
        schemaVersion: 'mcp-capability-public/1' as const,
        logicalCapabilityId: item.logicalCapabilityId,
        effect: item.effect,
        riskLevel: item.riskLevel,
        maxInputBytes: item.maxInputBytes,
        maxOutputBytes: item.maxOutputBytes,
        timeoutMs: item.timeoutMs,
        status: item.status,
      })),
    };
  }

  async listRequests(input: {
    actor: ActorContext;
    sessionId: string;
    requirementId: string;
  }) {
    await this.authorize(input.actor, input.requirementId, 'READ_MCP');
    return { items: await this.input.repository.listRequests(input.sessionId) };
  }

  async createRequest(input: {
    actor: ActorContext;
    sessionId: string;
    request: CreateMcpReadRequest;
    expectedSessionVersion: number;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ replayed: boolean; request: McpReadRequestDto }> {
    const now = this.now();
    const session = await this.input.repository.findSessionContext(
      input.sessionId,
      input.request.turnId,
    );
    if (!session)
      throw new DomainRuleViolation(
        'NOT_FOUND',
        'Work session or turn not found.',
      );
    if (session.session_status !== 'ACTIVE' || !session.opened_baseline_id) {
      throw new DomainRuleViolation(
        'CONTEXT_STALE',
        'Work session is not active.',
      );
    }
    await this.authorize(input.actor, session.requirement_id, 'READ_MCP');
    const route = `/api/v1/work-sessions/${input.sessionId}/mcp-read-requests`;
    const requestHash = hash({
      sessionId: input.sessionId,
      expectedSessionVersion: input.expectedSessionVersion,
      request: input.request,
    });
    const replay = await this.input.repository.findIdempotentRequest({
      actorId: input.actor.actorId,
      route,
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (replay?.status === 'REPLAYED') {
      return { replayed: true, request: replay.request };
    }
    if (replay?.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (replay?.status === 'UNKNOWN') {
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'MCP request result is unknown.',
      );
    }
    const capability = await this.input.repository.findCapability(
      input.request.logicalCapabilityId,
    );
    if (!capability) {
      throw new DomainRuleViolation(
        'MCP_CAPABILITY_UNAVAILABLE',
        'MCP capability is unavailable.',
      );
    }
    const runtime = await this.input.repository.resolveRuntime({
      capability,
      teamId: session.team_id,
      at: now,
    });
    if (!runtime) {
      throw new DomainRuleViolation(
        'MCP_CAPABILITY_UNAVAILABLE',
        'MCP runtime is unavailable.',
      );
    }
    let transmissionAuthorized = input.request.sensitivity !== 'RESTRICTED';
    if (input.request.sensitivity === 'RESTRICTED') {
      const decision = await this.input.authorization.authorize(input.actor, {
        requirementId: session.requirement_id,
        action: 'TRANSMIT_MATERIAL',
        sensitivity: input.request.sensitivity,
        materialRefIds: input.request.materialRefIds,
        transmission: {
          target: 'MCP',
          purpose: `mcp-read:${capability.logicalCapabilityId}`,
        },
        requestedAt: now,
      });
      transmissionAuthorized = decision.decision === 'ALLOW';
    }
    assertMcpReadAllowed({
      registration: capability,
      runtime,
      teamId: session.team_id,
      requirementId: session.requirement_id,
      input: input.request.input,
      sensitivity: input.request.sensitivity,
      transmissionAuthorized,
      activeRequestCount: await this.input.repository.countActiveRequests(
        input.sessionId,
      ),
    });
    const requestId = this.idFactory('mcp-read-request');
    const result = await this.input.repository.createRequest({
      request: {
        schemaVersion: 'mcp-read-request/1',
        id: requestId,
        sessionId: input.sessionId,
        turnId: input.request.turnId,
        requirementId: session.requirement_id,
        teamId: session.team_id,
        capabilityId: capability.id,
        logicalCapabilityId: capability.logicalCapabilityId,
        inputHash: hash(input.request.input),
        sensitivity: input.request.sensitivity,
        status: 'QUEUED',
        bridgeId: runtime.bridgeId,
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
        createdBy: input.actor.actorId,
        createdAt: now,
        updatedAt: now,
        terminalAt: null,
      },
      rawInput: input.request.input,
      materialRefIds: input.request.materialRefIds,
      commandId: this.idFactory('mcp-read-command'),
      expectedSessionVersion: input.expectedSessionVersion,
      evidence: {
        actorId: input.actor.actorId,
        eventId: this.idFactory('mcp-read-event'),
        outboxId: this.idFactory('mcp-read-outbox'),
        auditId: this.idFactory('mcp-read-audit'),
        requestId: input.requestId,
        eventType: 'mcp.read.requested',
        aggregateType: capability.logicalCapabilityId,
        aggregateId: requestId,
        aggregateVersion: 0,
        requirementId: session.requirement_id,
        occurredAt: now,
        route,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        idempotencyId: this.idFactory('mcp-read-idempotency'),
      },
    });
    if (result.status === 'CONFLICT') {
      throw new DomainRuleViolation(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency conflict.',
      );
    }
    if (result.status === 'VERSION_CONFLICT') {
      throw new DomainRuleViolation(
        'VERSION_CONFLICT',
        'Work session version conflict.',
      );
    }
    if (!result.request)
      throw new DomainRuleViolation(
        'RESULT_UNKNOWN',
        'MCP request result is unknown.',
      );
    return { replayed: result.status === 'REPLAYED', request: result.request };
  }
}
