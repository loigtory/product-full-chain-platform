// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GateRunPanel } from '../../apps/web/src/GateRunPanel.tsx';
import type { RequirementsApi } from '../../apps/web/src/requirements-api.ts';
import type {
  GateRunDto,
  RequirementDetailDto,
} from '../../packages/contracts/src/index.ts';

const now = '2026-09-05T06:30:00.000Z';
const baselineId = 'CODEx_TEST_T5_UI_BASELINE_1';

const passedRun: GateRunDto = {
  id: 'CODEx_TEST_T5_UI_GATE_1',
  requirementId: 'CODEx_TEST_T5_UI_REQ_1',
  baselineId,
  stage: 'G0',
  mode: 'AUTOMATIC',
  status: 'COMPLETED',
  result: 'PASS',
  validity: 'CURRENT',
  ownerId: 'CODEx_TEST_T5_UI_PM',
  confirmedRole: null,
  confirmedBy: null,
  confirmedAt: null,
  startedAt: now,
  completedAt: now,
  failureReason: null,
  unknownReason: null,
  registrationNote: null,
  checks: [
    {
      id: 'CODEx_TEST_T5_UI_CHECK_1',
      checkKey: 'automatic.aggregate',
      result: 'PASS',
      reason: null,
      ownerId: 'CODEx_TEST_T5_UI_PM',
      closePoint: 'G0',
    },
  ],
  evidence: [],
  advancement: {
    id: 'CODEx_TEST_T5_UI_ADVANCE_1',
    fromStage: 'G0',
    toStage: 'G1',
    advancedAt: now,
  },
};

function detail(
  gateExecutionStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN',
  run: GateRunDto | null = null,
): RequirementDetailDto {
  return {
    id: passedRun.requirementId,
    name: '结算材料完整性门禁',
    originalIdea: '在进入方案阶段前验证登记与证据。',
    initiatorId: 'CODEx_TEST_T5_UI_PM',
    businessOwnerId: 'CODEx_TEST_T5_UI_OWNER',
    currentStage: 'G0',
    rowVersion: 1,
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      businessOwnerId: 'CODEx_TEST_T5_UI_OWNER',
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    missingFields: [],
    gateProjection:
      run?.status === 'IN_PROGRESS' ? 'PROCESSING' : 'NOT_STARTED',
    currentBaseline: {
      id: baselineId,
      versionNumber: 1,
      sourceType: 'BUSINESS_FEEDBACK',
      sourceDescription: null,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
      confirmedBy: 'CODEx_TEST_T5_UI_PM',
      confirmedAt: now,
    },
    questions: [],
    currentGateRun: run,
    gateRuns: run ? [run] : [],
    gateExecution: {
      status: gateExecutionStatus,
      capabilityVersion: 'fixture/t5/v1',
      checkedAt: now,
      reasonCode:
        gateExecutionStatus === 'AVAILABLE'
          ? null
          : 'CAPABILITY_NOT_CONFIGURED',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function api(overrides: Partial<RequirementsApi> = {}): RequirementsApi {
  const unavailable = async () => {
    throw new Error('unused');
  };
  return {
    listRequirements: unavailable,
    getRequirement: vi.fn(async () => ({
      ...detail('UNAVAILABLE'),
      currentStage: 'G1' as const,
      gateRuns: [passedRun],
    })),
    createRequirement: unavailable,
    completeG0Registration: unavailable,
    getRequirementSubmission: unavailable,
    answerQuestion: unavailable,
    confirmQuestion: unavailable,
    returnQuestion: unavailable,
    supersedeQuestion: unavailable,
    deferQuestion: unavailable,
    startAutomaticGateRun: vi.fn(async () => ({
      replayed: false,
      reusedInProgress: false,
      gateRun: passedRun,
      requirement: {
        id: passedRun.requirementId,
        currentStage: 'G1',
        currentBaselineId: baselineId,
        rowVersion: 2,
      },
    })),
    registerManualGateRun: vi.fn(async () => ({
      replayed: false,
      reusedInProgress: false,
      gateRun: { ...passedRun, mode: 'MANUAL' as const },
      requirement: {
        id: passedRun.requirementId,
        currentStage: 'G1',
        currentBaselineId: baselineId,
        rowVersion: 2,
      },
    })),
    getGateRun: vi.fn(async () => ({
      replayed: false,
      reusedInProgress: false,
      gateRun: passedRun,
      requirement: {
        id: passedRun.requirementId,
        currentStage: 'G1',
        currentBaselineId: baselineId,
        rowVersion: 2,
      },
    })),
    ...overrides,
  } as RequirementsApi;
}

afterEach(cleanup);

describe('T5 GateRun panel', () => {
  it('closes the manual dialog on Escape and restores trigger focus', async () => {
    render(
      <GateRunPanel
        api={api()}
        detail={detail('UNAVAILABLE')}
        onDetailChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: '登记人工结论' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '登记人工门禁结论' });
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: '登记说明' }),
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '登记人工门禁结论' }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('disables automatic execution when unavailable and keeps manual registration usable', async () => {
    const client = api();
    const onDetailChange = vi.fn();
    render(
      <GateRunPanel
        api={client}
        detail={detail('UNAVAILABLE')}
        onDetailChange={onDetailChange}
      />,
    );

    expect(screen.getByText('自动门禁不可用')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: '运行自动门禁',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '登记人工结论' }));
    fireEvent.change(screen.getByLabelText('登记说明'), {
      target: { value: '自动能力不可用，由业务责任人依据当前证据登记。' },
    });
    fireEvent.change(screen.getByLabelText('证据引用'), {
      target: { value: 'CODEx_TEST_T5_UI_EVIDENCE_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交人工结论' }));

    await waitFor(() =>
      expect(client.registerManualGateRun).toHaveBeenCalled(),
    );
    expect(client.registerManualGateRun).toHaveBeenCalledWith(
      passedRun.requirementId,
      expect.objectContaining({
        result: 'PASS',
        confirmedRole: 'BUSINESS_OWNER',
        evidenceRefIds: ['CODEx_TEST_T5_UI_EVIDENCE_1'],
        checks: [expect.objectContaining({ result: 'PASS' })],
      }),
      1,
      expect.stringContaining('CODEx_TEST_'),
    );
    await waitFor(() => expect(onDetailChange).toHaveBeenCalled());
  });

  it('runs an available automatic gate and reloads authoritative detail', async () => {
    const client = api();
    const onDetailChange = vi.fn();
    render(
      <GateRunPanel
        api={client}
        detail={detail('AVAILABLE')}
        onDetailChange={onDetailChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '运行自动门禁' }));

    await waitFor(() =>
      expect(client.startAutomaticGateRun).toHaveBeenCalled(),
    );
    expect(client.startAutomaticGateRun).toHaveBeenCalledWith(
      passedRun.requirementId,
      { baselineId, stage: 'G0' },
      1,
      expect.stringContaining('CODEx_TEST_'),
    );
    await waitFor(() => expect(onDetailChange).toHaveBeenCalled());
  });

  it('refreshes a processing run without starting another execution', async () => {
    const processing = {
      ...passedRun,
      id: 'CODEx_TEST_T5_UI_GATE_PROCESSING',
      status: 'IN_PROGRESS' as const,
      result: null,
      completedAt: null,
      advancement: null,
    };
    const client = api();
    render(
      <GateRunPanel
        api={client}
        detail={detail('AVAILABLE', processing)}
        onDetailChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新门禁结果' }));

    await waitFor(() =>
      expect(client.getGateRun).toHaveBeenCalledWith(
        passedRun.requirementId,
        processing.id,
      ),
    );
    expect(client.startAutomaticGateRun).not.toHaveBeenCalled();
  });
});
