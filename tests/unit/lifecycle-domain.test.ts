import { describe, expect, it } from 'vitest';

import {
  DomainRuleViolation,
  completeG0Registration,
  createRequirementDraft,
  evaluateG0Registration,
} from '../../packages/domain/src/index.ts';

const now = '2026-09-04T08:00:00.000Z';

describe('G0 requirement lifecycle', () => {
  it('creates an incomplete G0 draft without inventing a material baseline', () => {
    const result = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_MINIMAL',
      name: '需求生命周期工作台',
      originalIdea: '让产品作业状态可以从权威记录恢复。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
    });

    expect(result.requirement).toMatchObject({
      currentStage: 'G0',
      currentBaselineId: null,
      rowVersion: 0,
    });
    expect(result.materialBaseline).toBeNull();
    expect(result.gateProjection).toBe('BLOCK');
    expect(result.missingFields).toEqual([
      'sourceType',
      'businessOwnerId',
      'materialPurpose',
      'sensitivity',
    ]);
  });

  it('rejects a blank name or original idea without returning a partial object', () => {
    expect(() =>
      createRequirementDraft({
        id: 'CODEx_TEST_T1_REQ_INVALID',
        name: '   ',
        originalIdea: 'valid idea',
        initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
        now,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });

  it('requires a non-blank source description only for OTHER', () => {
    expect(
      evaluateG0Registration({
        sourceType: 'OTHER',
        sourceDescription: '   ',
        businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
        materialPurpose: 'FACT',
        sensitivity: 'INTERNAL',
      }),
    ).toEqual({ complete: false, missingFields: ['sourceDescription'] });

    expect(
      evaluateG0Registration({
        sourceType: 'BUSINESS_FEEDBACK',
        sourceDescription: 'must not be persisted',
        businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
        materialPurpose: 'FACT',
        sensitivity: 'INTERNAL',
      }),
    ).toEqual({ complete: true, missingFields: [] });
  });

  it('does not retain an OTHER description when a fixed source is selected', () => {
    const result = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_FIXED_SOURCE',
      name: '固定来源',
      originalIdea: '未提交的其他说明不能成为当前事实。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
      registration: {
        sourceType: 'POLICY_OR_COMPLIANCE',
        sourceDescription: 'stale text',
        businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
        materialPurpose: 'CONSTRAINT',
        sensitivity: 'INTERNAL',
      },
      initialBaselineId: 'CODEx_TEST_T1_BASELINE_FIXED_SOURCE',
      confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
    });

    expect(result.requirement.draftRegistration?.sourceDescription).toBeNull();
    expect(result.materialBaseline?.sourceDescription).toBeNull();
  });

  it('completes G0 registration without changing the original name or idea', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_COMPLETE',
      name: '需求生命周期工作台',
      originalIdea: '原始想法必须保留。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
    });

    const completed = completeG0Registration({
      requirement: draft.requirement,
      baselineId: 'CODEx_TEST_T1_BASELINE_1',
      registration: {
        sourceType: 'OTHER',
        sourceDescription: '  外部研究补充  ',
        businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
        materialPurpose: 'FACT',
        sensitivity: 'RESTRICTED',
      },
      confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
      now: '2026-09-04T08:01:00.000Z',
      expectedRowVersion: 0,
    });

    expect(completed.requirement).toMatchObject({
      name: draft.requirement.name,
      originalIdea: draft.requirement.originalIdea,
      businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
      currentStage: 'G0',
      currentBaselineId: 'CODEx_TEST_T1_BASELINE_1',
      rowVersion: 1,
    });
    expect(completed.materialBaseline).toMatchObject({
      versionNumber: 1,
      status: 'CURRENT',
      sourceType: 'OTHER',
      sourceDescription: '外部研究补充',
    });
    expect(completed.gateProjection).toBe('NOT_STARTED');
    expect(draft.requirement.currentBaselineId).toBeNull();
  });

  it('fills only missing G0 registration fields and preserves existing values', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_PARTIAL_REGISTRATION',
      name: '部分登记信息',
      originalIdea: '补充入口只能填写缺项。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
      registration: {
        sourceType: 'OPERATIONS_ISSUE',
        materialPurpose: 'CONSTRAINT',
      },
    });

    const completed = completeG0Registration({
      requirement: draft.requirement,
      baselineId: 'CODEx_TEST_T1_BASELINE_PARTIAL_REGISTRATION',
      registration: {
        businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
        sensitivity: 'INTERNAL',
      },
      confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
      now,
      expectedRowVersion: 0,
    });

    expect(completed.requirement.draftRegistration).toEqual({
      sourceType: 'OPERATIONS_ISSUE',
      sourceDescription: null,
      businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
      materialPurpose: 'CONSTRAINT',
      sensitivity: 'INTERNAL',
    });
  });

  it('rejects attempts to overwrite an existing G0 registration value', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_REGISTRATION_OVERWRITE',
      name: '登记信息不可覆盖',
      originalIdea: '已登记来源必须保持。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
      registration: {
        sourceType: 'OPERATIONS_ISSUE',
      },
    });

    expect(() =>
      completeG0Registration({
        requirement: draft.requirement,
        baselineId: 'CODEx_TEST_T1_BASELINE_REGISTRATION_OVERWRITE',
        registration: {
          sourceType: 'USER_INTERVIEW',
          businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
          materialPurpose: 'FACT',
          sensitivity: 'INTERNAL',
        },
        confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
        now,
        expectedRowVersion: 0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VALIDATION_FAILED',
      }),
    );
  });

  it('fails closed on a stale row version', () => {
    const draft = createRequirementDraft({
      id: 'CODEx_TEST_T1_REQ_CONFLICT',
      name: '并发检查',
      originalIdea: '第二个写入不能覆盖第一个。',
      initiatorId: 'CODEx_TEST_T1_ACTOR_PM',
      now,
    });

    expect(() =>
      completeG0Registration({
        requirement: draft.requirement,
        baselineId: 'CODEx_TEST_T1_BASELINE_CONFLICT',
        registration: {
          sourceType: 'USER_INTERVIEW',
          businessOwnerId: 'CODEx_TEST_T1_ACTOR_OWNER',
          materialPurpose: 'CONSTRAINT',
          sensitivity: 'INTERNAL',
        },
        confirmedBy: 'CODEx_TEST_T1_ACTOR_OWNER',
        now,
        expectedRowVersion: 9,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainRuleViolation>>({
        code: 'VERSION_CONFLICT',
      }),
    );
  });
});
