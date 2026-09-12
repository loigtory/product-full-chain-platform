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
  requirementsApi,
  type RequirementsApi,
} from '../../apps/web/src/requirements-api.ts';
import type {
  GateCenterResponse,
  MaterialLibraryResponse,
  RequirementDetailDto,
} from '../../packages/contracts/src/index.ts';

const now = '2026-09-05T13:00:00.000Z';
const requirementId = 'CODEx_TEST_UI_R6_REQ';
const baselineId = 'CODEx_TEST_UI_R6_BASELINE_2';

const detail: RequirementDetailDto = {
  id: requirementId,
  name: '结算材料影响评估',
  originalIdea: '核对新增访谈材料对当前结算方案的影响。',
  initiatorId: 'CODEx_TEST_UI_R6_ACTOR',
  businessOwnerId: 'CODEx_TEST_UI_R6_OWNER',
  currentStage: 'G3',
  rowVersion: 4,
  registration: {
    sourceType: 'USER_INTERVIEW',
    businessOwnerId: 'CODEx_TEST_UI_R6_OWNER',
    materialPurpose: 'FACT',
    sensitivity: 'INTERNAL',
  },
  missingFields: [],
  gateProjection: 'WARN',
  currentBaseline: {
    id: baselineId,
    versionNumber: 2,
    sourceType: 'USER_INTERVIEW',
    sourceDescription: null,
    materialPurpose: 'FACT',
    sensitivity: 'INTERNAL',
    confirmedBy: 'CODEx_TEST_UI_R6_ACTOR',
    confirmedAt: now,
  },
  materialBaselines: [],
  materialImpacts: [],
  questions: [],
  currentGateRun: null,
  gateRuns: [],
  gateExecution: {
    status: 'AVAILABLE',
    capabilityVersion: 'fixture/ui-r6/v1',
    checkedAt: now,
    reasonCode: null,
  },
  createdAt: now,
  updatedAt: now,
};

const gateResponse: GateCenterResponse = {
  items: [
    {
      key: `CURRENT:${requirementId}`,
      requirementId,
      requirementName: detail.name,
      requirementStage: 'G3',
      stage: 'G3',
      baselineId,
      gateRunId: 'CODEx_TEST_UI_R6_GATE',
      mode: 'AUTOMATIC',
      status: 'WARN',
      validity: 'CURRENT',
      ownerId: 'CODEx_TEST_UI_R6_OWNER',
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      nextAction: '处理门禁警告',
      historyCount: 3,
    },
  ],
  nextCursor: null,
  checkedAt: now,
};

const materialResponse: MaterialLibraryResponse = {
  items: [
    {
      baselineId,
      requirementId,
      requirementName: detail.name,
      requirementStage: 'G3',
      versionNumber: 2,
      status: 'CANDIDATE',
      sourceType: 'USER_INTERVIEW',
      sourceDescription: null,
      materialPurpose: 'FACT',
      sensitivity: 'INTERNAL',
      confirmedBy: 'CODEx_TEST_UI_R6_ACTOR',
      confirmedAt: now,
      createdAt: now,
      materialRefs: [
        {
          id: 'CODEx_TEST_UI_R6_REF',
          referenceType: 'USER_INTERVIEW_NOTE',
          source: 'SYNTHETIC_TEST',
          version: '1',
          sensitivity: 'INTERNAL',
          validity: 'VALID',
        },
      ],
      pendingImpact: {
        id: 'CODEx_TEST_UI_R6_IMPACT',
        requirementId,
        originalBaselineId: 'CODEx_TEST_UI_R6_BASELINE_1',
        candidateBaselineId: baselineId,
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
      },
    },
  ],
  nextCursor: null,
  checkedAt: now,
};

type OperationsApi = RequirementsApi & {
  listGateCenter: ReturnType<typeof vi.fn>;
  listMaterialLibrary: ReturnType<typeof vi.fn>;
};

function api(): OperationsApi {
  return {
    ...requirementsApi,
    listRequirements: vi.fn(async () => ({
      items: [],
      nextCursor: null,
      partial: false,
      checkedAt: now,
    })),
    getRequirement: vi.fn(async () => detail),
    listGateCenter: vi.fn(async () => gateResponse),
    listMaterialLibrary: vi.fn(async () => materialResponse),
    listTimeline: vi.fn(async () => ({
      items: [],
      nextCursor: null,
      partial: false,
      checkedAt: now,
    })),
    subscribeToRequirementEvents: vi.fn(() => ({ close: vi.fn() })),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.sessionStorage.clear();
});

afterEach(() => cleanup());

describe('UI-R12 operations pages', () => {
  it('restores gate filters from a deep link before session state', async () => {
    window.sessionStorage.setItem(
      'pfc.gate-center.filters.v1',
      JSON.stringify({ view: 'CURRENT', status: 'PASS' }),
    );
    window.history.replaceState(
      null,
      '',
      '/gate-center?view=HISTORY&search=%E5%9B%9E%E6%BA%AF&stage=G5&status=BLOCK&mode=MANUAL',
    );
    const client = api();

    render(<App api={client} experienceMode />);

    await waitFor(() =>
      expect(client.listGateCenter).toHaveBeenLastCalledWith(
        {
          view: 'HISTORY',
          search: '回溯',
          stage: 'G5',
          status: 'BLOCK',
          mode: 'MANUAL',
          limit: 50,
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it('restores material filters from a deep link', async () => {
    window.history.replaceState(
      null,
      '',
      '/material-library?search=%E8%AE%BF%E8%B0%88&status=CANDIDATE&sourceType=USER_INTERVIEW&materialPurpose=FACT&sensitivity=INTERNAL',
    );
    const client = api();

    render(<App api={client} experienceMode />);

    await waitFor(() =>
      expect(client.listMaterialLibrary).toHaveBeenLastCalledWith(
        {
          search: '访谈',
          status: 'CANDIDATE',
          sourceType: 'USER_INTERVIEW',
          materialPurpose: 'FACT',
          sensitivity: 'INTERNAL',
          limit: 50,
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it('loads the next gate-center page on request', async () => {
    window.history.replaceState(null, '', '/gate-center');
    const client = api();
    client.listGateCenter.mockImplementation(async (query) =>
      query.cursor
        ? {
            ...gateResponse,
            items: [
              {
                ...gateResponse.items[0]!,
                key: 'CURRENT:CODEx_TEST_UI_R6_GATE_NEXT',
                requirementId: 'CODEx_TEST_UI_R6_GATE_NEXT',
                requirementName: '下一页门禁需求',
              },
            ],
            nextCursor: null,
          }
        : { ...gateResponse, nextCursor: '50' },
    );

    render(<App api={client} experienceMode />);

    await screen.findByRole('button', { name: '加载更多门禁记录' });
    fireEvent.click(screen.getByRole('button', { name: '加载更多门禁记录' }));
    expect(
      await screen.findByRole('button', { name: '下一页门禁需求' }),
    ).toBeTruthy();
    expect(client.listGateCenter).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '50', limit: 50 }),
    );
  });

  it('loads the next material-library page on request', async () => {
    window.history.replaceState(null, '', '/material-library');
    const client = api();
    client.listMaterialLibrary.mockImplementation(async (query) =>
      query.cursor
        ? {
            ...materialResponse,
            items: [
              {
                ...materialResponse.items[0]!,
                baselineId: 'CODEx_TEST_UI_R6_BASELINE_NEXT',
                requirementId: 'CODEx_TEST_UI_R6_MATERIAL_NEXT',
                requirementName: '下一页材料需求',
              },
            ],
            nextCursor: null,
          }
        : { ...materialResponse, nextCursor: '50' },
    );

    render(<App api={client} experienceMode />);

    await screen.findByRole('button', { name: '加载更多材料记录' });
    fireEvent.click(screen.getByRole('button', { name: '加载更多材料记录' }));
    expect(
      await screen.findByRole('button', { name: '下一页材料需求' }),
    ).toBeTruthy();
    expect(client.listMaterialLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '50', limit: 50 }),
    );
  });

  it('filters gate work, enters detail, and returns to the gate center', async () => {
    const client = api();
    render(<App api={client} experienceMode />);

    fireEvent.click(screen.getByRole('button', { name: '门禁中心' }));
    expect(
      await screen.findByRole('heading', { name: '门禁中心' }),
    ).toBeTruthy();
    const gatePage = screen.getByRole('region', {
      name: 'UI-R12 门禁中心',
    });
    expect(gatePage.classList.contains('pfc-reference-theme')).toBe(true);
    const execution = within(gatePage).getByRole('region', {
      name: '门禁执行概览',
    });
    expect(within(execution).getByText('当前结果')).toBeTruthy();
    expect(within(execution).getByText('需处理')).toBeTruthy();
    expect(
      within(gatePage).getByRole('button', { name: '刷新门禁' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '当前待办' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.change(screen.getByLabelText('门禁阶段'), {
      target: { value: 'G3' },
    });
    fireEvent.change(screen.getByLabelText('门禁状态'), {
      target: { value: 'WARN' },
    });
    fireEvent.change(screen.getByLabelText('运行模式'), {
      target: { value: 'AUTOMATIC' },
    });
    await waitFor(() =>
      expect(client.listGateCenter).toHaveBeenLastCalledWith(
        {
          view: 'CURRENT',
          search: '',
          stage: 'G3',
          status: 'WARN',
          mode: 'AUTOMATIC',
          limit: 50,
        },
        expect.any(AbortSignal),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: detail.name }));
    expect(
      await screen.findByRole('heading', { name: detail.name }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回门禁中心' }));
    expect(
      await screen.findByRole('heading', { name: '门禁中心' }),
    ).toBeTruthy();
    expect((screen.getByLabelText('门禁状态') as HTMLSelectElement).value).toBe(
      'WARN',
    );
  });

  it('shows candidate material refs and enters pending-impact handling', async () => {
    const client = api();
    render(<App api={client} experienceMode />);

    fireEvent.click(screen.getByRole('button', { name: '材料库' }));
    expect(await screen.findByRole('heading', { name: '材料库' })).toBeTruthy();
    const materialPage = screen.getByRole('region', {
      name: 'UI-R12 材料库',
    });
    expect(materialPage.classList.contains('pfc-reference-theme')).toBe(true);
    const baseline = within(materialPage).getByRole('region', {
      name: '材料基线概览',
    });
    expect(within(baseline).getByText('材料引用')).toBeTruthy();
    expect(within(baseline).getByText('待确认影响')).toBeTruthy();
    expect(
      within(materialPage).getByRole('button', { name: '刷新材料' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '全部材料' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByTitle('原始状态：CANDIDATE').textContent).toBe('候选');
    expect(screen.getByText('USER_INTERVIEW_NOTE')).toBeTruthy();
    expect(screen.getByText('待确认 · 建议回退 G1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '处理影响' }));

    expect(
      await screen.findByRole('heading', { name: detail.name }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe(`/requirements/${requirementId}`);
  });
});
