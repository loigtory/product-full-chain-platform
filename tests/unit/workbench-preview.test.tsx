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
import type { RequirementsApi } from '../../apps/web/src/requirements-api.ts';
import type {
  RequirementDetailDto,
  RequirementListItemDto,
} from '../../packages/contracts/src/index.ts';

const items: readonly RequirementListItemDto[] = [
  {
    id: 'CODEx_TEST_UI_R10_REQ_BLOCKED',
    name: '待补齐登记的渠道需求',
    currentStage: 'G0',
    gateProjection: 'BLOCK',
    ownerId: 'CODEx_TEST_UI_R10_OWNER_A',
    nextAction: '补齐 G0 登记',
    updatedAt: '2026-09-05T08:03:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
  {
    id: 'CODEx_TEST_UI_R10_REQ_WARN',
    name: '材料变更影响评估',
    currentStage: 'G3',
    gateProjection: 'WARN',
    ownerId: 'CODEx_TEST_UI_R10_OWNER_B',
    nextAction: '处理门禁警告',
    updatedAt: '2026-09-05T08:02:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
  {
    id: 'CODEx_TEST_UI_R10_REQ_READY',
    name: '可执行门禁的结算规则',
    currentStage: 'G6',
    gateProjection: 'NOT_STARTED',
    ownerId: 'CODEx_TEST_UI_R10_OWNER_C',
    nextAction: '运行当前门禁',
    updatedAt: '2026-09-05T08:01:00.000Z',
    dependencyStatus: 'AVAILABLE',
    warningCode: null,
  },
];

const detail: RequirementDetailDto = {
  id: items[1].id,
  name: items[1].name,
  originalIdea: '核对材料变化对当前产品需求和后续交付的影响。',
  initiatorId: 'CODEx_TEST_UI_R10_INITIATOR',
  businessOwnerId: items[1].ownerId,
  currentStage: 'G3',
  rowVersion: 2,
  registration: {
    sourceType: 'BUSINESS_FEEDBACK',
    businessOwnerId: items[1].ownerId,
    materialPurpose: 'CONSTRAINT',
    sensitivity: 'INTERNAL',
  },
  missingFields: [],
  gateProjection: 'WARN',
  currentBaseline: null,
  questions: [],
  currentGateRun: null,
  gateRuns: [],
  gateExecution: {
    status: 'AVAILABLE',
    capabilityVersion: 'fixture/ui-r10/v1',
    checkedAt: '2026-09-05T08:02:00.000Z',
    reasonCode: null,
  },
  createdAt: '2026-09-05T07:00:00.000Z',
  updatedAt: items[1].updatedAt,
};

function previewApi() {
  const write = vi.fn(async () => {
    throw new Error('UI-R10 preview must not call mutations.');
  });
  const listRequirements = vi.fn(async ({ search }: { search: string }) => ({
    items: items.filter((item) => item.name.includes(search)),
    nextCursor: null,
    partial: false,
    checkedAt: '2026-09-05T08:05:00.000Z',
  }));
  const getRequirement = vi.fn(async () => detail);
  const api = {
    listRequirements,
    getRequirement,
    createRequirement: write,
    completeG0Registration: write,
    getRequirementSubmission: write,
    answerQuestion: write,
    confirmQuestion: write,
    returnQuestion: write,
    supersedeQuestion: write,
    deferQuestion: write,
    startAutomaticGateRun: write,
    registerManualGateRun: write,
    getGateRun: write,
  } as unknown as RequirementsApi;
  return { api, getRequirement, listRequirements, write };
}

beforeEach(() => {
  window.history.replaceState(
    null,
    '',
    '/ui-preview/workbench?scope=ALL&view=TABLE&sort=UPDATED_DESC',
  );
});

afterEach(cleanup);

describe('UI-R11 read-only workbench preview', () => {
  it('uses the independent preview route and derives its overview from read-only results', async () => {
    const { api, listRequirements, write } = previewApi();
    render(<App api={api} experienceMode />);

    const main = await screen.findByRole('main', {
      name: 'UI-R11 需求工作台预览',
    });
    expect(within(main).getByText('本地数据库 · 只读')).toBeTruthy();
    expect(screen.getByRole('button', { name: '需求管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '门禁中心' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '材料库' })).toBeTruthy();
    expect(document.querySelector('.preview-source-status')).toBeNull();
    expect(within(main).getByLabelText('当前需求 3')).toBeTruthy();
    expect(within(main).getByLabelText('阻断项 1')).toBeTruthy();
    expect(within(main).getByLabelText('需关注 1')).toBeTruthy();
    expect(within(main).getAllByText('3 个阶段')).toHaveLength(2);
    expect(within(main).getByLabelText('需求分布摘要').textContent).toContain(
      '阶段推进3 个阶段G0最早阶段G6最前阶段3覆盖阶段',
    );
    expect(within(main).getByLabelText('需求分布摘要').textContent).toContain(
      '门禁态势2 项需处理1阻断1需关注1未开始',
    );
    expect(screen.queryByRole('button', { name: '新建需求' })).toBeNull();
    expect(listRequirements).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ALL', search: '', limit: 50 }),
      expect.any(AbortSignal),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('persists filters and opens a read-only detail panel with focus restoration', async () => {
    const { api, getRequirement, listRequirements, write } = previewApi();
    render(<App api={api} experienceMode />);
    await screen.findByRole('button', {
      name: /材料变更影响评估/,
    });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索需求' }), {
      target: { value: '材料' },
    });
    await waitFor(() =>
      expect(listRequirements).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '材料' }),
        expect.any(AbortSignal),
      ),
    );
    expect(window.location.search).toContain('search=%E6%9D%90%E6%96%99');

    fireEvent.click(screen.getByRole('button', { name: '按阶段' }));
    expect(await screen.findByTestId('preview-stage-board')).toBeTruthy();
    expect(window.location.search).toContain('view=STAGE');

    const stageTrigger = screen.getByRole('button', {
      name: /材料变更影响评估/,
    });
    stageTrigger.focus();
    fireEvent.click(stageTrigger);
    const detailPanel = await screen.findByRole('complementary', {
      name: '需求详情',
    });
    expect(getRequirement).toHaveBeenCalledWith(
      items[1].id,
      expect.any(AbortSignal),
    );
    expect(within(detailPanel).getByText(detail.originalIdea)).toBeTruthy();
    expect(within(detailPanel).getByText('只读详情')).toBeTruthy();
    expect(window.location.search).toContain(`selected=${items[1].id}`);

    fireEvent.click(
      within(detailPanel).getByRole('button', { name: '关闭需求详情' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: '需求详情' }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(stageTrigger);
    expect(window.location.search).not.toContain('selected=');
    expect(write).not.toHaveBeenCalled();
  });
});
