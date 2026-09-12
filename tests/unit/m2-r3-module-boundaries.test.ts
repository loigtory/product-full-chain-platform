import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('M2 R3 module boundaries', () => {
  it('keeps artifact collaboration routes, application and persistence separate', async () => {
    const [routes, service, repository] = await Promise.all([
      readFile(
        path.join(root, 'apps/server/src/artifact-collaboration/routes.ts'),
        'utf8',
      ),
      readFile(
        path.join(
          root,
          'apps/server/src/artifact-collaboration/application-service.ts',
        ),
        'utf8',
      ),
      readFile(
        path.join(
          root,
          'packages/persistence/src/artifact-collaboration-repository.ts',
        ),
        'utf8',
      ),
    ]);

    expect(routes).not.toContain('PostgresArtifactCollaborationRepository');
    expect(service).not.toContain('FastifyInstance');
    expect(repository).not.toContain('FastifyInstance');
  });
});
