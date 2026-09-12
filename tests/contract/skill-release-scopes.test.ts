import { describe, expect, it } from 'vitest';

import {
  AGENT_RUN_OPERATIONS,
  SKILL_RELEASE_SCOPES,
} from '../../packages/contracts/src/index.ts';

describe('SkillRelease scopes contract', () => {
  it('adds ProductWorkTurn compatibility without broadening AgentRun operations', () => {
    expect(AGENT_RUN_OPERATIONS).toEqual([
      'ARTIFACT_CHECK',
      'CONTROLLED_ARTIFACT_EDIT',
    ]);
    expect(SKILL_RELEASE_SCOPES).toEqual([
      'ARTIFACT_CHECK',
      'CONTROLLED_ARTIFACT_EDIT',
      'PRODUCT_WORK_TURN',
    ]);
  });
});
