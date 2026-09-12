import { describe, expect, it } from 'vitest';

import { deriveProductWorkReadiness } from '../../packages/domain/src/index.ts';

const id = (suffix: string) => `CODEx_TEST_AIUX_READINESS_${suffix}`;

describe('AI-UX-R1 product-work readiness policy', () => {
  it('selects current contexts and the only compatible skill for a first turn', () => {
    expect(
      deriveProductWorkReadiness({
        baselineId: id('BASELINE'),
        contextIds: [id('MATERIAL_2'), id('MATERIAL_1')],
        compatibleSkillReleaseIds: [id('SKILL_1')],
        previousContextIds: [],
        previousSkillReleaseId: null,
        baselineUnchanged: true,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'READY',
      }),
    ).toEqual({
      recommendedContextIds: [id('MATERIAL_1'), id('MATERIAL_2')],
      recommendedSkillReleaseId: id('SKILL_1'),
      blockers: [],
    });
  });

  it('requires an explicit skill choice when multiple compatible skills exist', () => {
    expect(
      deriveProductWorkReadiness({
        baselineId: id('BASELINE'),
        contextIds: [id('MATERIAL_1')],
        compatibleSkillReleaseIds: [id('SKILL_2'), id('SKILL_1')],
        previousContextIds: [],
        previousSkillReleaseId: null,
        baselineUnchanged: true,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'READY',
      }),
    ).toMatchObject({
      recommendedSkillReleaseId: null,
      blockers: ['SKILL_SELECTION_REQUIRED'],
    });
  });

  it('reports the missing baseline as the actionable blocker before transmission', () => {
    expect(
      deriveProductWorkReadiness({
        baselineId: null,
        contextIds: [],
        compatibleSkillReleaseIds: [id('SKILL_1')],
        previousContextIds: [],
        previousSkillReleaseId: null,
        baselineUnchanged: false,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'UNKNOWN',
      }).blockers,
    ).toEqual(['NO_CURRENT_BASELINE']);
  });

  it('does not silently truncate more than 50 contexts', () => {
    const contextIds = Array.from({ length: 51 }, (_, index) =>
      id(`MATERIAL_${index + 1}`),
    );

    expect(
      deriveProductWorkReadiness({
        baselineId: id('BASELINE'),
        contextIds,
        compatibleSkillReleaseIds: [id('SKILL_1')],
        previousContextIds: [],
        previousSkillReleaseId: null,
        baselineUnchanged: true,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'UNKNOWN',
      }),
    ).toMatchObject({
      recommendedContextIds: [],
      blockers: expect.arrayContaining([
        'CONTEXT_SELECTION_REQUIRED',
        'TRANSMISSION_STATUS_UNKNOWN',
      ]),
    });
  });

  it('reuses only still-valid previous selections on an unchanged baseline', () => {
    expect(
      deriveProductWorkReadiness({
        baselineId: id('BASELINE'),
        contextIds: [id('MATERIAL_1'), id('MATERIAL_2')],
        compatibleSkillReleaseIds: [id('SKILL_1'), id('SKILL_2')],
        previousContextIds: [id('MATERIAL_2'), id('MATERIAL_REMOVED')],
        previousSkillReleaseId: id('SKILL_2'),
        baselineUnchanged: true,
        bridgeStatus: 'AVAILABLE',
        transmissionStatus: 'READY',
      }),
    ).toEqual({
      recommendedContextIds: [id('MATERIAL_2')],
      recommendedSkillReleaseId: id('SKILL_2'),
      blockers: [],
    });
  });
});
