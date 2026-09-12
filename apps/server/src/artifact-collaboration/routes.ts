import {
  ARTIFACT_REVIEW_CONCLUSIONS,
  ARTIFACT_REVIEW_RESPONSIBILITIES,
  TRACE_RELATION_TYPES,
  TRACE_SUBJECT_TYPES,
  type CreateArtifactReviewRequest,
  type CreateTraceLinkRequest,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { ArtifactCollaborationApplicationService } from './application-service.ts';

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

function expectedRowVersion(request: FastifyRequest): number {
  const match = /^"?(\d+)"?$/.exec(requiredHeader(request, 'if-match'));
  if (!match)
    throw new DomainRuleViolation('VALIDATION_FAILED', 'If-Match is invalid.');
  return Number.parseInt(match[1]!, 10);
}

export function registerArtifactCollaborationRoutes(
  server: FastifyInstance,
  input: {
    service?: ArtifactCollaborationApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;

  server.get('/api/v1/artifacts/:artifactId', async (request) => {
    const { artifactId } = request.params as { artifactId: string };
    return input.service!.getArtifact(
      await input.resolveActor(request),
      artifactId,
    );
  });

  server.get(
    '/api/v1/artifacts/:artifactId/versions/:versionId/content',
    async (request) => {
      const { artifactId, versionId } = request.params as {
        artifactId: string;
        versionId: string;
      };
      return input.service!.getContent({
        actor: await input.resolveActor(request),
        artifactId,
        versionId,
      });
    },
  );

  server.get(
    '/api/v1/artifacts/:artifactId/diff',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['fromVersionId', 'toVersionId'],
          properties: {
            fromVersionId: { type: 'string', minLength: 1, maxLength: 160 },
            toVersionId: { type: 'string', minLength: 1, maxLength: 160 },
            whitespace: { type: 'string', enum: ['include', 'ignore'] },
          },
        },
      },
    },
    async (request) => {
      const { artifactId } = request.params as { artifactId: string };
      const query = request.query as {
        fromVersionId: string;
        toVersionId: string;
        whitespace?: 'include' | 'ignore';
      };
      return input.service!.diff({
        actor: await input.resolveActor(request),
        artifactId,
        fromVersionId: query.fromVersionId,
        toVersionId: query.toVersionId,
        ignoreWhitespace: query.whitespace === 'ignore',
      });
    },
  );

  server.get(
    '/api/v1/artifact-versions/:versionId/reviews',
    async (request) => {
      const { versionId } = request.params as { versionId: string };
      return input.service!.listReviews(
        await input.resolveActor(request),
        versionId,
      );
    },
  );

  server.post(
    '/api/v1/artifact-versions/:versionId/reviews',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['conclusion', 'responsibility'],
          properties: {
            conclusion: { type: 'string', enum: ARTIFACT_REVIEW_CONCLUSIONS },
            responsibility: {
              type: 'string',
              enum: ARTIFACT_REVIEW_RESPONSIBILITIES,
            },
            comment: { type: 'string', maxLength: 8_000 },
            supersedesReviewId: {
              type: 'string',
              minLength: 1,
              maxLength: 160,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const result = await input.service!.review({
        actor: await input.resolveActor(request),
        versionId,
        request: request.body as CreateArtifactReviewRequest,
        expectedArtifactRowVersion: expectedRowVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  server.get(
    '/api/v1/requirements/:requirementId/traces',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          anyOf: [
            { required: ['subjectId'] },
            { required: ['subjectType', 'nativeId'] },
          ],
          properties: {
            subjectId: { type: 'string', minLength: 1, maxLength: 160 },
            subjectType: { type: 'string', enum: TRACE_SUBJECT_TYPES },
            nativeId: { type: 'string', minLength: 1, maxLength: 160 },
            direction: {
              type: 'string',
              enum: ['INCOMING', 'OUTGOING', 'BOTH'],
            },
          },
        },
      },
    },
    async (request) => {
      const { requirementId } = request.params as { requirementId: string };
      const query = request.query as {
        subjectId?: string;
        subjectType?: (typeof TRACE_SUBJECT_TYPES)[number];
        nativeId?: string;
        direction?: 'INCOMING' | 'OUTGOING' | 'BOTH';
      };
      return input.service!.traceGraph({
        actor: await input.resolveActor(request),
        requirementId,
        subjectId: query.subjectId,
        subjectType: query.subjectType,
        nativeId: query.nativeId,
        direction: query.direction ?? 'BOTH',
      });
    },
  );

  server.post(
    '/api/v1/requirements/:requirementId/trace-links',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceSubjectId', 'targetSubjectId', 'relationType'],
          properties: {
            sourceSubjectId: { type: 'string', minLength: 1, maxLength: 160 },
            targetSubjectId: { type: 'string', minLength: 1, maxLength: 160 },
            relationType: { type: 'string', enum: TRACE_RELATION_TYPES },
          },
        },
      },
    },
    async (request, reply) => {
      const { requirementId } = request.params as { requirementId: string };
      const result = await input.service!.createTraceLink({
        actor: await input.resolveActor(request),
        requirementId,
        request: request.body as CreateTraceLinkRequest,
        expectedRequirementRowVersion: expectedRowVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );

  server.post(
    '/api/v1/trace-links/:traceLinkId/invalidations',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
    },
    async (request) => {
      const { traceLinkId } = request.params as { traceLinkId: string };
      const body = request.body as { reason: string };
      return input.service!.invalidateTraceLink({
        actor: await input.resolveActor(request),
        linkId: traceLinkId,
        reason: body.reason,
        expectedRequirementRowVersion: expectedRowVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
    },
  );
}
