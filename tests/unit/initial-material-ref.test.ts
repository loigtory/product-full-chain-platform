import { describe, expect, it } from 'vitest';

import {
  createInitialMaterialRef,
  createRequirementDraft,
  DomainRuleViolation,
} from '../../packages/domain/src/index.ts';

const now = '2026-09-08T08:00:00.000Z';

describe('initial Requirement material reference', () => {
  it('binds the exact original idea to the current baseline', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_INITIAL_REF_REQ',
      name: 'Initial material reference',
      originalIdea: '  Preserve this exact UTF-8 idea.  ',
      initiatorId: 'CODEx_TEST_INITIAL_REF_ACTOR',
      now,
      registration: {
        sourceType: 'USER_INTERVIEW',
        businessOwnerId: 'CODEx_TEST_INITIAL_REF_ACTOR',
        materialPurpose: 'FACT',
        sensitivity: 'RESTRICTED',
      },
      initialBaselineId: 'CODEx_TEST_INITIAL_REF_BASELINE',
      confirmedBy: 'CODEx_TEST_INITIAL_REF_ACTOR',
    });

    expect(
      createInitialMaterialRef({
        id: 'CODEx_TEST_INITIAL_REF',
        requirement: draft.requirement,
        baseline: draft.materialBaseline!,
        contentHash:
          'sha256:63ea936a895fac99233241a402137eee978eb1f22c4e36cc88b1a16daac2b23b',
      }),
    ).toEqual({
      id: 'CODEx_TEST_INITIAL_REF',
      baselineId: 'CODEx_TEST_INITIAL_REF_BASELINE',
      referenceType: 'ORIGINAL_IDEA',
      source: '  Preserve this exact UTF-8 idea.  ',
      version: '1',
      contentHash:
        'sha256:63ea936a895fac99233241a402137eee978eb1f22c4e36cc88b1a16daac2b23b',
      location: 'pfc://requirements/CODEx_TEST_INITIAL_REF_REQ/original-idea',
      sensitivity: 'RESTRICTED',
      validity: 'VALID',
      createdAt: now,
    });
  });

  it('rejects a baseline that is not the Requirement current baseline', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_INITIAL_REF_MISMATCH_REQ',
      name: 'Initial material reference mismatch',
      originalIdea: 'Mismatch must fail closed.',
      initiatorId: 'CODEx_TEST_INITIAL_REF_ACTOR',
      now,
      registration: {
        sourceType: 'BUSINESS_FEEDBACK',
        businessOwnerId: 'CODEx_TEST_INITIAL_REF_ACTOR',
        materialPurpose: 'FACT',
        sensitivity: 'INTERNAL',
      },
      initialBaselineId: 'CODEx_TEST_INITIAL_REF_MISMATCH_BASELINE',
      confirmedBy: 'CODEx_TEST_INITIAL_REF_ACTOR',
    });

    expect(() =>
      createInitialMaterialRef({
        id: 'CODEx_TEST_INITIAL_REF_MISMATCH',
        requirement: draft.requirement,
        baseline: {
          ...draft.materialBaseline!,
          id: 'CODEx_TEST_INITIAL_REF_FOREIGN_BASELINE',
        },
        contentHash: `sha256:${'a'.repeat(64)}`,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });
});
