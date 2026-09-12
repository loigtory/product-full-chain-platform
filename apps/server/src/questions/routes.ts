import type {
  AnswerQuestionRequest,
  ConfirmQuestionRequest,
  DeferQuestionRequest,
  ReturnQuestionRequest,
  SupersedeQuestionRequest,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { QuestionApplicationService } from './application-service.ts';

const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'questionId'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 },
    questionId: { type: 'string', minLength: 1, maxLength: 160 },
  },
} as const;

const answerProperties = {
  rawAnswer: { type: 'string', minLength: 1, maxLength: 10_000 },
  explanation: { type: ['string', 'null'], maxLength: 2_000 },
} as const;

const confirmationRole = {
  type: 'string',
  enum: ['PRODUCT_OWNER', 'BUSINESS_OWNER'],
} as const;

function serviceOrThrow(
  service: QuestionApplicationService | undefined,
): QuestionApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'Question capability is not configured.',
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
      'If-Match must contain a Question row version.',
    );
  }
  return Number.parseInt(match[1], 10);
}

function params(request: FastifyRequest): {
  id: string;
  questionId: string;
} {
  return request.params as { id: string; questionId: string };
}

function headers(request: FastifyRequest): {
  expectedRowVersion: number;
  idempotencyKey: string;
} {
  return {
    expectedRowVersion: expectedVersion(request),
    idempotencyKey: requiredHeader(request, 'idempotency-key'),
  };
}

export function registerQuestionRoutes(
  server: FastifyInstance,
  input: {
    service?: QuestionApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.post(
    '/api/v1/requirements/:id/questions/:questionId/answers',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['rawAnswer'],
          properties: answerProperties,
        },
      },
    },
    async (request, reply) => {
      const { id, questionId } = params(request);
      const { expectedRowVersion, idempotencyKey } = headers(request);
      const result = await serviceOrThrow(input.service).answerQuestion(
        await input.resolveActor(request),
        id,
        questionId,
        request.body as AnswerQuestionRequest,
        expectedRowVersion,
        idempotencyKey,
      );
      reply.header('etag', `"${result.question.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/requirements/:id/questions/:questionId/confirmations',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['decisionId', 'confirmedRole'],
          properties: {
            decisionId: { type: 'string', minLength: 1, maxLength: 160 },
            confirmedRole: confirmationRole,
          },
        },
      },
    },
    async (request, reply) => {
      const { id, questionId } = params(request);
      const { expectedRowVersion, idempotencyKey } = headers(request);
      const result = await serviceOrThrow(input.service).confirmQuestion(
        await input.resolveActor(request),
        id,
        questionId,
        request.body as ConfirmQuestionRequest,
        expectedRowVersion,
        idempotencyKey,
      );
      reply.header('etag', `"${result.question.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/requirements/:id/questions/:questionId/returns',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 2_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id, questionId } = params(request);
      const { expectedRowVersion, idempotencyKey } = headers(request);
      const result = await serviceOrThrow(input.service).returnQuestion(
        await input.resolveActor(request),
        id,
        questionId,
        request.body as ReturnQuestionRequest,
        expectedRowVersion,
        idempotencyKey,
      );
      reply.header('etag', `"${result.question.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/requirements/:id/questions/:questionId/supersessions',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['rawAnswer', 'confirmedRole'],
          properties: {
            ...answerProperties,
            confirmedRole: confirmationRole,
          },
        },
      },
    },
    async (request, reply) => {
      const { id, questionId } = params(request);
      const { expectedRowVersion, idempotencyKey } = headers(request);
      const result = await serviceOrThrow(input.service).supersedeQuestion(
        await input.resolveActor(request),
        id,
        questionId,
        request.body as SupersedeQuestionRequest,
        expectedRowVersion,
        idempotencyKey,
      );
      reply.header('etag', `"${result.question.rowVersion}"`);
      return result;
    },
  );

  server.post(
    '/api/v1/requirements/:id/questions/:questionId/deferrals',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason', 'reopenCondition', 'confirmedRole'],
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 10_000 },
            reopenCondition: {
              type: 'string',
              minLength: 1,
              maxLength: 2_000,
            },
            confirmedRole: confirmationRole,
          },
        },
      },
    },
    async (request, reply) => {
      const { id, questionId } = params(request);
      const { expectedRowVersion, idempotencyKey } = headers(request);
      const result = await serviceOrThrow(input.service).deferQuestion(
        await input.resolveActor(request),
        id,
        questionId,
        request.body as DeferQuestionRequest,
        expectedRowVersion,
        idempotencyKey,
      );
      reply.header('etag', `"${result.question.rowVersion}"`);
      return result;
    },
  );
}
