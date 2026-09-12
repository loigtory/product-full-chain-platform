import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Requirement initial-material module boundaries', () => {
  it('keeps invariants, hash orchestration, and SQL persistence separated', async () => {
    const [domain, application, persistence] = await Promise.all([
      readFile(
        path.join(root, 'packages', 'domain', 'src', 'initial-material-ref.ts'),
        'utf8',
      ),
      readFile(
        path.join(
          root,
          'apps',
          'server',
          'src',
          'requirements',
          'application-service.ts',
        ),
        'utf8',
      ),
      readFile(
        path.join(root, 'packages', 'persistence', 'src', 'repository.ts'),
        'utf8',
      ),
    ]);

    expect(domain).not.toContain('node:crypto');
    expect(domain).not.toContain('insertInto');
    expect(application).toContain('createInitialMaterialRef');
    expect(application).not.toContain("insertInto('material_refs')");
    expect(persistence).toContain("insertInto('material_refs')");
  });
});
