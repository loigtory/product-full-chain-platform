import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { TimelineApplicationService } from './application-service.ts';

function serviceOrThrow(
  service: TimelineApplicationService | undefined,
): TimelineApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'Timeline capability is not configured.',
    );
  }
  return service;
}

function sequence(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Timeline sequence is invalid.',
    );
  }
  return parsed;
}

export function registerTimelineRoutes(
  server: FastifyInstance,
  input: {
    service?: TimelineApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.get(
    '/api/v1/requirements/:id/timeline',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', pattern: '^[0-9]+$' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { cursor?: string; limit?: number };
      return serviceOrThrow(input.service).listTimeline(
        await input.resolveActor(request),
        id,
        {
          cursor: query.cursor === undefined ? null : sequence(query.cursor, 0),
          limit: query.limit ?? 50,
        },
      );
    },
  );

  server.get(
    '/api/v1/requirements/:id/events',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { after: { type: 'string', pattern: '^[0-9]+$' } },
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { after?: string };
      const lastSequence = sequence(
        request.headers['last-event-id'] ?? query.after,
        0,
      );
      const replay = await serviceOrThrow(input.service).replayTimeline(
        await input.resolveActor(request),
        id,
        lastSequence,
      );
      const frames = replay.resetRequired
        ? [
            `data: ${JSON.stringify({ type: 'stream.reset-required', requirementId: id })}\n\n`,
          ]
        : replay.items.map(
            (event) =>
              `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
          );
      reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache, no-store')
        .header('x-content-type-options', 'nosniff');
      return `${frames.join('')}retry: 1000\n\n`;
    },
  );
}
