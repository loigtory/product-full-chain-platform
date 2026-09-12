import { describe, expect, it } from 'vitest';

import {
  createActionProposal,
  createProductWorkSession,
  createProductWorkTurn,
  decideActionProposal,
  transitionActionProposal,
  transitionProductWorkSession,
  transitionProductWorkTurn,
} from '../../packages/domain/src/index.ts';

const at = '2026-09-07T01:00:00.000Z';
const id = (suffix: string) => `CODEx_TEST_AIUX_DOMAIN_${suffix}`;

describe('AI-UX-R1 ProductWorkSession domain', () => {
  it('creates a version-anchored active Web work session', () => {
    const session = createProductWorkSession({
      id: id('SESSION_1'),
      teamId: id('TEAM_1'),
      requirementId: id('REQ_1'),
      openedRequirementVersion: 3,
      currentRequirementVersion: 3,
      openedBaselineId: id('BASELINE_1'),
      openedStage: 'G2',
      ownerId: id('ACTOR_PM'),
      createdBy: id('ACTOR_PM'),
      title: '理赔材料口径澄清',
      createdAt: at,
    });

    expect(session).toMatchObject({
      schemaVersion: 'product-work-session/1',
      status: 'ACTIVE',
      controlSurface: 'WEB',
      activeTurnId: null,
      lastSequence: 0,
      rowVersion: 0,
      openedRequirementVersion: 3,
      currentRequirementVersion: 3,
    });
  });

  it('requires explicit revalidated RESUME when an archived session becomes active', () => {
    const session = createProductWorkSession({
      id: id('SESSION_2'),
      teamId: id('TEAM_1'),
      requirementId: id('REQ_1'),
      openedRequirementVersion: 3,
      currentRequirementVersion: 3,
      openedBaselineId: null,
      openedStage: 'G0',
      ownerId: id('ACTOR_PM'),
      createdBy: id('ACTOR_PM'),
      createdAt: at,
    });
    const archived = transitionProductWorkSession(session, 'ARCHIVED', {
      occurredAt: '2026-09-07T01:01:00.000Z',
    });

    expect(() =>
      transitionProductWorkSession(archived, 'ACTIVE', {
        occurredAt: '2026-09-07T01:02:00.000Z',
      }),
    ).toThrowError('WORK_SESSION_RESUME_REVALIDATION_REQUIRED');
    expect(
      transitionProductWorkSession(archived, 'ACTIVE', {
        occurredAt: '2026-09-07T01:02:00.000Z',
        controlAction: 'RESUME',
        accessRevalidated: true,
        currentRequirementVersion: 3,
      }),
    ).toMatchObject({ status: 'ACTIVE', rowVersion: 2 });
  });

  it('allows UNKNOWN turn convergence only from a read-only verification result', () => {
    const turn = createProductWorkTurn({
      id: id('TURN_1'),
      sessionId: id('SESSION_1'),
      sequence: 1,
      intentKind: 'ANALYZE_REQUIREMENT',
      inputText: '请梳理当前材料缺口。',
      skillReleaseId: id('SKILL_1'),
      createdBy: id('ACTOR_PM'),
      createdAt: at,
    });
    const queued = transitionProductWorkTurn(turn, 'QUEUED', {
      occurredAt: '2026-09-07T01:00:01.000Z',
    });
    const running = transitionProductWorkTurn(queued, 'RUNNING', {
      occurredAt: '2026-09-07T01:00:02.000Z',
      bridgeId: id('BRIDGE_1'),
    });
    const unknown = transitionProductWorkTurn(running, 'UNKNOWN', {
      occurredAt: '2026-09-07T01:00:03.000Z',
      failureReason: 'BRIDGE_RESULT_UNAVAILABLE',
    });

    expect(() =>
      transitionProductWorkTurn(unknown, 'COMPLETED', {
        occurredAt: '2026-09-07T01:00:04.000Z',
        visibleResponse: '已完成。',
      }),
    ).toThrowError('WORK_TURN_VERIFICATION_REQUIRED');
    expect(
      transitionProductWorkTurn(unknown, 'COMPLETED', {
        occurredAt: '2026-09-07T01:00:04.000Z',
        visibleResponse: '已完成。',
        verificationOnly: true,
      }),
    ).toMatchObject({ status: 'COMPLETED', visibleResponse: '已完成。' });
  });

  it('creates a typed proposal with a deterministic server scope hash', () => {
    const input = {
      id: id('PROPOSAL_1'),
      sessionId: id('SESSION_1'),
      turnId: id('TURN_1'),
      kind: 'ANSWER_QUESTION' as const,
      target: {
        aggregateType: 'QUESTION' as const,
        aggregateId: id('QUESTION_1'),
        rowVersion: 4,
      },
      changeSet: {
        kind: 'ANSWER_QUESTION' as const,
        questionId: id('QUESTION_1'),
        answer: '以保单生效日作为统计口径。',
      },
      displayDiff: [
        { field: 'answer', before: null, after: '以保单生效日作为统计口径。' },
      ],
      confirmationRequirement: 'PRODUCT_MANAGER' as const,
      createdAt: at,
    };
    const first = createActionProposal(input);
    const second = createActionProposal({ ...input, id: id('PROPOSAL_2') });

    expect(first).toMatchObject({
      schemaVersion: 'product-action-proposal/1',
      status: 'PENDING_CONFIRMATION',
      rowVersion: 0,
    });
    expect(first.scopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.scopeHash).toBe(first.scopeHash);
  });

  it('fails closed on arbitrary proposal payloads and stale or mismatched confirmation', () => {
    expect(() =>
      createActionProposal({
        id: id('PROPOSAL_BAD'),
        sessionId: id('SESSION_1'),
        turnId: id('TURN_1'),
        kind: 'ANSWER_QUESTION',
        target: {
          aggregateType: 'QUESTION',
          aggregateId: id('QUESTION_1'),
          rowVersion: 4,
        },
        changeSet: {
          kind: 'ANSWER_QUESTION',
          questionId: id('QUESTION_1'),
          answer: 'ok',
          sql: 'delete from requirements',
        } as never,
        displayDiff: [],
        confirmationRequirement: 'PRODUCT_MANAGER',
        createdAt: at,
      }),
    ).toThrowError('INVALID_ACTION_PROPOSAL_CHANGE_SET');

    const proposal = createActionProposal({
      id: id('PROPOSAL_3'),
      sessionId: id('SESSION_1'),
      turnId: id('TURN_1'),
      kind: 'CONFIRM_QUESTION',
      target: {
        aggregateType: 'QUESTION',
        aggregateId: id('QUESTION_1'),
        rowVersion: 4,
      },
      changeSet: {
        kind: 'CONFIRM_QUESTION',
        questionId: id('QUESTION_1'),
        confirmationRole: 'BUSINESS_OWNER',
        reason: '业务口径已确认',
      },
      displayDiff: [],
      confirmationRequirement: 'PRODUCT_MANAGER',
      createdAt: at,
    });

    expect(
      decideActionProposal(proposal, {
        decision: 'CONFIRM',
        actorId: id('ACTOR_PM'),
        decidedAt: '2026-09-07T01:02:00.000Z',
        expectedRowVersion: 0,
        currentTargetVersion: 5,
        scopeHash: proposal.scopeHash,
        reasonCode: 'USER_CONFIRMED',
      }),
    ).toMatchObject({ status: 'STALE', rowVersion: 1 });
    expect(() =>
      decideActionProposal(proposal, {
        decision: 'CONFIRM',
        actorId: id('ACTOR_PM'),
        decidedAt: '2026-09-07T01:02:00.000Z',
        expectedRowVersion: 0,
        currentTargetVersion: 4,
        scopeHash: `sha256:${'f'.repeat(64)}`,
        reasonCode: 'USER_CONFIRMED',
      }),
    ).toThrowError('PROPOSAL_SCOPE_MISMATCH');
  });

  it('keeps UNKNOWN proposal convergence behind idempotent target readback', () => {
    const proposal = createActionProposal({
      id: id('PROPOSAL_4'),
      sessionId: id('SESSION_1'),
      turnId: id('TURN_1'),
      kind: 'REGISTER_ARTIFACT',
      target: {
        aggregateType: 'REQUIREMENT',
        aggregateId: id('REQ_1'),
        rowVersion: 3,
      },
      changeSet: {
        kind: 'REGISTER_ARTIFACT',
        capId: 'CAP-PFC-02',
        stage: 'G2',
        artifactType: 'PRD',
        title: '理赔材料口径 PRD',
      },
      displayDiff: [],
      confirmationRequirement: 'PRODUCT_MANAGER',
      createdAt: at,
    });
    const confirmed = decideActionProposal(proposal, {
      decision: 'CONFIRM',
      actorId: id('ACTOR_PM'),
      decidedAt: '2026-09-07T01:01:00.000Z',
      expectedRowVersion: 0,
      currentTargetVersion: 3,
      scopeHash: proposal.scopeHash,
      reasonCode: 'USER_CONFIRMED',
    });
    const applying = transitionActionProposal(confirmed, 'APPLYING', {
      occurredAt: '2026-09-07T01:01:01.000Z',
    });
    const unknown = transitionActionProposal(applying, 'UNKNOWN', {
      occurredAt: '2026-09-07T01:01:02.000Z',
      failureReason: 'TARGET_COMMIT_STATUS_UNKNOWN',
    });

    expect(() =>
      transitionActionProposal(unknown, 'APPLIED', {
        occurredAt: '2026-09-07T01:01:03.000Z',
        resultRef: {
          aggregateType: 'ARTIFACT',
          aggregateId: id('ARTIFACT_1'),
          rowVersion: 0,
        },
      }),
    ).toThrowError('PROPOSAL_READBACK_REQUIRED');
    expect(
      transitionActionProposal(unknown, 'APPLIED', {
        occurredAt: '2026-09-07T01:01:03.000Z',
        readbackOnly: true,
        resultRef: {
          aggregateType: 'ARTIFACT',
          aggregateId: id('ARTIFACT_1'),
          rowVersion: 0,
        },
      }),
    ).toMatchObject({ status: 'APPLIED' });
  });
});
