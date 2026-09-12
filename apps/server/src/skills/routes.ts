import type { FastifyInstance } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { SkillApplicationService } from './application-service.ts';

export function registerSkillRoutes(
  server: FastifyInstance,
  input: { service?: SkillApplicationService; resolveActor: ActorResolver },
): void {
  if (!input.service) return;
  server.get('/api/v1/skills', async (request) =>
    input.service!.list(await input.resolveActor(request)),
  );
  server.get('/api/v1/skills/:skillKey/releases/:version', async (request) => {
    const { skillKey, version } = request.params as {
      skillKey: string;
      version: string;
    };
    return input.service!.get(
      await input.resolveActor(request),
      skillKey,
      version,
    );
  });
}
