import type {
  ActorContext,
  CompleteG0RegistrationRequest,
  CreateRequirementRequest,
  RequirementListScope,
} from '@pfc/contracts';
import {
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { RequirementApplicationService } from './application-service.ts';

export type ActorResolver = (
  request: FastifyRequest,
) => Promise<ActorContext> | ActorContext;

const registrationProperties = {
  sourceType: {
    type: ['string', 'null'],
    enum: [...MATERIAL_SOURCE_TYPES, null],
  },
  sourceDescription: { type: ['string', 'null'], maxLength: 2_000 },
  businessOwnerId: { type: ['string', 'null'], maxLength: 160 },
  materialPurpose: {
    type: ['string', 'null'],
    enum: [...MATERIAL_PURPOSES, null],
  },
  sensitivity: {
    type: ['string', 'null'],
    enum: [...SENSITIVITY_LEVELS, null],
  },
} as const;

function serviceOrThrow(
  service: RequirementApplicationService | undefined,
): RequirementApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'Requirement capability is not configured.',
    );
  }
  return service;
}

function requiredHeader(
  request: FastifyRequest,
  name: 'idempotency-key' | 'if-match',
): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      `${name} header is required.`,
    );
  }
  return value;
}

function expectedVersion(request: FastifyRequest): number {
  const match = /^"?(\d+)"?$/.exec(requiredHeader(request, 'if-match'));
  if (!match) {
    throw new DomainRuleViolation(
      'VALIDATION_FAILED',
      'If-Match must contain a row version.',
    );
  }
  return Number.parseInt(match[1], 10);
}

export function registerRequirementRoutes(
  server: FastifyInstance,
  input: {
    service?: RequirementApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.get(
    '/api/v1/requirements',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: {
              type: 'string',
              enum: ['MINE', 'ALL', 'BLOCKED'],
              default: 'ALL',
            },
            search: { type: 'string', maxLength: 200, default: '' },
            cursor: { type: 'string', maxLength: 20 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        scope?: RequirementListScope;
        search?: string;
        cursor?: string;
        limit?: number;
      };
      return serviceOrThrow(input.service).listRequirements(
        await input.resolveActor(request),
        {
          scope: query.scope ?? 'ALL',
          search: query.search ?? '',
          cursor: query.cursor ?? null,
          limit: query.limit ?? 20,
        },
      );
    },
  );

  server.post(
    '/api/v1/requirements',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'originalIdea'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            originalIdea: { type: 'string', minLength: 1, maxLength: 10_000 },
            registration: {
              type: 'object',
              additionalProperties: false,
              properties: registrationProperties,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await serviceOrThrow(input.service).createRequirement(
        await input.resolveActor(request),
        request.body as CreateRequirementRequest,
        requiredHeader(request, 'idempotency-key'),
      );
      reply
        .code(result.replayed ? 200 : 201)
        .header('location', `/api/v1/requirements/${result.requirement.id}`)
        .header('etag', `"${result.requirement.rowVersion}"`);
      return result;
    },
  );

  server.get(
    '/api/v1/requirements/:id',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const detail = await serviceOrThrow(input.service).getRequirement(
        await input.resolveActor(request),
        id,
      );
      reply.header('etag', `"${detail.rowVersion}"`);
      return detail;
    },
  );

  server.patch(
    '/api/v1/requirements/:id/g0-registration',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: registrationProperties,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await serviceOrThrow(input.service).completeG0Registration(
        await input.resolveActor(request),
        id,
        request.body as CompleteG0RegistrationRequest,
        expectedVersion(request),
        requiredHeader(request, 'idempotency-key'),
      );
      reply.header('etag', `"${result.requirement.rowVersion}"`);
      return result;
    },
  );

  server.get(
    '/api/v1/requirement-submissions/:key',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['key'],
          properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request) => {
      const { key } = request.params as { key: string };
      return serviceOrThrow(input.service).getRequirementSubmission(
        await input.resolveActor(request),
        key,
      );
    },
  );
}
