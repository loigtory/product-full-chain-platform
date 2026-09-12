import { DomainRuleViolation } from '@pfc/domain';
import { parseProductWorkTurnEvent } from '@pfc/protocol';
import type { FastifyInstance } from 'fastify';

import { bridgeContext } from '../bridges/routes.ts';
import type { ProductWorkTurnBridgeApplicationService } from './bridge-application-service.ts';

function boundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${field} is invalid.`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function registerProductWorkTurnBridgeRoutes(
  server: FastifyInstance,
  service?: ProductWorkTurnBridgeApplicationService,
): void {
  if (!service) return;
  server.get(
    '/bridge/v1/product-work-turns/commands/next',
    async (request, reply) => {
      const command = await service.nextCommand(bridgeContext(request));
      return command ? command : reply.code(204).send();
    },
  );
  server.get(
    '/bridge/v1/product-work-turns/commands/:commandId/context',
    async (request) => {
      const { commandId } = request.params as { commandId: string };
      return service.context(
        bridgeContext(request),
        boundedString(commandId, 'commandId'),
      );
    },
  );
  server.post(
    '/bridge/v1/product-work-turns/:turnId/events',
    async (request) => {
      const { turnId } = request.params as { turnId: string };
      if (!record(request.body)) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Product work turn event body is invalid.',
        );
      }
      let event;
      try {
        event = parseProductWorkTurnEvent(request.body.event);
      } catch {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Product work turn event is invalid.',
        );
      }
      return service.submitEvent(bridgeContext(request), {
        commandId: boundedString(request.body.commandId, 'commandId'),
        sessionId: boundedString(request.body.sessionId, 'sessionId'),
        turnId: boundedString(turnId, 'turnId'),
        event,
      });
    },
  );
  server.post(
    '/bridge/v1/product-work-turns/commands/:commandId/acknowledgements',
    async (request, reply) => {
      const { commandId } = request.params as { commandId: string };
      if (!record(request.body)) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Product work turn acknowledgement is invalid.',
        );
      }
      const allowed = [
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
        'UNKNOWN',
        'REJECTED',
      ] as const;
      const status = boundedString(request.body.status, 'status');
      if (!allowed.includes(status as (typeof allowed)[number])) {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'Product work turn acknowledgement status is invalid.',
        );
      }
      const result = await service.acknowledge(bridgeContext(request), {
        commandId: boundedString(commandId, 'commandId'),
        sessionId: boundedString(request.body.sessionId, 'sessionId'),
        turnId: boundedString(request.body.turnId, 'turnId'),
        status: status as (typeof allowed)[number],
        ...(request.body.reasonCode === undefined
          ? {}
          : {
              reasonCode: boundedString(request.body.reasonCode, 'reasonCode'),
            }),
        ...(request.body.threadId === undefined
          ? {}
          : { threadId: boundedString(request.body.threadId, 'threadId') }),
        ...(request.body.externalTurnId === undefined
          ? {}
          : {
              externalTurnId: boundedString(
                request.body.externalTurnId,
                'externalTurnId',
              ),
            }),
      });
      return reply.code(202).send({ status: result });
    },
  );
}
