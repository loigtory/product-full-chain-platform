// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaterialImpactPanel } from '../../apps/web/src/MaterialImpactPanel.tsx';
import {
  RequirementsApiError,
  type RequirementsApi,
} from '../../apps/web/src/requirements-api.ts';
import { TimelinePanel } from '../../apps/web/src/TimelinePanel.tsx';
import type {
  MaterialImpactAssessmentDto,
  RequirementDetailDto,
  TimelineEventDto,
} from '../../packages/contracts/src/index.ts';

const now = '2026-09-05T08:00:00.000Z';
const requirementId = 'CODEx_TEST_T6_UI_REQ_1';
const currentBaseline = {
  id: 'CODEx_TEST_T6_UI_BASELINE_1',
  versionNumber: 1,
  sourceType: 'BUSINESS_FEEDBACK' as const,
  sourceDescription: null,
  materialPurpose: 'FACT' as const,
  sensitivity: 'INTERNAL' as const,
  confirmedBy: 'CODEx_TEST_T6_UI_PM',
  confirmedAt: now,
};
const candidateBaseline = {
  ...currentBaseline,
  id: 'CODEx_TEST_T6_UI_BASELINE_2',
  versionNumber: 2,
  sourceType: 'USER_INTERVIEW' as const,
  confirmedAt: '2026-09-05T08:10:00.000Z',
};

const pendingImpact: MaterialImpactAssessmentDto = {
  id: 'CODEx_TEST_T6_UI_IMPACT_1',
  requirementId,
  originalBaselineId: currentBaseline.id,
  candidateBaselineId: candidateBaseline.id,
  recommendedStage: 'G1',
  selectedStage: null,
  decision: null,
  reason: null,
  status: 'PENDING',
  confirmedRole: null,
  confirmedBy: null,
  confirmedAt: null,
  invalidatedGateRunIds: [],
  createdAt: now,
};

function detail(
  impact: MaterialImpactAssessmentDto | null = null,
): RequirementDetailDto {
  return {
    id: requirementId,
    name: '续期材料评审规则',
    originalIdea: '新材料进入后重新评估已通过门禁。',
    initiatorId: 'CODEx_TEST_T6_UI_PM',
    businessOwnerId: 'CODEx_TEST_T6_UI_OWNER',
    currentStage: 'G3',
    rowVersion: 4,
    registration: {
      sourceType: 'BUSINESS_FEEDBACK',
      businessOwnerId: 'CODEx_TEST_T6_UI_OWNER',
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
    },
    missingFields: [],
    gateProjection: 'NOT_STARTED',
    currentBaseline,
    materialBaselines: impact
      ? [currentBaseline, candidateBaseline]
      : [currentBaseline],
    materialImpacts: impact ? [impact] : [],
    questions: [],
    currentGateRun: null,
    gateRuns: [],
    gateExecution: {
      status: 'UNAVAILABLE',
      capabilityVersion: 'fixture/t6/v1',
      checkedAt: now,
      reasonCode: 'CAPABILITY_NOT_CONFIGURED',
    },
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(cleanup);

describe('T6 material impact panel', () => {
  it('registers a candidate while preserving the displayed current baseline', async () => {
    const createMaterialImpactAssessment = vi.fn(async () => ({
      replayed: false,
      requirement: {
        id: requirementId,
        currentStage: 'G3' as const,
        currentBaselineId: currentBaseline.id,
        rowVersion: 4,
      },
      assessment: pendingImpact,
    }));
    const onReload = vi.fn(async () => undefined);
    const api = {
      createMaterialImpactAssessment,
    } as unknown as RequirementsApi;

    render(
      <MaterialImpactPanel api={api} detail={detail()} onReload={onReload} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '登记新材料' }));
    fireEvent.change(screen.getByLabelText('建议最早受影响门禁'), {
      target: { value: 'G1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登记候选基线' }));

    await waitFor(() =>
      expect(createMaterialImpactAssessment).toHaveBeenCalled(),
    );
    expect(createMaterialImpactAssessment).toHaveBeenCalledWith(
      requirementId,
      expect.objectContaining({ recommendedStage: 'G1' }),
      expect.any(String),
    );
    expect(screen.getByLabelText('材料基线历史').textContent).toContain(
      'V1当前',
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
  });

  it('confirms no impact without sending a rollback stage', async () => {
    const confirmMaterialImpact = vi.fn(async () => ({
      replayed: false,
      requirement: {
        id: requirementId,
        currentStage: 'G3' as const,
        currentBaselineId: candidateBaseline.id,
        rowVersion: 5,
      },
      assessment: {
        ...pendingImpact,
        status: 'CONFIRMED' as const,
        decision: 'NO_IMPACT' as const,
      },
    }));
    const onReload = vi.fn(async () => undefined);
    const api = { confirmMaterialImpact } as unknown as RequirementsApi;

    render(
      <MaterialImpactPanel
        api={api}
        detail={detail(pendingImpact)}
        onReload={onReload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认影响' }));
    fireEvent.click(screen.getByLabelText('不影响现有结论'));
    fireEvent.change(screen.getByLabelText('确认原因'), {
      target: { value: '补充材料仅提供旁证，不改变既有事实和门禁结论。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认并切换基线' }));

    await waitFor(() => expect(confirmMaterialImpact).toHaveBeenCalled());
    expect(confirmMaterialImpact).toHaveBeenCalledWith(
      requirementId,
      pendingImpact.id,
      expect.objectContaining({
        decision: 'NO_IMPACT',
        selectedStage: null,
      }),
      4,
      expect.any(String),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
  });

  it('resets the recommended stage when an authoritative refresh moves the requirement', () => {
    const api = {
      createMaterialImpactAssessment: vi.fn(),
    } as unknown as RequirementsApi;
    const view = render(
      <MaterialImpactPanel api={api} detail={detail()} onReload={vi.fn()} />,
    );
    view.rerender(
      <MaterialImpactPanel
        api={api}
        detail={{ ...detail(), currentStage: 'G1', rowVersion: 5 }}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '登记新材料' }));

    expect(
      (screen.getByLabelText('建议最早受影响门禁') as HTMLSelectElement).value,
    ).toBe('G1');
  });
});

describe('T6 timeline panel', () => {
  it('subscribes after the latest event and re-reads timeline and authority', async () => {
    const event: TimelineEventDto = {
      eventId: 'CODEx_TEST_T6_UI_TIMELINE_7',
      sequence: 7,
      type: 'baseline.switched',
      requirementId,
      aggregateVersion: 5,
      occurredAt: now,
      beforeSummary: { baselineId: currentBaseline.id, stage: 'G3' },
      afterSummary: {
        baselineId: candidateBaseline.id,
        stage: 'G3',
        decision: 'NO_IMPACT',
        confirmedRole: 'BUSINESS_OWNER',
      },
    };
    const listTimeline = vi.fn(async () => ({
      items: [event],
      nextCursor: null,
      partial: false,
      checkedAt: now,
    }));
    let notify: (() => void) | null = null;
    const close = vi.fn();
    const subscribeToRequirementEvents = vi.fn(
      (_id: string, _after: number, onEvent: () => void) => {
        notify = onEvent;
        return { close };
      },
    );
    const onAuthorityRefresh = vi.fn(async () => undefined);
    const api = {
      listTimeline,
      subscribeToRequirementEvents,
    } as unknown as RequirementsApi;

    render(
      <TimelinePanel
        api={api}
        onAuthorityRefresh={onAuthorityRefresh}
        requirementId={requirementId}
      />,
    );

    expect(await screen.findByText('材料基线已切换')).toBeTruthy();
    expect(screen.getByText('确认不影响现有结论')).toBeTruthy();
    expect(
      screen.getByText(
        `${currentBaseline.id} → ${candidateBaseline.id} · BUSINESS_OWNER`,
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(subscribeToRequirementEvents).toHaveBeenCalledWith(
        requirementId,
        7,
        expect.any(Function),
      ),
    );
    notify!();
    await waitFor(() => expect(listTimeline).toHaveBeenCalledTimes(2));
    expect(onAuthorityRefresh).toHaveBeenCalledOnce();
  });

  it('purges a previously visible timeline when a refresh is denied', async () => {
    const event: TimelineEventDto = {
      eventId: 'CODEx_TEST_T6_UI_TIMELINE_DENIED',
      sequence: 4,
      type: 'gate.completed',
      requirementId,
      aggregateVersion: 4,
      occurredAt: now,
      beforeSummary: { status: 'IN_PROGRESS' },
      afterSummary: { status: 'COMPLETED', stage: 'G3' },
    };
    const listTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: [event],
        nextCursor: null,
        partial: false,
        checkedAt: now,
      })
      .mockRejectedValueOnce(
        new RequirementsApiError({
          code: 'PERMISSION_DENIED',
          message: 'Timeline access was denied.',
          requestId: 'CODEx_TEST_T6_UI_DENIED',
          retryable: false,
          recoveryAction: 'RETURN_TO_WORKLIST',
        }),
      );
    const onAuthorityRefresh = vi.fn(async () => undefined);
    const api = { listTimeline } as unknown as RequirementsApi;

    render(
      <TimelinePanel
        api={api}
        onAuthorityRefresh={onAuthorityRefresh}
        requirementId={requirementId}
      />,
    );
    expect(await screen.findByText('门禁已完成')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载时间线' }));

    await waitFor(() => expect(onAuthorityRefresh).toHaveBeenCalledOnce());
    expect(screen.queryByText('门禁已完成')).toBeNull();
  });
});
