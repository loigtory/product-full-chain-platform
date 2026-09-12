import {
  WORK_SESSION_CONTROL_ACTIONS,
  WORK_TURN_CONTROL_ACTIONS,
  type ActionProposalDecisionRequest,
  type CreateProductWorkTransmissionAuthorizationRequest,
  type CreateProductWorkSessionRequest,
  type CreateProductWorkTurnRequest,
  type RevokeProductWorkTransmissionAuthorizationRequest,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { WorkSessionApplicationService } from './application-service.ts';

function requiredHeader(request: FastifyRequest, name: 'idempotency-key') {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 240) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${name} is required.`);
  }
  return value.trim();
}

function requiredVersion(request: FastifyRequest): number {
  const value = request.headers['if-match'];
  const match = typeof value === 'string' ? /^"(\d+)"$/.exec(value) : null;
  if (!match) {
    throw new DomainRuleViolation('VALIDATION_FAILED', 'if-match is required.');
  }
  return Number(match[1]);
}

const idParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 3, maxLength: 200 } },
} as const;

export function registerWorkSessionRoutes(
  server: FastifyInstance,
  input: {
    service?: WorkSessionApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;

  server.get('/api/v1/requirements/:id/work-sessions', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string | number };
    return input.service!.list(
      await input.resolveActor(request),
      id,
      Number(query.limit ?? 20),
    );
  });

  server.post(
    '/api/v1/requirements/:id/work-sessions',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'controlSurface'],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'create-product-work-session/1',
            },
            teamId: { type: 'string', minLength: 3, maxLength: 160 },
            controlSurface: { type: 'string', const: 'WEB' },
            title: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      requiredHeader(request, 'idempotency-key');
      const { id } = request.params as { id: string };
      const result = await input.service!.create({
        actor: await input.resolveActor(request),
        requirementId: id,
        request: request.body as CreateProductWorkSessionRequest,
      });
      reply
        .code(result.replayed ? 200 : 201)
        .header('location', `/api/v1/work-sessions/${result.session.id}`)
        .header('etag', `"${result.session.rowVersion}"`);
      return result;
    },
  );

  server.get('/api/v1/work-sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const snapshot = await input.service!.snapshot(
      await input.resolveActor(request),
      id,
    );
    reply.header('etag', `"${snapshot.session.rowVersion}"`);
    return snapshot;
  });

  server.get('/api/v1/work-sessions/:id/readiness', async (request, reply) => {
    const { id } = request.params as { id: string };
    const readiness = await input.service!.readiness(
      await input.resolveActor(request),
      id,
    );
    reply.header('etag', `"${readiness.sessionRowVersion}"`);
    return readiness;
  });

  server.post(
    '/api/v1/work-sessions/:id/transmission-authorizations',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion',
            'beneficiaryActorId',
            'materialRefIds',
            'validForMinutes',
          ],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'create-product-work-transmission-authorization/1',
            },
            beneficiaryActorId: {
              type: 'string',
              minLength: 3,
              maxLength: 200,
            },
            materialRefIds: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: { type: 'string', minLength: 3, maxLength: 200 },
            },
            validForMinutes: { type: 'integer', minimum: 1, maximum: 30 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await input.service!.grantTransmissionAuthorization({
        actor: await input.resolveActor(request),
        sessionId: id,
        request:
          request.body as CreateProductWorkTransmissionAuthorizationRequest,
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
      });
      reply
        .code(result.replayed ? 200 : 201)
        .header(
          'location',
          `/api/v1/transmission-authorizations/${result.authorization.authorizationId}`,
        )
        .header('etag', `"${result.authorization.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/transmission-authorizations/:id/revocations',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion'],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'revoke-product-work-transmission-authorization/1',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      void (request.body as RevokeProductWorkTransmissionAuthorizationRequest);
      const result = await input.service!.revokeTransmissionAuthorization({
        actor: await input.resolveActor(request),
        authorizationId: id,
        expectedRowVersion: requiredVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
      });
      reply.header('etag', `"${result.authorization.rowVersion}"`);
      return result;
    },
  );

  server.get('/api/v1/work-sessions/:id/turns', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string | number };
    return input.service!.turns(
      await input.resolveActor(request),
      id,
      Number(query.limit ?? 50),
    );
  });

  server.post(
    '/api/v1/work-sessions/:id/turns',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion',
            'intentKind',
            'message',
            'contextBindingIds',
          ],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'create-product-work-turn/1',
            },
            intentKind: { type: 'string', minLength: 1, maxLength: 80 },
            message: { type: 'string', minLength: 1, maxLength: 8000 },
            contextBindingIds: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: { type: 'string', minLength: 3, maxLength: 200 },
            },
            skillReleaseId: { type: 'string', minLength: 3, maxLength: 160 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await input.service!.submitTurn({
        actor: await input.resolveActor(request),
        sessionId: id,
        request: request.body as CreateProductWorkTurnRequest,
        expectedSessionVersion: requiredVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
      });
      reply
        .code(result.replayed ? 200 : 202)
        .header('location', `/api/v1/work-turns/${result.turn.id}`)
        .header('etag', `"${result.turn.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/work-sessions/:id/controls',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'action'],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'product-work-session-control/1',
            },
            action: { type: 'string', enum: WORK_SESSION_CONTROL_ACTIONS },
          },
        },
      },
    },
    async (request, reply) => {
      requiredHeader(request, 'idempotency-key');
      const { id } = request.params as { id: string };
      const { action } = request.body as {
        action: (typeof WORK_SESSION_CONTROL_ACTIONS)[number];
      };
      const session = await input.service!.controlSession({
        actor: await input.resolveActor(request),
        sessionId: id,
        action,
        expectedRowVersion: requiredVersion(request),
      });
      reply.header('etag', `"${session.rowVersion}"`);
      return { replayed: false, session };
    },
  );

  server.post(
    '/api/v1/work-turns/:id/controls',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'action'],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'product-work-turn-control/1',
            },
            action: { type: 'string', enum: WORK_TURN_CONTROL_ACTIONS },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { action } = request.body as {
        action: (typeof WORK_TURN_CONTROL_ACTIONS)[number];
      };
      const turn = await input.service!.controlTurn({
        actor: await input.resolveActor(request),
        turnId: id,
        action,
        expectedTurnVersion: requiredVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
      });
      reply.header('etag', `"${turn.rowVersion}"`);
      return { replayed: false, turn };
    },
  );

  server.post(
    '/api/v1/action-proposals/:id/decisions',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'decision', 'scopeHash', 'reasonCode'],
          properties: {
            schemaVersion: {
              type: 'string',
              const: 'action-proposal-decision/1',
            },
            decision: { type: 'string', enum: ['CONFIRM', 'REJECT'] },
            scopeHash: {
              type: 'string',
              pattern: '^sha256:[A-Fa-f0-9]{64}$',
            },
            reasonCode: { type: 'string', minLength: 3, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      requiredHeader(request, 'idempotency-key');
      const { id } = request.params as { id: string };
      const proposal = await input.service!.decideProposal({
        actor: await input.resolveActor(request),
        proposalId: id,
        request: request.body as ActionProposalDecisionRequest,
        expectedProposalVersion: requiredVersion(request),
      });
      reply.header('etag', `"${proposal.rowVersion}"`);
      return { replayed: false, proposal };
    },
  );

  server.get('/api/v1/work-sessions/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { after?: string | number };
    const header = request.headers['last-event-id'];
    const after = Number(
      query.after ?? (typeof header === 'string' ? header : 0),
    );
    const result = await input.service!.events(
      await input.resolveActor(request),
      id,
      after,
    );
    reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('x-accel-buffering', 'no');
    const frames = result.reloadRequired
      ? [
          `event: RELOAD_REQUIRED\ndata: ${JSON.stringify({ code: 'EVENT_GAP_REQUIRES_RELOAD' })}\n\n`,
        ]
      : result.items.map(
          (event) =>
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
    return `retry: 15000\n\n${frames.join('')}`;
  });
}
