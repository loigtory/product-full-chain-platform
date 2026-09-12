import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SkillReleaseDto } from '@pfc/contracts';

import { CODEX_APP_SERVER_HARNESS } from '../packages/codex-adapter/src/protocol-version.ts';

export const AI_PRODUCT_WORK_SKILL_KEY = 'pfc-ai-product-work-session';
export const AI_PRODUCT_WORK_SKILL_VERSION = '2026.09.08-r1';
export const AI_PRODUCT_WORK_SKILL_RELEASE_ID =
  'skill-pfc-ai-product-work-session-20260908-r1';
export const AI_PRODUCT_WORK_SKILL_RELATIVE_PATH =
  'skills/pfc-ai-product-work-session/SKILL.md';

function sameValues(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

export async function loadAiProductWorkSkillManifest(
  projectRoot: string,
  owner: string,
) {
  const sourcePath = path.resolve(
    projectRoot,
    AI_PRODUCT_WORK_SKILL_RELATIVE_PATH,
  );
  const source = await readFile(sourcePath, 'utf8');
  return {
    id: AI_PRODUCT_WORK_SKILL_RELEASE_ID,
    skillKey: AI_PRODUCT_WORK_SKILL_KEY,
    displayName: 'AI 产品作业会话',
    description:
      '在已绑定的需求、材料基线与工作区上下文中执行受控产品作业回合。',
    logicalSource: `project-skill:${AI_PRODUCT_WORK_SKILL_RELATIVE_PATH}`,
    version: AI_PRODUCT_WORK_SKILL_VERSION,
    contentHash: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    compatibleHarnesses: [CODEX_APP_SERVER_HARNESS],
    requiredCapabilities: ['PRODUCT_WORK_TURN'],
    riskLevel: 'MEDIUM' as const,
    enabledScopes: ['PRODUCT_WORK_TURN'],
    owner,
    sourcePath,
  } as const;
}

export function matchesAiProductWorkSkillRelease(
  existing: Pick<
    SkillReleaseDto,
    | 'id'
    | 'contentHash'
    | 'riskLevel'
    | 'requiredCapabilities'
    | 'enabledScopes'
  >,
  manifest: Awaited<ReturnType<typeof loadAiProductWorkSkillManifest>>,
): boolean {
  return (
    existing.id === manifest.id &&
    existing.contentHash === manifest.contentHash &&
    existing.riskLevel === manifest.riskLevel &&
    sameValues(existing.requiredCapabilities, manifest.requiredCapabilities) &&
    sameValues(existing.enabledScopes, manifest.enabledScopes)
  );
}
