import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  M2_R1_SKILL_KEY,
  M2_R1_SKILL_RELATIVE_PATH,
  M2_R1_SKILL_VERSION,
  loadM2R1SkillManifest,
} from '../../scripts/m2-r1-skill-manifest.ts';
import {
  AI_PRODUCT_WORK_SKILL_KEY,
  AI_PRODUCT_WORK_SKILL_RELATIVE_PATH,
  AI_PRODUCT_WORK_SKILL_VERSION,
  loadAiProductWorkSkillManifest,
  matchesAiProductWorkSkillRelease,
} from '../../scripts/ai-product-work-skill-manifest.ts';

describe('M2-R1 fixed Skill source', () => {
  it('derives the registered content hash from the real controlled source', async () => {
    const manifest = await loadM2R1SkillManifest(
      process.cwd(),
      'CODEx_TEST_M2_SKILL_OWNER',
    );
    const source = await readFile(
      path.resolve(process.cwd(), M2_R1_SKILL_RELATIVE_PATH),
      'utf8',
    );

    expect(manifest.skillKey).toBe(M2_R1_SKILL_KEY);
    expect(manifest.version).toBe(M2_R1_SKILL_VERSION);
    expect(manifest.contentHash).toBe(
      `sha256:${createHash('sha256').update(source).digest('hex')}`,
    );
    expect(source).toContain('name: pfc-readonly-artifact-check');
    expect(source).toContain('Do not create, edit, delete');
    expect(source).toContain('Do not infer missing business facts');
  });
});

describe('AI ProductWorkTurn fixed Skill source', () => {
  it('binds the evaluated local source to the exact capability and scope', async () => {
    const manifest = await loadAiProductWorkSkillManifest(
      process.cwd(),
      'CODEx_TEST_AI_PRODUCT_WORK_OWNER',
    );
    const source = await readFile(
      path.resolve(process.cwd(), AI_PRODUCT_WORK_SKILL_RELATIVE_PATH),
      'utf8',
    );

    expect(manifest.skillKey).toBe(AI_PRODUCT_WORK_SKILL_KEY);
    expect(manifest.version).toBe(AI_PRODUCT_WORK_SKILL_VERSION);
    expect(manifest.contentHash).toBe(
      `sha256:${createHash('sha256').update(source).digest('hex')}`,
    );
    expect(manifest.contentHash).toBe(
      'sha256:7ab40c7367bbe49a12c1c9fb69c1e51196981711e5fa378f40da6a4b50da8ef0',
    );
    expect(manifest.requiredCapabilities).toEqual(['PRODUCT_WORK_TURN']);
    expect(manifest.enabledScopes).toEqual(['PRODUCT_WORK_TURN']);
    expect(manifest.riskLevel).toBe('MEDIUM');
    expect(source).toContain('name: pfc-ai-product-work-session');
    expect(
      matchesAiProductWorkSkillRelease(
        {
          id: manifest.id,
          contentHash: manifest.contentHash,
          riskLevel: manifest.riskLevel,
          requiredCapabilities: manifest.requiredCapabilities,
          enabledScopes: manifest.enabledScopes,
        },
        manifest,
      ),
    ).toBe(true);
    expect(
      matchesAiProductWorkSkillRelease(
        {
          id: manifest.id,
          contentHash: manifest.contentHash,
          riskLevel: manifest.riskLevel,
          requiredCapabilities: [
            ...manifest.requiredCapabilities,
            'WRITE_WORKSPACE',
          ],
          enabledScopes: manifest.enabledScopes,
        },
        manifest,
      ),
    ).toBe(false);
  });
});
