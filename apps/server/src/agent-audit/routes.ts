import type { FastifyInstance } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { AgentAuditApplicationService } from './application-service.ts';

export function registerAgentAuditRoutes(
  server: FastifyInstance,
  input: {
    service?: AgentAuditApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  if (!input.service) return;
  server.get('/api/v1/agent-runs/:runId/audit', async (request) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as { limit?: number | string };
    return input.service!.list(
      await input.resolveActor(request),
      runId,
      Number(query.limit ?? 50),
    );
  });
}
