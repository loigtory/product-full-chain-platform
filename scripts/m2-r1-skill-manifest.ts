import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CODEX_APP_SERVER_HARNESS } from '../packages/codex-adapter/src/protocol-version.ts';

export const M2_R1_SKILL_KEY = 'pfc-readonly-artifact-check';
export const M2_R1_SKILL_VERSION = '2026.09.06-r1';
export const M2_R1_SKILL_RELEASE_ID =
  'skill-pfc-readonly-artifact-check-20260906-r1';
export const M2_R1_SKILL_RELATIVE_PATH =
  'skills/pfc-readonly-artifact-check/SKILL.md';

export async function loadM2R1SkillManifest(
  projectRoot: string,
  owner: string,
) {
  const sourcePath = path.resolve(projectRoot, M2_R1_SKILL_RELATIVE_PATH);
  const source = await readFile(sourcePath, 'utf8');
  return {
    id: M2_R1_SKILL_RELEASE_ID,
    skillKey: M2_R1_SKILL_KEY,
    displayName: '只读产物检查',
    description: '核对当前需求产物结构、固定基线与证据链。',
    logicalSource: `project-skill:${M2_R1_SKILL_RELATIVE_PATH}`,
    version: M2_R1_SKILL_VERSION,
    contentHash: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    compatibleHarnesses: [CODEX_APP_SERVER_HARNESS],
    owner,
    sourcePath,
  } as const;
}
