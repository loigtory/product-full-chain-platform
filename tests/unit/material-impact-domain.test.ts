import { describe, expect, it } from 'vitest';

import {
  confirmMaterialImpact,
  createMaterialImpactAssessment,
  DomainRuleViolation,
} from '../../packages/domain/src/index.ts';
import { createT5Fixture } from '../../packages/test-data/src/index.ts';

function candidateInput(runId: string) {
  const fixture = createT5Fixture(runId);
  return {
    fixture,
    input: {
      assessmentId: `${fixture.prefix}_IMPACT_1`,
      candidateBaselineId: `${fixture.prefix}_BASELINE_2`,
      requirement: {
        ...fixture.requirementWrite.requirement,
        currentStage: 'G3' as const,
      },
      currentBaseline: fixture.requirementWrite.materialBaseline!,
      registration: {
        sourceType: 'USER_INTERVIEW' as const,
        sourceDescription: null,
        businessOwnerId: fixture.actors.businessOwner.actorId,
        materialPurpose: 'FACT' as const,
        sensitivity: 'INTERNAL' as const,
      },
      recommendedStage: 'G1' as const,
      actorId: fixture.actors.productManager.actorId,
      now: fixture.now,
    },
  };
}

describe('T6 material impact domain', () => {
  it('creates a pending candidate without changing the authoritative requirement', () => {
    const { input } = candidateInput('T6_DOMAIN_PENDING');
    const result = createMaterialImpactAssessment(input);

    expect(result.requirement).toBe(input.requirement);
    expect(result.candidateBaseline).toMatchObject({
      versionNumber: 2,
      status: 'CANDIDATE',
    });
    expect(result.assessment).toMatchObject({
      status: 'PENDING',
      originalBaselineId: input.currentBaseline.id,
      candidateBaselineId: result.candidateBaseline.id,
      decision: null,
    });
  });

  it('switches atomically to the selected stage and identifies downstream runs to invalidate', () => {
    const { fixture, input } = candidateInput('T6_DOMAIN_IMPACTS');
    const pending = createMaterialImpactAssessment(input);
    const result = confirmMaterialImpact({
      requirement: input.requirement,
      currentBaseline: input.currentBaseline,
      candidateBaseline: pending.candidateBaseline,
      assessment: pending.assessment,
      decision: 'IMPACTS',
      selectedStage: 'G1',
      reason: '新增访谈改变了 G1 之后的范围判断。',
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: fixture.actors.businessOwner.actorId,
      actorRoles: fixture.actors.businessOwner.roles,
      expectedRowVersion: input.requirement.rowVersion,
      gateRuns: [
        { id: 'G0_RUN', stage: 'G0' },
        { id: 'G1_RUN', stage: 'G1' },
        { id: 'G3_RUN', stage: 'G3' },
      ],
      now: fixture.now,
    });

    expect(result.requirement).toMatchObject({
      currentBaselineId: pending.candidateBaseline.id,
      currentStage: 'G1',
      rowVersion: input.requirement.rowVersion + 1,
    });
    expect(result.previousBaseline.status).toBe('HISTORICAL');
    expect(result.currentBaseline.status).toBe('CURRENT');
    expect(result.invalidatedGateRunIds).toEqual(['G1_RUN', 'G3_RUN']);
  });

  it('switches a confirmed no-impact baseline without moving the stage or invalidating conclusions', () => {
    const { fixture, input } = candidateInput('T6_DOMAIN_NO_IMPACT');
    const pending = createMaterialImpactAssessment(input);
    const result = confirmMaterialImpact({
      requirement: input.requirement,
      currentBaseline: input.currentBaseline,
      candidateBaseline: pending.candidateBaseline,
      assessment: pending.assessment,
      decision: 'NO_IMPACT',
      selectedStage: null,
      reason: '新材料仅补充已有事实，不改变现有结论。',
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: fixture.actors.businessOwner.actorId,
      actorRoles: fixture.actors.businessOwner.roles,
      expectedRowVersion: input.requirement.rowVersion,
      gateRuns: [{ id: 'G3_RUN', stage: 'G3' }],
      now: fixture.now,
    });

    expect(result.requirement.currentStage).toBe('G3');
    expect(result.invalidatedGateRunIds).toEqual([]);
    expect(result.assessment).toMatchObject({
      decision: 'NO_IMPACT',
      selectedStage: null,
      status: 'CONFIRMED',
    });
  });

  it('rejects role mismatch, stale versions, and a future affected stage', () => {
    const { fixture, input } = candidateInput('T6_DOMAIN_INVALID');
    const pending = createMaterialImpactAssessment(input);
    const base = {
      requirement: input.requirement,
      currentBaseline: input.currentBaseline,
      candidateBaseline: pending.candidateBaseline,
      assessment: pending.assessment,
      decision: 'IMPACTS' as const,
      selectedStage: 'G1' as const,
      reason: '范围发生变化。',
      confirmedRole: 'BUSINESS_OWNER' as const,
      confirmedBy: fixture.actors.businessOwner.actorId,
      actorRoles: fixture.actors.businessOwner.roles,
      expectedRowVersion: input.requirement.rowVersion,
      gateRuns: [],
      now: fixture.now,
    };

    expect(() =>
      confirmMaterialImpact({
        ...base,
        confirmedRole: 'PRODUCT_OWNER',
      }),
    ).toThrow(DomainRuleViolation);
    expect(() =>
      confirmMaterialImpact({
        ...base,
        expectedRowVersion: input.requirement.rowVersion + 1,
      }),
    ).toThrow(DomainRuleViolation);
    expect(() =>
      confirmMaterialImpact({ ...base, selectedStage: 'G4' }),
    ).toThrow(DomainRuleViolation);
  });
});
