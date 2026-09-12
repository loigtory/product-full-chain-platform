import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('M2 module boundaries', () => {
  it('keeps the server entrypoint separate from application composition', async () => {
    const serverRoot = path.join(root, 'apps', 'server', 'src');
    const [main, composition] = await Promise.all([
      readFile(path.join(serverRoot, 'main.ts'), 'utf8'),
      readFile(
        path.join(serverRoot, 'composition', 'create-application.ts'),
        'utf8',
      ),
    ]);

    expect(main).toContain("from './composition/create-application.js'");
    expect(main).not.toContain('PostgresAgentRunRepository');
    expect(main.split('\n').length).toBeLessThan(80);
    expect(composition).toContain('PostgresBridgeRuntimeRepository');
    expect(composition).toContain('BridgeApplicationService');
    expect(composition).toContain('PFC_M2_R1_ENABLED');
  });

  it('keeps Bridge transport, application, persistence and worker concerns separate', async () => {
    const files = await Promise.all([
      readFile(
        path.join(root, 'apps', 'server', 'src', 'bridges', 'routes.ts'),
        'utf8',
      ),
      readFile(
        path.join(
          root,
          'apps',
          'server',
          'src',
          'bridges',
          'application-service.ts',
        ),
        'utf8',
      ),
      readFile(path.join(root, 'apps', 'bridge', 'src', 'worker.ts'), 'utf8'),
    ]);
    const [routes, service, worker] = files;

    expect(routes).not.toContain('PostgresBridgeRuntimeRepository');
    expect(service).not.toContain('FastifyInstance');
    expect(worker).not.toContain('FastifyInstance');
    expect(worker).not.toContain('child_process');
  });
});
