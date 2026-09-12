import type {
  RegisterManualGateRunRequest,
  StartAutomaticGateRunRequest,
} from '@pfc/contracts';
import {
  GATE_CONFIRMATION_ROLES,
  GATE_RESULTS,
  LIFECYCLE_STAGES,
  MANUAL_GATE_RUN_RESULTS,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { GateRunApplicationService } from './application-service.ts';

const bindingProperties = {
  baselineId: { type: 'string', minLength: 1, maxLength: 160 },
  stage: { type: 'string', enum: [...LIFECYCLE_STAGES] },
} as const;

const requirementParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
} as const;

const gateRunParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'gateRunId'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 },
    gateRunId: { type: 'string', minLength: 1, maxLength: 160 },
  },
} as const;

function serviceOrThrow(
  service: GateRunApplicationService | undefined,
): GateRunApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'GateRun capability is not configured.',
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
      'If-Match must contain a Requirement row version.',
    );
  }
  return Number.parseInt(match[1], 10);
}

function mutationHeaders(
  request: FastifyRequest,
): Readonly<{ expectedRowVersion: number; idempotencyKey: string }> {
  return {
    expectedRowVersion: expectedVersion(request),
    idempotencyKey: requiredHeader(request, 'idempotency-key'),
  };
}

function sendMutation(
  reply: FastifyReply,
  requirementId: string,
  result: Awaited<
    ReturnType<GateRunApplicationService['startAutomaticGateRun']>
  >,
) {
  reply
    .code(result.replayed || result.reusedInProgress ? 200 : 201)
    .header(
      'location',
      `/api/v1/requirements/${requirementId}/gate-runs/${result.gateRun.id}`,
    )
    .header('etag', `"${result.requirement.rowVersion}"`);
  return result;
}

export function registerGateRunRoutes(
  server: FastifyInstance,
  input: {
    service?: GateRunApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.post(
    '/api/v1/requirements/:id/gate-runs/automatic',
    {
      schema: {
        params: requirementParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['baselineId', 'stage'],
          properties: bindingProperties,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const headers = mutationHeaders(request);
      const result = await serviceOrThrow(input.service).startAutomaticGateRun(
        await input.resolveActor(request),
        id,
        request.body as StartAutomaticGateRunRequest,
        headers.expectedRowVersion,
        headers.idempotencyKey,
      );
      return sendMutation(reply, id, result);
    },
  );

  server.post(
    '/api/v1/requirements/:id/gate-runs/manual',
    {
      schema: {
        params: requirementParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'baselineId',
            'stage',
            'result',
            'registrationNote',
            'confirmedRole',
            'evidenceRefIds',
            'checks',
          ],
          properties: {
            ...bindingProperties,
            result: { type: 'string', enum: [...MANUAL_GATE_RUN_RESULTS] },
            registrationNote: {
              type: 'string',
              minLength: 1,
              maxLength: 2_000,
            },
            confirmedRole: {
              type: 'string',
              enum: [...GATE_CONFIRMATION_ROLES],
            },
            evidenceRefIds: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 160 },
            },
            checks: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['checkKey', 'result'],
                properties: {
                  checkKey: { type: 'string', minLength: 1, maxLength: 160 },
                  result: { type: 'string', enum: [...GATE_RESULTS] },
                  reason: { type: ['string', 'null'], maxLength: 2_000 },
                  ownerId: { type: ['string', 'null'], maxLength: 160 },
                  closePoint: { type: ['string', 'null'], maxLength: 160 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const headers = mutationHeaders(request);
      const result = await serviceOrThrow(input.service).registerManualGateRun(
        await input.resolveActor(request),
        id,
        request.body as RegisterManualGateRunRequest,
        headers.expectedRowVersion,
        headers.idempotencyKey,
      );
      return sendMutation(reply, id, result);
    },
  );

  server.get(
    '/api/v1/requirements/:id/gate-runs/:gateRunId',
    { schema: { params: gateRunParamsSchema } },
    async (request, reply) => {
      const { id, gateRunId } = request.params as {
        id: string;
        gateRunId: string;
      };
      const result = await serviceOrThrow(input.service).getGateRun(
        await input.resolveActor(request),
        id,
        gateRunId,
      );
      reply.header('etag', `"${result.requirement.rowVersion}"`);
      return result;
    },
  );
}
