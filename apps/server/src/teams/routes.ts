import { ACTOR_ROLES, type ActorRole } from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { TeamApplicationService } from './application-service.ts';

function requiredMutationHeaders(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !key.trim() || key.length > 200) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Idempotency-Key is required.',
    );
  }
  return key;
}

export function registerTeamRoutes(
  server: FastifyInstance,
  input: {
    service?: TeamApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;

  server.get('/api/v1/teams', async (request) =>
    input.service!.listTeams(await input.resolveActor(request)),
  );

  server.post(
    '/api/v1/teams',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await input.service!.createTeam(
        await input.resolveActor(request),
        (request.body as { name: string }).name,
        requiredMutationHeaders(request),
        request.id,
      );
      reply
        .code(result.replayed ? 200 : 201)
        .header('etag', `"${result.value.rowVersion}"`);
      if (result.replayed) reply.header('idempotent-replay', 'true');
      return result.value;
    },
  );

  server.get('/api/v1/teams/:id/members', async (request) => {
    const { id } = request.params as { id: string };
    return input.service!.listMembers(await input.resolveActor(request), id);
  });

  server.post(
    '/api/v1/teams/:id/members',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['loginName', 'role'],
          properties: {
            loginName: { type: 'string', minLength: 3, maxLength: 64 },
            role: { type: 'string', enum: ACTOR_ROLES },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { loginName: string; role: ActorRole };
      const result = await input.service!.inviteMember({
        actor: await input.resolveActor(request),
        teamId: id,
        idempotencyKey: requiredMutationHeaders(request),
        requestId: request.id,
        ...body,
      });
      reply.code(201);
      return result;
    },
  );

  server.put(
    '/api/v1/requirements/:id/assignment',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId', 'accountId', 'responsibility'],
          properties: {
            teamId: { type: 'string', minLength: 1, maxLength: 160 },
            accountId: { type: 'string', minLength: 1, maxLength: 160 },
            responsibility: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await input.service!.assignRequirement({
        actor: await input.resolveActor(request),
        requirementId: id,
        idempotencyKey: requiredMutationHeaders(request),
        requestId: request.id,
        ...(request.body as {
          teamId: string;
          accountId: string;
          responsibility: string;
        }),
      });
      if (result.replayed) reply.header('idempotent-replay', 'true');
      return result.value;
    },
  );
}
