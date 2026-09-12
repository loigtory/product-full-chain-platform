import {
  ARTIFACT_SOURCE_TYPES,
  LIFECYCLE_STAGES,
  SENSITIVITY_LEVELS,
  type AppendArtifactVersionRequest,
  type RegisterArtifactRequest,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { ArtifactApplicationService } from './application-service.ts';

function requiredHeader(
  request: FastifyRequest,
  name: 'idempotency-key' | 'if-match',
) {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${name} is required.`);
  }
  return value;
}

const versionProperties = {
  versionLabel: { type: 'string', minLength: 1, maxLength: 120 },
  sourceType: { type: 'string', enum: ARTIFACT_SOURCE_TYPES },
  sourceRef: { type: 'string', minLength: 1, maxLength: 2_000 },
  contentHash: { type: 'string', pattern: '^sha256:[A-Fa-f0-9]{32,64}$' },
  mediaType: {
    type: 'string',
    enum: ['text/plain', 'text/markdown', 'application/json'],
  },
  content: { type: 'string', maxLength: 524_288 },
  sensitivity: { type: 'string', enum: SENSITIVITY_LEVELS },
} as const;

const versionBodyAlternatives = [
  { required: ['contentHash'] },
  { required: ['mediaType', 'content'] },
] as const;

export function registerArtifactRoutes(
  server: FastifyInstance,
  input: { service?: ArtifactApplicationService; resolveActor: ActorResolver },
): void {
  if (!input.service) return;
  server.get('/api/v1/requirements/:id/artifacts', async (request) => {
    const { id } = request.params as { id: string };
    return input.service!.list(await input.resolveActor(request), id);
  });
  server.post(
    '/api/v1/requirements/:id/artifacts',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'capId',
            'stage',
            'artifactType',
            'title',
            'versionLabel',
            'sourceType',
            'sourceRef',
            'sensitivity',
          ],
          anyOf: versionBodyAlternatives,
          properties: {
            capId: { type: 'string', minLength: 1, maxLength: 160 },
            stage: { type: 'string', enum: LIFECYCLE_STAGES },
            artifactType: { type: 'string', minLength: 1, maxLength: 120 },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            ...versionProperties,
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await input.service!.create({
        actor: await input.resolveActor(request),
        requirementId: id,
        request: request.body as RegisterArtifactRequest,
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply
        .code(result.replayed ? 200 : 201)
        .header('etag', `"${result.artifact.rowVersion}"`);
      return result;
    },
  );
  server.post(
    '/api/v1/artifacts/:id/versions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['versionLabel', 'sourceType', 'sourceRef', 'sensitivity'],
          anyOf: versionBodyAlternatives,
          properties: versionProperties,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const match = /^"?(\d+)"?$/.exec(requiredHeader(request, 'if-match'));
      if (!match)
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'If-Match is invalid.',
        );
      const result = await input.service!.appendVersion({
        actor: await input.resolveActor(request),
        artifactId: id,
        request: request.body as AppendArtifactVersionRequest,
        expectedRowVersion: Number.parseInt(match[1]!, 10),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply.header('etag', `"${result.artifact.rowVersion}"`);
      return result;
    },
  );
}
