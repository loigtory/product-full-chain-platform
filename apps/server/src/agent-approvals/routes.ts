import { AGENT_APPROVAL_DECISIONS } from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { AgentApprovalApplicationService } from './application-service.ts';

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

export function registerAgentApprovalRoutes(
  server: FastifyInstance,
  input: {
    service?: AgentApprovalApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;
  server.get('/api/v1/agent-approvals', async (request) => {
    const query = request.query as { limit?: string | number };
    return input.service!.list(
      await input.resolveActor(request),
      Number(query.limit ?? 50),
    );
  });
  server.get(
    '/api/v1/agent-runs/:runId/approvals/:approvalId',
    async (request, reply) => {
      const { runId, approvalId } = request.params as {
        runId: string;
        approvalId: string;
      };
      const approval = await input.service!.get(
        await input.resolveActor(request),
        runId,
        approvalId,
      );
      reply.header('etag', `"${approval.rowVersion}"`);
      return approval;
    },
  );
  server.post(
    '/api/v1/agent-approvals/:approvalId/decision',
    { schema: { body: agentApprovalDecisionSchema } },
    async (request, reply) => {
      const { approvalId } = request.params as { approvalId: string };
      const approval = await input.service!.decide({
        actor: await input.resolveActor(request),
        approvalId,
        expectedRowVersion: expectedVersion(request),
        request:
          request.body as import('@pfc/contracts').AgentApprovalDecisionRequest,
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply.header('etag', `"${approval.rowVersion}"`);
      return approval;
    },
  );
}

export const agentApprovalDecisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'reasonCode'],
  properties: {
    decision: {
      enum: AGENT_APPROVAL_DECISIONS.filter((value) =>
        ['APPROVED', 'REJECTED', 'CANCELLED'].includes(value),
      ),
    },
    reasonCode: { type: 'string', minLength: 3, maxLength: 200 },
    approvedScope: {
      type: 'object',
      additionalProperties: false,
      required: [
        'allowedRelativePaths',
        'allowedActions',
        'networkAccess',
        'maxChangedFiles',
        'maxChangedBytes',
      ],
      properties: {
        allowedRelativePaths: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 200 },
        },
        allowedActions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { enum: ['EDIT_FILES', 'FORMAT', 'TEST', 'BUILD'] },
        },
        networkAccess: { const: false },
        maxChangedFiles: { type: 'integer', minimum: 1, maximum: 100 },
        maxChangedBytes: { type: 'integer', minimum: 1, maximum: 10000000 },
      },
    },
  },
} as const;
