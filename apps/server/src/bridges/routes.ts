import {
  AGENT_APPROVAL_KINDS,
  AGENT_RUN_EVENT_TYPES,
  type AgentApprovalKind,
  type AgentApprovalScopeDto,
  type AgentRunEventType,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { BRIDGE_PROTOCOL_VERSION } from '../../../../packages/protocol/src/index.ts';
import { parseBridgeCapabilitySnapshot } from '../../../../packages/protocol/src/index.ts';
import type { BridgeApplicationService } from './application-service.ts';
import type { BridgeRequestContext } from './repository-port.ts';

function requiredHeader(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${name} is invalid.`);
  }
  return value;
}

export function bridgeContext(request: FastifyRequest): BridgeRequestContext {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    throw new DomainRuleViolation(
      'AUTHENTICATION_REQUIRED',
      'Bridge credential is required.',
    );
  }
  const match = /^Bridge ([A-Za-z0-9._~-]{20,400})$/.exec(authorization);
  if (!match?.[1]) {
    throw new DomainRuleViolation(
      'AUTHENTICATION_FAILED',
      'Bridge credential is invalid.',
    );
  }
  if (
    requiredHeader(request, 'x-pfc-protocol-version') !==
    BRIDGE_PROTOCOL_VERSION
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Bridge protocol version is unsupported.',
    );
  }
  const sentAt = requiredHeader(request, 'x-pfc-sent-at');
  if (Number.isNaN(Date.parse(sentAt))) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Bridge sent-at is invalid.',
    );
  }
  return {
    bridgeId: requiredHeader(request, 'x-pfc-bridge-id'),
    credential: match[1],
    messageId: requiredHeader(request, 'x-pfc-message-id'),
    nonce: requiredHeader(request, 'x-pfc-nonce'),
    sentAt,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = boundedString(value, field);
  if (Number.isNaN(Date.parse(result))) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return result;
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 200) return false;
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
  );
}

function hash(value: unknown, field: string): string {
  const result = boundedString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/i.test(result)) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return result.toLowerCase();
}

function gitBaseline(value: unknown): string {
  const result = boundedString(value, 'sourceGitBaseline');
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(result)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'sourceGitBaseline is invalid.',
    );
  }
  return result.toLowerCase();
}

function normalizedSummary(
  value: unknown,
  eventType: AgentRunEventType,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!record(value)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Bridge event summary is invalid.',
    );
  }
  const entries = Object.entries(value);
  if (entries.length > 40) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Bridge event summary is too large.',
    );
  }
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 80) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event summary key is invalid.',
      );
    }
    if (
      item !== null &&
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event summary value is invalid.',
      );
    }
    const stringLimit =
      eventType === 'AGENT_MESSAGE' && key === 'text' ? 2_000 : 1_000;
    if (
      (typeof item === 'string' && item.length > stringLimit) ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event summary value is invalid.',
      );
    }
    normalized[key] = item;
  }
  return normalized;
}

function approvalScope(value: unknown): AgentApprovalScopeDto {
  if (!record(value)) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Approval scope is invalid.',
    );
  }
  const paths = value.allowedRelativePaths;
  const actions = value.allowedActions;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        ![
          'allowedRelativePaths',
          'allowedActions',
          'networkAccess',
          'maxChangedFiles',
          'maxChangedBytes',
        ].includes(key),
    ) ||
    !Array.isArray(paths) ||
    paths.length < 1 ||
    paths.length > 100 ||
    !paths.every(safeRelativePath) ||
    new Set(paths).size !== paths.length ||
    !Array.isArray(actions) ||
    actions.length < 1 ||
    actions.length > 4 ||
    new Set(actions).size !== actions.length ||
    !actions.every((item) =>
      ['EDIT_FILES', 'FORMAT', 'TEST', 'BUILD'].includes(String(item)),
    ) ||
    typeof value.networkAccess !== 'boolean' ||
    !Number.isInteger(value.maxChangedFiles) ||
    !Number.isInteger(value.maxChangedBytes) ||
    Number(value.maxChangedFiles) < 1 ||
    Number(value.maxChangedFiles) > 100 ||
    Number(value.maxChangedBytes) < 1 ||
    Number(value.maxChangedBytes) > 10_000_000
  ) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Approval scope is invalid.',
    );
  }
  return value as unknown as AgentApprovalScopeDto;
}

export function registerBridgeRoutes(
  server: FastifyInstance,
  service?: BridgeApplicationService,
): void {
  if (!service) return;
  server.post('/bridge/v1/capability-snapshots', async (request, reply) => {
    let snapshot;
    try {
      snapshot = parseBridgeCapabilitySnapshot(request.body);
    } catch {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge capability snapshot is invalid.',
      );
    }
    const result = await service.reportCapabilities(
      bridgeContext(request),
      snapshot,
    );
    return reply.code(202).send(result);
  });
  server.get('/bridge/v1/commands/next', async (request, reply) => {
    const command = await service.nextCommand(bridgeContext(request));
    if (!command) return reply.code(204).send();
    return command;
  });
  server.post('/bridge/v1/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!record(request.body) || !record(request.body.event)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event payload is invalid.',
      );
    }
    const eventType = boundedString(request.body.event.eventType, 'eventType');
    if (!AGENT_RUN_EVENT_TYPES.includes(eventType as AgentRunEventType)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event type is invalid.',
      );
    }
    const expectedSequence = Number(request.body.expectedSequence);
    if (!Number.isInteger(expectedSequence) || expectedSequence < 1) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Bridge event sequence is invalid.',
      );
    }
    const result = await service.submitEvent(bridgeContext(request), {
      commandId: boundedString(request.body.commandId, 'commandId'),
      runId: boundedString(runId, 'runId'),
      sourceEventId: boundedString(request.body.sourceEventId, 'sourceEventId'),
      expectedSequence,
      event: {
        eventType: eventType as AgentRunEventType,
        summary: normalizedSummary(
          request.body.event.summary,
          eventType as AgentRunEventType,
        ),
      },
      occurredAt: timestamp(request.body.occurredAt, 'occurredAt'),
    });
    return reply.code(202).send(result);
  });
  server.post('/bridge/v1/runs/:runId/approvals', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!record(request.body)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Approval payload is invalid.',
      );
    }
    const kind = boundedString(request.body.kind, 'kind');
    if (!AGENT_APPROVAL_KINDS.includes(kind as AgentApprovalKind)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Approval kind is invalid.',
      );
    }
    const result = await service.submitApproval(bridgeContext(request), {
      commandId: boundedString(request.body.commandId, 'commandId'),
      runId: boundedString(runId, 'runId'),
      executionInstanceId: boundedString(
        request.body.executionInstanceId,
        'executionInstanceId',
      ),
      appServerRequestId: boundedString(
        request.body.appServerRequestId,
        'appServerRequestId',
      ),
      threadId: boundedString(request.body.threadId, 'threadId'),
      turnId: boundedString(request.body.turnId, 'turnId'),
      itemId: boundedString(request.body.itemId, 'itemId'),
      callbackId:
        request.body.callbackId === null
          ? null
          : boundedString(request.body.callbackId, 'callbackId'),
      kind: kind as AgentApprovalKind,
      requestedScope: approvalScope(request.body.requestedScope),
      outsideCapsule: request.body.outsideCapsule === true,
      requestedAt: timestamp(request.body.requestedAt, 'requestedAt'),
    });
    return reply.code(202).send(result);
  });
  server.post('/bridge/v1/runs/:runId/capsules', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!record(request.body)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Capsule payload is invalid.',
      );
    }
    const lifecycle = boundedString(request.body.lifecycle, 'lifecycle');
    if (!['MATERIALIZED', 'VERIFIED', 'UNKNOWN'].includes(lifecycle)) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Capsule lifecycle is invalid.',
      );
    }
    const diff = request.body.diffSummary;
    const diffSummary =
      diff === null
        ? null
        : record(diff) &&
            Number.isInteger(diff.changedFiles) &&
            Number.isInteger(diff.changedBytes) &&
            Number(diff.changedFiles) >= 0 &&
            Number(diff.changedFiles) <= 100 &&
            Number(diff.changedBytes) >= 0 &&
            Number(diff.changedBytes) <= 10_000_000 &&
            Array.isArray(diff.changedPaths) &&
            diff.changedPaths.length <= 100 &&
            diff.changedPaths.length === Number(diff.changedFiles) &&
            diff.changedPaths.every(safeRelativePath) &&
            new Set(diff.changedPaths).size === diff.changedPaths.length
          ? {
              changedFiles: Number(diff.changedFiles),
              changedBytes: Number(diff.changedBytes),
              changedPaths: diff.changedPaths as string[],
            }
          : null;
    if (diff !== null && !diffSummary) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Capsule diff is invalid.',
      );
    }
    const afterManifestHash =
      request.body.afterManifestHash === null
        ? null
        : hash(request.body.afterManifestHash, 'afterManifestHash');
    if (
      (lifecycle === 'MATERIALIZED' &&
        (afterManifestHash !== null || diffSummary !== null)) ||
      (lifecycle === 'VERIFIED' &&
        (afterManifestHash === null || diffSummary === null))
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'Capsule lifecycle evidence is invalid.',
      );
    }
    const result = await service.reportCapsule(bridgeContext(request), {
      runId: boundedString(runId, 'runId'),
      executionInstanceId: boundedString(
        request.body.executionInstanceId,
        'executionInstanceId',
      ),
      sourceGitBaseline: gitBaseline(request.body.sourceGitBaseline),
      scopeHash: hash(request.body.scopeHash, 'scopeHash'),
      beforeManifestHash: hash(
        request.body.beforeManifestHash,
        'beforeManifestHash',
      ),
      afterManifestHash,
      lifecycle: lifecycle as 'MATERIALIZED' | 'VERIFIED' | 'UNKNOWN',
      diffSummary,
      occurredAt: timestamp(request.body.occurredAt, 'occurredAt'),
    });
    return reply.code(202).send(result);
  });
  server.post(
    '/bridge/v1/commands/:commandId/acknowledgements',
    async (request, reply) => {
      const { commandId } = request.params as { commandId: string };
      if (!record(request.body)) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Bridge acknowledgement payload is invalid.',
        );
      }
      const status = boundedString(request.body.status, 'status');
      const allowed = [
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
        'UNKNOWN',
        'REJECTED',
      ] as const;
      if (!allowed.includes(status as (typeof allowed)[number])) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Bridge acknowledgement status is invalid.',
        );
      }
      const result = await service.acknowledge(bridgeContext(request), {
        commandId: boundedString(commandId, 'commandId'),
        runId: boundedString(request.body.runId, 'runId'),
        status: status as (typeof allowed)[number],
        ...(request.body.reasonCode === undefined
          ? {}
          : {
              reasonCode: boundedString(request.body.reasonCode, 'reasonCode'),
            }),
        ...(request.body.threadId === undefined
          ? {}
          : { threadId: boundedString(request.body.threadId, 'threadId') }),
        ...(request.body.turnId === undefined
          ? {}
          : { turnId: boundedString(request.body.turnId, 'turnId') }),
        acknowledgedAt: timestamp(
          request.body.acknowledgedAt,
          'acknowledgedAt',
        ),
      });
      return reply.code(202).send({ status: result });
    },
  );
}
