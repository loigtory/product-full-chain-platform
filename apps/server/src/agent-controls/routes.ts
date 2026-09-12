import { AGENT_CONTROL_ACTIONS } from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { AgentControlApplicationService } from './application-service.ts';

function requiredHeader(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${name} is required.`);
  }
  return value;
}

function expectedVersion(request: FastifyRequest): number {
  const match = /^"(\d+)"$/.exec(requiredHeader(request, 'if-match'));
  if (!match?.[1]) {
    throw new DomainRuleViolation('VALIDATION_FAILED', 'if-match is invalid.');
  }
  return Number(match[1]);
}

export function registerAgentControlRoutes(
  server: FastifyInstance,
  input: {
    service?: AgentControlApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;
  server.post(
    '/api/v1/agent-runs/:runId/controls',
    { schema: { body: agentControlSchema } },
    async (request, reply) => {
      const { runId } = request.params as { runId: string };
      const body = request.body as {
        action: (typeof AGENT_CONTROL_ACTIONS)[number];
        reasonCode: string;
      };
      const result = await input.service!.control({
        actor: await input.resolveActor(request),
        runId,
        expectedRowVersion: expectedVersion(request),
        action: body.action,
        reasonCode: body.reasonCode,
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply.header('etag', `"${result.run.rowVersion}"`);
      return result;
    },
  );
  server.post(
    '/api/v1/bridges/:bridgeId/revocations',
    { schema: { body: bridgeRevocationSchema } },
    async (request) => {
      const { bridgeId } = request.params as { bridgeId: string };
      const body = request.body as {
        reasonCode: string;
        expectedActiveRunCount: number;
      };
      return input.service!.revokeBridge({
        actor: await input.resolveActor(request),
        bridgeId,
        reasonCode: body.reasonCode,
        expectedActiveRunCount: body.expectedActiveRunCount,
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
    },
  );
}

export const agentControlSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'reasonCode'],
  properties: {
    action: { enum: AGENT_CONTROL_ACTIONS },
    reasonCode: { type: 'string', minLength: 3, maxLength: 200 },
  },
} as const;

export const bridgeRevocationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reasonCode', 'expectedActiveRunCount'],
  properties: {
    reasonCode: { type: 'string', minLength: 3, maxLength: 200 },
    expectedActiveRunCount: { type: 'integer', minimum: 0, maximum: 1000 },
  },
} as const;
