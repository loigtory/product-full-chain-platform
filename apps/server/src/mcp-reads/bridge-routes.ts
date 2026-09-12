import { DomainRuleViolation } from '@pfc/domain';
import { parseMcpReadEvent } from '@pfc/protocol';
import type { FastifyInstance } from 'fastify';

import { bridgeContext } from '../bridges/routes.ts';
import type { McpReadBridgeApplicationService } from './bridge-application-service.ts';

function bounded(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new DomainRuleViolation('VALIDATION_FAILED', `${name} is invalid.`);
  }
  return value;
}

export function registerMcpReadBridgeRoutes(
  server: FastifyInstance,
  service?: McpReadBridgeApplicationService,
): void {
  if (!service) return;
  server.get(
    '/bridge/v1/mcp-read-requests/commands/next',
    async (request, reply) => {
      const command = await service.nextCommand(bridgeContext(request));
      return command ?? reply.code(204).send();
    },
  );
  server.get(
    '/bridge/v1/mcp-read-requests/commands/:commandId/context',
    async (request) => {
      const { commandId } = request.params as { commandId: string };
      return service.context(
        bridgeContext(request),
        bounded(commandId, 'commandId'),
      );
    },
  );
  server.post(
    '/bridge/v1/mcp-read-requests/commands/:commandId/events',
    async (request) => {
      const { commandId } = request.params as { commandId: string };
      let event;
      try {
        const body = request.body as { event?: unknown } | null;
        event = parseMcpReadEvent(body?.event);
      } catch {
        throw new DomainRuleViolation(
          'VALIDATION_FAILED',
          'MCP read event is invalid.',
        );
      }
      return service.submitEvent(
        bridgeContext(request),
        bounded(commandId, 'commandId'),
        event,
      );
    },
  );
}
