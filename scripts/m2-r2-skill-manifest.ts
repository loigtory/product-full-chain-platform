import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CODEX_APP_SERVER_HARNESS } from '../packages/codex-adapter/src/protocol-version.ts';

export const M2_R2_SKILL_KEY = 'pfc-controlled-artifact-edit';
export const M2_R2_SKILL_VERSION = '2026.09.07-r2';
export const M2_R2_SKILL_RELEASE_ID =
  'skill-pfc-controlled-artifact-edit-20260907-r2';
export const M2_R2_SKILL_RELATIVE_PATH =
  'skills/pfc-controlled-artifact-edit/SKILL.md';

export async function loadM2R2SkillManifest(
  projectRoot: string,
  owner: string,
) {
  const sourcePath = path.resolve(projectRoot, M2_R2_SKILL_RELATIVE_PATH);
  const source = await readFile(sourcePath, 'utf8');
  return {
    id: M2_R2_SKILL_RELEASE_ID,
    skillKey: M2_R2_SKILL_KEY,
    displayName: '受控产物修订',
    description: '在隔离运行胶囊内为绑定产物增加可审计修订记录。',
    logicalSource: `project-skill:${M2_R2_SKILL_RELATIVE_PATH}`,
    version: M2_R2_SKILL_VERSION,
    contentHash: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    compatibleHarnesses: [CODEX_APP_SERVER_HARNESS],
    requiredCapabilities: ['READ_WORKSPACE', 'WRITE_WORKSPACE'],
    riskLevel: 'MEDIUM' as const,
    enabledScopes: ['CONTROLLED_ARTIFACT_EDIT'],
    owner,
    sourcePath,
  } as const;
}
