import {
  EXECUTION_EVIDENCE_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
  type CreateMcpReadRequest,
  type ExecutionEvidenceSourceType,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { McpReadApplicationService } from './application-service.ts';

function serviceOrThrow(
  service?: McpReadApplicationService,
): McpReadApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'MCP read capability is not configured.',
    );
  }
  return service;
}

function requiredHeader(
  request: FastifyRequest,
  name: 'idempotency-key' | 'if-match',
) {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 240) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${name} header is required.`,
    );
  }
  return value;
}

function expectedVersion(request: FastifyRequest): number {
  const match = /^"?(\d+)"?$/.exec(requiredHeader(request, 'if-match'));
  if (!match)
    throw new DomainRuleViolation('VALIDATION_FAILED', 'If-Match is invalid.');
  return Number.parseInt(match[1], 10);
}

export function registerMcpReadRoutes(
  server: FastifyInstance,
  input: {
    service?: McpReadApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.get(
    '/api/v1/requirements/:requirementId/evidence',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceType: {
              type: 'string',
              enum: [...EXECUTION_EVIDENCE_SOURCE_TYPES],
            },
            cursor: { type: 'string', maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { requirementId } = request.params as { requirementId: string };
      const query = request.query as {
        sourceType?: ExecutionEvidenceSourceType;
        cursor?: string;
        limit?: number;
      };
      return serviceOrThrow(input.service).listEvidence({
        actor: await input.resolveActor(request),
        requirementId,
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit ?? 20,
      });
    },
  );

  server.get(
    '/api/v1/mcp-capabilities',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['requirementId'],
          properties: {
            requirementId: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
    },
    async (request) => {
      const { requirementId } = request.query as { requirementId: string };
      return serviceOrThrow(input.service).listCapabilities(
        await input.resolveActor(request),
        requirementId,
      );
    },
  );

  server.get(
    '/api/v1/work-sessions/:sessionId/mcp-read-requests',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['requirementId'],
          properties: {
            requirementId: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
      },
    },
    async (request) => {
      const { sessionId } = request.params as { sessionId: string };
      const { requirementId } = request.query as { requirementId: string };
      return serviceOrThrow(input.service).listRequests({
        actor: await input.resolveActor(request),
        sessionId,
        requirementId,
      });
    },
  );

  server.post(
    '/api/v1/work-sessions/:sessionId/mcp-read-requests',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schemaVersion',
            'turnId',
            'logicalCapabilityId',
            'artifactVersionId',
            'input',
            'sensitivity',
            'materialRefIds',
          ],
          properties: {
            schemaVersion: { const: 'create-mcp-read-request/1' },
            turnId: { type: 'string', minLength: 1, maxLength: 200 },
            logicalCapabilityId: {
              type: 'string',
              minLength: 1,
              maxLength: 160,
            },
            artifactVersionId: {
              type: 'string',
              minLength: 1,
              maxLength: 160,
            },
            input: { type: 'object', maxProperties: 100 },
            sensitivity: { type: 'string', enum: [...SENSITIVITY_LEVELS] },
            materialRefIds: {
              type: 'array',
              maxItems: 50,
              uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 160 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const result = await serviceOrThrow(input.service).createRequest({
        actor: await input.resolveActor(request),
        sessionId,
        request: request.body as CreateMcpReadRequest,
        expectedSessionVersion: expectedVersion(request),
        idempotencyKey: requiredHeader(request, 'idempotency-key'),
        requestId: request.id,
      });
      return reply
        .code(result.replayed ? 200 : 202)
        .header(
          'location',
          `/api/v1/work-sessions/${sessionId}/mcp-read-requests/${result.request.id}`,
        )
        .send(result.request);
    },
  );
}
