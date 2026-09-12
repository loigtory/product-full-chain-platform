import {
  WORKSPACE_ACCESS_LEVELS,
  type WorkspaceAccessLevel,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { WorkspaceApplicationService } from './application-service.ts';

function requireIdempotency(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !key.trim() || key.length > 200) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'Idempotency-Key is required.',
    );
  }
  return key;
}

export function registerWorkspaceRoutes(
  server: FastifyInstance,
  input: { service?: WorkspaceApplicationService; resolveActor: ActorResolver },
): void {
  if (!input.service) return;
  server.get('/api/v1/workspaces', async (request) =>
    input.service!.list(await input.resolveActor(request)),
  );
  server.post(
    '/api/v1/workspaces',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'teamId',
            'name',
            'repositoryLabel',
            'repositoryFingerprint',
          ],
          properties: {
            teamId: { type: 'string', minLength: 1, maxLength: 160 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            repositoryLabel: { type: 'string', minLength: 1, maxLength: 200 },
            repositoryFingerprint: {
              type: 'string',
              minLength: 71,
              maxLength: 71,
              pattern: '^sha256:[0-9a-f]{64}$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await input.service!.create({
        actor: await input.resolveActor(request),
        idempotencyKey: requireIdempotency(request),
        requestId: request.id,
        ...(request.body as {
          teamId: string;
          name: string;
          repositoryLabel: string;
          repositoryFingerprint: string;
        }),
      });
      reply
        .code(result.replayed ? 200 : 201)
        .header('etag', `"${result.value.rowVersion}"`);
      if (result.replayed) reply.header('idempotent-replay', 'true');
      return result.value;
    },
  );
  server.put(
    '/api/v1/requirements/:id/workspaces/:workspaceId',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId', 'allowedRelativePath', 'accessLevel'],
          properties: {
            teamId: { type: 'string', minLength: 1, maxLength: 160 },
            allowedRelativePath: {
              type: 'string',
              minLength: 1,
              maxLength: 2_000,
            },
            accessLevel: { type: 'string', enum: WORKSPACE_ACCESS_LEVELS },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, workspaceId } = request.params as {
        id: string;
        workspaceId: string;
      };
      const body = request.body as {
        teamId: string;
        allowedRelativePath: string;
        accessLevel: WorkspaceAccessLevel;
      };
      if (!WORKSPACE_ACCESS_LEVELS.includes(body.accessLevel)) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Access level is invalid.',
        );
      }
      const result = await input.service!.bind({
        actor: await input.resolveActor(request),
        requirementId: id,
        workspaceId,
        idempotencyKey: requireIdempotency(request),
        requestId: request.id,
        ...body,
      });
      if (result.replayed) reply.header('idempotent-replay', 'true');
      return result.value;
    },
  );
}
