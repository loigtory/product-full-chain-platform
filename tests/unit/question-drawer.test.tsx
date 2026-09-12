// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../apps/web/src/App.tsx';
import {
  RequirementSubmissionUnknownError,
  type RequirementsApi,
} from '../../apps/web/src/requirements-api.ts';
import type {
  QuestionDto,
  RequirementDetailDto,
  RequirementListItemDto,
} from '../../packages/contracts/src/index.ts';

const question: QuestionDto = {
  id: 'CODEx_TEST_T4_UI_QUESTION_OPEN',
  requirementId: 'CODEx_TEST_T4_UI_REQUIREMENT',
  baselineId: 'CODEx_TEST_T4_UI_BASELINE',
  prompt: '本版本采用哪种结算口径？',
  reason: '当前门禁必须有唯一口径。',
  candidates: ['按实结算', '按预算结算'],
  ownerId: 'CODEx_TEST_T4_UI_BUSINESS_OWNER',
  closeByStage: 'G1',
  status: 'OPEN',
  currentDecisionId: null,
  rowVersion: 0,
  supersededByQuestionId: null,
  decisions: [],
  createdAt: '2026-09-05T05:00:00.000Z',
  updatedAt: '2026-09-05T05:00:00.000Z',
};

const answeredQuestion: QuestionDto = {
  ...question,
  status: 'ANSWERED',
  currentDecisionId: 'CODEx_TEST_T4_UI_DECISION_1',
  rowVersion: 1,
  decisions: [
    {
      id: 'CODEx_TEST_T4_UI_DECISION_1',
      questionId: question.id,
      kind: 'ANSWER',
      rawAnswer: '按实结算',
      explanation: '以实际核定金额为准。',
      scope: {
        questionId: question.id,
        requirementId: question.requirementId,
        baselineId: question.baselineId,
        closeByStage: question.closeByStage,
      },
      versionNumber: 1,
      confirmedRole: null,
      confirmedBy: null,
      confirmedAt: null,
      validity: 'CURRENT',
      supersedesDecisionId: null,
      createdAt: question.createdAt,
    },
  ],
};

const confirmedQuestion: QuestionDto = {
  ...answeredQuestion,
  status: 'CONFIRMED',
  rowVersion: 2,
  decisions: [
    {
      ...answeredQuestion.decisions[0],
      confirmedRole: 'BUSINESS_OWNER',
      confirmedBy: question.ownerId,
      confirmedAt: question.updatedAt,
    },
  ],
};

function detailWith(currentQuestion: QuestionDto): RequirementDetailDto {
  return {
    id: question.requirementId,
    name: '结算口径需求',
    originalIdea: '统一结算金额定义。',
    initiatorId: 'CODEx_TEST_T4_UI_PM',
    businessOwnerId: question.ownerId,
    currentStage: 'G0',
    rowVersion: 1,
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      businessOwnerId: question.ownerId,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    missingFields: [],
    gateProjection: 'NOT_STARTED',
    currentBaseline: {
      id: question.baselineId,
      versionNumber: 1,
      sourceType: 'BUSINESS_FEEDBACK',
      sourceDescription: null,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
      confirmedBy: 'CODEx_TEST_T4_UI_PM',
      confirmedAt: question.createdAt,
    },
    questions: [currentQuestion],
    currentGateRun: null,
    gateRuns: [],
    gateExecution: {
      status: 'AVAILABLE',
      capabilityVersion: 'fixture/t5/v1',
      checkedAt: question.updatedAt,
      reasonCode: null,
    },
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

const listItem: RequirementListItemDto = {
  id: question.requirementId,
  name: '结算口径需求',
  currentStage: 'G0',
  gateProjection: 'NOT_STARTED',
  ownerId: question.ownerId,
  nextAction: '处理问题',
  updatedAt: question.updatedAt,
  dependencyStatus: 'AVAILABLE',
  warningCode: null,
};

function fakeApi(
  currentQuestion: QuestionDto,
  overrides: Partial<RequirementsApi> = {},
): RequirementsApi {
  return {
    listRequirements: vi.fn(async () => ({
      items: [listItem],
      nextCursor: null,
      partial: false,
      checkedAt: question.updatedAt,
    })),
    getRequirement: vi.fn(async () => detailWith(currentQuestion)),
    createRequirement: vi.fn(),
    completeG0Registration: vi.fn(),
    getRequirementSubmission: vi.fn(),
    answerQuestion: vi.fn(async () => ({
      action: 'ANSWER' as const,
      replayed: false,
      question: answeredQuestion,
    })),
    confirmQuestion: vi.fn(async () => ({
      action: 'CONFIRM' as const,
      replayed: false,
      question: confirmedQuestion,
    })),
    returnQuestion: vi.fn(async () => ({
      action: 'RETURN' as const,
      replayed: false,
      question: {
        ...answeredQuestion,
        status: 'OPEN' as const,
        rowVersion: 2,
      },
    })),
    supersedeQuestion: vi.fn(async () => ({
      action: 'SUPERSEDE' as const,
      replayed: false,
      question: {
        ...confirmedQuestion,
        id: 'CODEx_TEST_T4_UI_QUESTION_REPLACEMENT',
      },
    })),
    deferQuestion: vi.fn(async () => ({
      action: 'DEFER' as const,
      replayed: false,
      question: { ...question, status: 'DEFERRED' as const, rowVersion: 1 },
    })),
    startAutomaticGateRun: vi.fn(),
    registerManualGateRun: vi.fn(),
    getGateRun: vi.fn(),
    ...overrides,
  };
}

async function openQuestionDrawer(api: RequirementsApi) {
  render(<App api={api} />);
  fireEvent.click(await screen.findByText('结算口径需求'));
  fireEvent.click(
    await screen.findByRole('button', { name: /处理问题.*结算口径/ }),
  );
  return screen.findByRole('dialog', { name: '问题与决定' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => cleanup());

describe('T4 Question drawer', () => {
  it('closes on Escape, traps Tab, and restores focus to the question trigger', async () => {
    const api = fakeApi(question);
    render(<App api={api} />);
    fireEvent.click(await screen.findByText('结算口径需求'));
    const trigger = await screen.findByRole('button', {
      name: /处理问题.*结算口径/,
    });
    trigger.focus();
    fireEvent.click(trigger);

    const drawer = await screen.findByRole('dialog', { name: '问题与决定' });
    const close = within(drawer).getByRole('button', {
      name: '关闭问题与决定',
    });
    const lastAction = within(drawer).getByRole('textbox', {
      name: '重新进入条件',
    });
    expect(document.activeElement).toBe(close);

    lastAction.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastAction);

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '问题与决定' })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('saves an OPEN candidate as an original answer without confirming it', async () => {
    const api = fakeApi(question);
    const drawer = await openQuestionDrawer(api);

    fireEvent.click(screen.getByRole('button', { name: '按实结算' }));
    fireEvent.change(screen.getByLabelText('回答说明'), {
      target: { value: '以实际核定金额为准。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存原始回答' }));

    await waitFor(() => expect(api.answerQuestion).toHaveBeenCalled());
    expect(api.answerQuestion).toHaveBeenCalledWith(
      question.requirementId,
      question.id,
      {
        rawAnswer: '按实结算',
        explanation: '以实际核定金额为准。',
      },
      0,
      expect.any(String),
    );
    expect(
      (await within(drawer).findByTitle('原始状态：ANSWERED')).textContent,
    ).toBe('已回答');
    expect(document.body.textContent).not.toContain('GateRun PASS');
  });

  it('shows the exact scope and supports confirm or return for ANSWERED', async () => {
    const api = fakeApi(answeredQuestion);
    const drawer = await openQuestionDrawer(api);

    expect(within(drawer).getByText(question.baselineId)).toBeTruthy();
    expect(within(drawer).getByText('G1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('业务责任人'));
    fireEvent.click(screen.getByRole('button', { name: '确认当前回答' }));
    await waitFor(() => expect(api.confirmQuestion).toHaveBeenCalled());
    expect(api.confirmQuestion).toHaveBeenCalledWith(
      question.requirementId,
      question.id,
      {
        decisionId: answeredQuestion.currentDecisionId,
        confirmedRole: 'BUSINESS_OWNER',
      },
      1,
      expect.any(String),
    );

    cleanup();
    const returnApi = fakeApi(answeredQuestion);
    await openQuestionDrawer(returnApi);
    fireEvent.change(screen.getByLabelText('退回原因'), {
      target: { value: '缺少财务核对依据。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '退回答案' }));
    await waitFor(() => expect(returnApi.returnQuestion).toHaveBeenCalled());
  });

  it('supports a confirmed replacement and an explicit deferral', async () => {
    const replaceApi = fakeApi(confirmedQuestion);
    await openQuestionDrawer(replaceApi);
    fireEvent.change(screen.getByLabelText('新决定'), {
      target: { value: '按核定后的实际金额结算' },
    });
    fireEvent.change(screen.getByLabelText('替代说明'), {
      target: { value: '新证据修正原口径。' },
    });
    fireEvent.click(screen.getByLabelText('业务责任人'));
    fireEvent.click(screen.getByRole('button', { name: '确认替代决定' }));
    await waitFor(() =>
      expect(replaceApi.supersedeQuestion).toHaveBeenCalled(),
    );

    cleanup();
    const deferApi = fakeApi(question);
    await openQuestionDrawer(deferApi);
    fireEvent.change(screen.getByLabelText('延后原因'), {
      target: { value: '当前版本不依赖该口径。' },
    });
    fireEvent.change(screen.getByLabelText('重新进入条件'), {
      target: { value: '进入 G3 前重开。' },
    });
    fireEvent.click(screen.getByLabelText('业务责任人'));
    fireEvent.click(screen.getByRole('button', { name: '延后问题' }));
    await waitFor(() => expect(deferApi.deferQuestion).toHaveBeenCalled());
  });

  it('verifies an unknown write by re-reading authoritative Question state before retry', async () => {
    const getRequirement = vi
      .fn()
      .mockResolvedValueOnce(detailWith(question))
      .mockResolvedValueOnce(detailWith(answeredQuestion));
    const api = fakeApi(question, {
      getRequirement,
      answerQuestion: vi.fn(async (_id, _questionId, _input, _version, key) => {
        throw new RequirementSubmissionUnknownError(key);
      }),
    });
    await openQuestionDrawer(api);
    fireEvent.click(screen.getByRole('button', { name: '按实结算' }));
    fireEvent.click(screen.getByRole('button', { name: '保存原始回答' }));

    expect(await screen.findByText('问题操作结果待核验')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '再次提交' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核验问题状态' }));
    expect(await screen.findByText('已核验为已回答')).toBeTruthy();
    expect(getRequirement).toHaveBeenCalledTimes(2);
  });
});
