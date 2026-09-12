import type {
  ConfirmMaterialImpactRequest,
  CreateMaterialImpactAssessmentRequest,
} from '@pfc/contracts';
import {
  LIFECYCLE_STAGES,
  MATERIAL_IMPACT_CONFIRMATION_ROLES,
  MATERIAL_IMPACT_DECISIONS,
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { MaterialImpactApplicationService } from './application-service.ts';

function serviceOrThrow(
  service: MaterialImpactApplicationService | undefined,
): MaterialImpactApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'Material impact capability is not configured.',
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

export function registerMaterialImpactRoutes(
  server: FastifyInstance,
  input: {
    service?: MaterialImpactApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.post(
    '/api/v1/requirements/:id/material-impact-assessments',
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
          required: ['candidateBaseline', 'recommendedStage'],
          properties: {
            candidateBaseline: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceType', 'materialPurpose', 'sensitivity'],
              properties: {
                sourceType: {
                  type: 'string',
                  enum: [...MATERIAL_SOURCE_TYPES],
                },
                sourceDescription: {
                  type: ['string', 'null'],
                  maxLength: 2_000,
                },
                materialPurpose: {
                  type: 'string',
                  enum: [...MATERIAL_PURPOSES],
                },
                sensitivity: { type: 'string', enum: [...SENSITIVITY_LEVELS] },
              },
            },
            recommendedStage: { type: 'string', enum: [...LIFECYCLE_STAGES] },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await serviceOrThrow(input.service).createAssessment(
        await input.resolveActor(request),
        id,
        request.body as CreateMaterialImpactAssessmentRequest,
        requiredHeader(request, 'idempotency-key'),
      );
      reply
        .code(result.replayed ? 200 : 201)
        .header(
          'location',
          `/api/v1/requirements/${id}/material-impact-assessments/${result.assessment.id}`,
        );
      return result;
    },
  );

  server.post(
    '/api/v1/requirements/:id/material-impact-assessments/:impactId/confirmations',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'impactId'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 160 },
            impactId: { type: 'string', minLength: 1, maxLength: 160 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decision', 'reason', 'confirmedRole'],
          properties: {
            decision: { type: 'string', enum: [...MATERIAL_IMPACT_DECISIONS] },
            selectedStage: {
              type: ['string', 'null'],
              enum: [...LIFECYCLE_STAGES, null],
            },
            reason: { type: 'string', minLength: 1, maxLength: 4_000 },
            confirmedRole: {
              type: 'string',
              enum: [...MATERIAL_IMPACT_CONFIRMATION_ROLES],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, impactId } = request.params as {
        id: string;
        impactId: string;
      };
      const result = await serviceOrThrow(input.service).confirmAssessment(
        await input.resolveActor(request),
        id,
        impactId,
        request.body as ConfirmMaterialImpactRequest,
        expectedVersion(request),
        requiredHeader(request, 'idempotency-key'),
      );
      reply.code(result.replayed ? 200 : 201);
      return result;
    },
  );
}
