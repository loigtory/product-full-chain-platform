import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { BridgePairingApplicationService } from './application-service.ts';
import type { BridgeWorkspaceExchange } from './repository-port.ts';

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'idempotency-key is required.',
    );
  }
  return value;
}

export function registerBridgePairingRoutes(
  server: FastifyInstance,
  input: {
    service?: BridgePairingApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;
  server.get(
    '/api/v1/teams/:teamId/bridges',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId'],
          properties: {
            teamId: { type: 'string', minLength: 3, maxLength: 160 },
          },
        },
      },
    },
    async (request) => {
      const { teamId } = request.params as { teamId: string };
      return input.service!.list(await input.resolveActor(request), teamId);
    },
  );
  server.post(
    '/api/v1/teams/:teamId/bridge-pairings',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['teamId'],
          properties: {
            teamId: { type: 'string', minLength: 3, maxLength: 160 },
          },
        },
      },
    },
    async (request, reply) => {
      const { teamId } = request.params as { teamId: string };
      const result = await input.service!.create({
        actor: await input.resolveActor(request),
        teamId,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    },
  );
  server.post(
    '/bridge/v1/pairings/exchange',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'pairingCode',
            'bridgeVersion',
            'nodeVersion',
            'codexVersion',
            'zedVersion',
            'workspaces',
          ],
          properties: {
            pairingCode: { type: 'string', minLength: 20, maxLength: 400 },
            bridgeVersion: { type: 'string', minLength: 1, maxLength: 120 },
            nodeVersion: { type: 'string', minLength: 1, maxLength: 120 },
            codexVersion: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 120 },
                { type: 'null' },
              ],
            },
            zedVersion: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 120 },
                { type: 'null' },
              ],
            },
            workspaces: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'workspaceId',
                  'repositoryFingerprint',
                  'allowedRelativePath',
                ],
                properties: {
                  workspaceId: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 160,
                  },
                  repositoryFingerprint: {
                    type: 'string',
                    pattern: '^sha256:[A-Fa-f0-9]{64}$',
                  },
                  allowedRelativePath: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        pairingCode: string;
        bridgeVersion: string;
        nodeVersion: string;
        codexVersion: string | null;
        zedVersion: string | null;
        workspaces: readonly BridgeWorkspaceExchange[];
      };
      const result = await input.service!.exchange(body);
      return reply.code(201).send(result);
    },
  );
}
