import {
  AGENT_RUN_ACCESS_MODES,
  AGENT_RUN_OPERATIONS,
  type CreateAgentRunRequest,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { AgentRunApplicationService } from './application-service.ts';

function requiredIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'idempotency-key is required.',
    );
  }
  return value;
}

export function registerAgentRunRoutes(
  server: FastifyInstance,
  input: { service?: AgentRunApplicationService; resolveActor: ActorResolver },
): void {
  if (!input.service) return;
  server.post(
    '/api/v1/requirements/:id/agent-runs',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 3, maxLength: 160 } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'baselineId',
            'workspaceId',
            'skillKey',
            'skillVersion',
            'operation',
            'accessMode',
          ],
          properties: {
            baselineId: { type: 'string', minLength: 3, maxLength: 160 },
            workspaceId: { type: 'string', minLength: 3, maxLength: 160 },
            skillKey: { type: 'string', minLength: 3, maxLength: 160 },
            skillVersion: { type: 'string', minLength: 1, maxLength: 120 },
            operation: { type: 'string', enum: AGENT_RUN_OPERATIONS },
            accessMode: { type: 'string', enum: AGENT_RUN_ACCESS_MODES },
            writeScope: {
              type: 'object',
              additionalProperties: false,
              required: [
                'allowedRelativePaths',
                'allowedActions',
                'maxChangedFiles',
                'maxChangedBytes',
              ],
              properties: {
                allowedRelativePaths: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: { type: 'string', minLength: 1, maxLength: 200 },
                },
                allowedActions: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 4,
                  uniqueItems: true,
                  items: { enum: ['EDIT_FILES', 'FORMAT', 'TEST', 'BUILD'] },
                },
                maxChangedFiles: { type: 'integer', minimum: 1, maximum: 100 },
                maxChangedBytes: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 10000000,
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await input.service!.create({
        actor: await input.resolveActor(request),
        requirementId: id,
        request: request.body as CreateAgentRunRequest,
        idempotencyKey: requiredIdempotencyKey(request),
        requestId: request.id,
      });
      reply
        .code(result.replayed ? 200 : 201)
        .header('location', `/api/v1/agent-runs/${result.run.id}`)
        .header('etag', `"${result.run.rowVersion}"`);
      return result;
    },
  );
  server.get('/api/v1/requirements/:id/agent-run-options', async (request) => {
    const { id } = request.params as { id: string };
    return input.service!.launchOptions(await input.resolveActor(request), id);
  });
  server.get('/api/v1/agent-runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = await input.service!.get(
      await input.resolveActor(request),
      runId,
    );
    reply.header('etag', `"${run.rowVersion}"`);
    return run;
  });
  server.get('/api/v1/agent-runs', async (request) => {
    const query = request.query as { limit?: string | number };
    return input.service!.list(
      await input.resolveActor(request),
      Number(query.limit ?? 50),
    );
  });
  server.get('/api/v1/agent-runs/:runId/events', async (request) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as {
      afterSequence?: string | number;
      limit?: string | number;
    };
    const afterSequence = Number(query.afterSequence ?? 0);
    const limit = Number(query.limit ?? 50);
    if (
      !Number.isInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new DomainRuleViolation(
        'VALIDATION_FAILED',
        'AgentRun event cursor is invalid.',
      );
    }
    return input.service!.events(
      await input.resolveActor(request),
      runId,
      afterSequence,
      limit,
    );
  });
}
