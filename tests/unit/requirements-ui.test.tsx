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
  RequirementsApiError,
  RequirementSubmissionUnknownError,
  type RequirementsApi,
} from '../../apps/web/src/requirements-api.ts';
import type {
  RequirementDetailDto,
  RequirementListItemDto,
} from '../../packages/contracts/src/index.ts';

const incompleteDetail: RequirementDetailDto = {
  id: 'CODEx_TEST_T3_UI_REQ_INCOMPLETE',
  name: '渠道需求优先级规则',
  originalIdea: '需要统一各渠道需求的优先处理方式。',
  initiatorId: 'CODEx_TEST_T3_UI_ACTOR_PM',
  businessOwnerId: null,
  currentStage: 'G0',
  rowVersion: 0,
  registration: {},
  missingFields: [
    'sourceType',
    'businessOwnerId',
    'materialPurpose',
    'sensitivity',
  ],
  gateProjection: 'BLOCK',
  currentBaseline: null,
  questions: [],
  currentGateRun: null,
  gateRuns: [],
  gateExecution: {
    status: 'UNAVAILABLE',
    capabilityVersion: 'fixture/t5/v1',
    checkedAt: '2026-09-05T02:00:00.000Z',
    reasonCode: 'CAPABILITY_NOT_CONFIGURED',
  },
  createdAt: '2026-09-05T02:00:00.000Z',
  updatedAt: '2026-09-05T02:00:00.000Z',
};

const completeDetail: RequirementDetailDto = {
  ...incompleteDetail,
  rowVersion: 1,
  businessOwnerId: 'CODEx_TEST_T3_UI_ACTOR_OWNER',
  registration: {
    sourceType: 'OTHER',
    sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
    businessOwnerId: 'CODEx_TEST_T3_UI_ACTOR_OWNER',
    materialPurpose: 'CONSTRAINT',
    sensitivity: 'RESTRICTED',
  },
  missingFields: [],
  gateProjection: 'NOT_STARTED',
  currentBaseline: {
    id: 'CODEx_TEST_T3_UI_BASELINE_1',
    versionNumber: 1,
    sourceType: 'OTHER',
    sourceDescription: '来自跨部门专题讨论，原分类无法准确覆盖',
    materialPurpose: 'CONSTRAINT',
    sensitivity: 'RESTRICTED',
    confirmedBy: 'CODEx_TEST_T3_UI_ACTOR_PM',
    confirmedAt: '2026-09-05T02:05:00.000Z',
  },
};

const listItem: RequirementListItemDto = {
  id: incompleteDetail.id,
  name: incompleteDetail.name,
  currentStage: 'G0',
  gateProjection: 'BLOCK',
  ownerId: '待补充',
  nextAction: '补齐 G0 登记',
  updatedAt: incompleteDetail.updatedAt,
  dependencyStatus: 'AVAILABLE',
  warningCode: null,
};

function fakeApi(overrides: Partial<RequirementsApi> = {}): RequirementsApi {
  return {
    listRequirements: vi.fn(async ({ search }) => ({
      items: search ? [] : [listItem],
      nextCursor: null,
      partial: false,
      checkedAt: '2026-09-05T02:00:00.000Z',
    })),
    getRequirement: vi.fn(async () => incompleteDetail),
    createRequirement: vi.fn(async () => ({
      replayed: false,
      requirement: incompleteDetail,
    })),
    completeG0Registration: vi.fn(async () => ({
      replayed: false,
      requirement: completeDetail,
    })),
    getRequirementSubmission: vi.fn(
      async () =>
        ({
          status: 'NOT_FOUND',
          existingResourceId: null,
        }) as const,
    ),
    answerQuestion: vi.fn(async () => {
      throw new Error('Question mutation is not used in this test.');
    }),
    confirmQuestion: vi.fn(async () => {
      throw new Error('Question mutation is not used in this test.');
    }),
    returnQuestion: vi.fn(async () => {
      throw new Error('Question mutation is not used in this test.');
    }),
    supersedeQuestion: vi.fn(async () => {
      throw new Error('Question mutation is not used in this test.');
    }),
    deferQuestion: vi.fn(async () => {
      throw new Error('Question mutation is not used in this test.');
    }),
    startAutomaticGateRun: vi.fn(async () => {
      throw new Error('GateRun mutation is not used in this test.');
    }),
    registerManualGateRun: vi.fn(async () => {
      throw new Error('GateRun mutation is not used in this test.');
    }),
    getGateRun: vi.fn(async () => {
      throw new Error('GateRun lookup is not used in this test.');
    }),
    ...overrides,
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('T3 requirements PC workbench', () => {
  it('makes the database-backed full-permission experience boundary visible', async () => {
    render(<App api={fakeApi()} experienceMode />);
    await screen.findByText('渠道需求优先级规则');

    expect(screen.getByText('本地数据库体验')).toBeTruthy();
    expect(screen.getByText('全权限体验')).toBeTruthy();
    expect(screen.getByRole('button', { name: '门禁中心' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '材料库' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '全部需求' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByText('渠道需求优先级规则'));
    fireEvent.click(
      await screen.findByRole('button', { name: '补齐 G0 信息' }),
    );
    const owner = screen.getByLabelText('业务责任人') as HTMLInputElement;
    expect(owner.value).toBe('CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS');
    expect(owner.readOnly).toBe(true);
  });

  it('keeps the create dialog keyboard-contained and restores its trigger focus', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('渠道需求优先级规则');
    const trigger = screen.getByRole('button', { name: '新建需求' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '新建需求' });
    const close = within(dialog).getByRole('button', { name: '关闭' });
    const save = within(dialog).getByRole('button', { name: '保存草稿' });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('textbox', { name: '需求名称' }),
    );

    save.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '新建需求' })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('renders the desktop-width compatibility notice for CSS-controlled display', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('渠道需求优先级规则');

    expect(screen.getByText('CAP-PFC-01 · 本地工作区')).toBeTruthy();
    expect(
      screen.getByText('当前工作台需要至少 1120px 的桌面显示宽度'),
    ).toBeTruthy();
  });

  it('renders the worklist, switches to stage grouping, and keeps empty search recoverable', async () => {
    render(<App api={fakeApi()} />);

    const requirement = await screen.findByText('渠道需求优先级规则');
    const controls = document.querySelector('.worklist-controls');
    expect(controls).toBeTruthy();
    expect(
      controls?.contains(screen.getByRole('button', { name: '全部需求' })),
    ).toBe(true);
    expect(
      controls?.contains(screen.getByRole('searchbox', { name: '搜索需求' })),
    ).toBe(true);
    expect(
      controls?.contains(screen.getByRole('button', { name: '表格' })),
    ).toBe(true);
    expect(
      document
        .querySelector('.pfc-global-header')
        ?.getAttribute('data-density'),
    ).toBe('compact');
    expect(
      document.querySelector('.pfc-page-intro')?.getAttribute('data-density'),
    ).toBe('compact');
    expect(requirement.getAttribute('title')).toBe(listItem.id);
    expect(screen.queryByText(listItem.id)).toBeNull();
    expect(screen.getByText('当前阶段')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '按阶段' }));
    expect(screen.getByTestId('stage-board').textContent).toContain('G0');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索需求' }), {
      target: { value: '无匹配项' },
    });
    expect(await screen.findByText('没有匹配的需求')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(await screen.findByText('渠道需求优先级规则')).toBeTruthy();
  });

  it('presents localized work status and exposes the lifecycle state', async () => {
    render(<App api={fakeApi()} />);

    const requirement = await screen.findByText('渠道需求优先级规则');
    expect(screen.getByText('共 1 条需求')).toBeTruthy();
    expect(screen.getByText('阻断')).toBeTruthy();

    fireEvent.click(requirement);
    const lifecycle = await screen.findByRole('navigation', {
      name: '需求生命周期',
    });
    const currentStage = within(lifecycle).getByText('G0');
    expect(currentStage.getAttribute('aria-current')).toBe('step');
    expect(currentStage.getAttribute('data-state')).toBe('blocked');
  });

  it('validates only name and original idea before creating an incomplete draft', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('渠道需求优先级规则');
    fireEvent.click(screen.getByRole('button', { name: '新建需求' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByText('请填写需求名称')).toBeTruthy();
    expect(screen.getByText('请填写原始想法')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('需求名称'), {
      target: { value: incompleteDetail.name },
    });
    fireEvent.change(screen.getByLabelText('原始想法'), {
      target: { value: incompleteDetail.originalIdea },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('补齐 G0 登记信息')).toBeTruthy();
    expect(screen.getByText('阻断')).toBeTruthy();
    expect(screen.getByText('来源')).toBeTruthy();
    expect(screen.getByText('业务责任人')).toBeTruthy();
    expect(screen.getByText('材料用途')).toBeTruthy();
    expect(screen.getByText('敏感边界')).toBeTruthy();
    expect(document.body.textContent).not.toContain('G0 PASS');
  });

  it('allows an OTHER source without a description on first save and exposes all sensitivity meanings', async () => {
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByText('渠道需求优先级规则');
    fireEvent.click(screen.getByRole('button', { name: '新建需求' }));
    fireEvent.change(screen.getByLabelText('需求名称'), {
      target: { value: incompleteDetail.name },
    });
    fireEvent.change(screen.getByLabelText('原始想法'), {
      target: { value: incompleteDetail.originalIdea },
    });
    fireEvent.click(screen.getByText('同时填写 G0 登记信息'));
    fireEvent.change(screen.getByLabelText('来源'), {
      target: { value: 'OTHER' },
    });

    expect(screen.getByText(/仅进入已批准的 AI\/Skill/)).toBeTruthy();
    expect(screen.getByText(/须有显式成员权限和本次动作授权/)).toBeTruthy();
    expect(screen.getByText(/不会自动匿名发布或对外传播/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.createRequirement).toHaveBeenCalled());
    expect(api.createRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        registration: expect.objectContaining({
          sourceType: 'OTHER',
          sourceDescription: null,
        }),
      }),
      expect.any(String),
    );
  });

  it('shows a permission result without rendering the protected body', async () => {
    const api = fakeApi({
      getRequirement: vi.fn(async () => {
        throw new RequirementsApiError({
          code: 'PERMISSION_DENIED',
          message: '你没有执行此操作的权限。',
          requestId: 'CODEx_TEST_T3_UI_REQUEST',
          retryable: false,
          recoveryAction: 'RETURN_TO_WORKLIST',
        });
      }),
    });
    render(<App api={api} />);
    const name = await screen.findByText('渠道需求优先级规则');
    fireEvent.click(name);

    expect(await screen.findByText('你没有查看该需求的权限')).toBeTruthy();
    expect(document.body.textContent).not.toContain('protected-original-idea');
  });

  it('completes the G0 registration without changing name or original idea', async () => {
    render(<App api={fakeApi()} />);
    fireEvent.click(await screen.findByText('渠道需求优先级规则'));
    expect(await screen.findByText('补齐 G0 登记信息')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '补齐 G0 信息' }));
    expect(
      (screen.getByLabelText('需求名称') as HTMLInputElement).readOnly,
    ).toBe(true);
    expect(
      (screen.getByLabelText('原始想法') as HTMLTextAreaElement).readOnly,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('来源'), {
      target: { value: 'OTHER' },
    });
    fireEvent.change(screen.getByLabelText('来源说明'), {
      target: { value: '来自跨部门专题讨论，原分类无法准确覆盖' },
    });
    fireEvent.change(screen.getByLabelText('业务责任人'), {
      target: { value: 'CODEx_TEST_T3_UI_ACTOR_OWNER' },
    });
    fireEvent.change(screen.getByLabelText('材料用途'), {
      target: { value: 'CONSTRAINT' },
    });
    fireEvent.click(screen.getByLabelText('内部受限'));
    fireEvent.click(screen.getByRole('button', { name: '保存补充' }));

    expect(await screen.findByText('G0 登记已完整')).toBeTruthy();
    expect(screen.getAllByText('未开始').length).toBeGreaterThan(0);
    expect(
      screen.getByText('来自跨部门专题讨论，原分类无法准确覆盖'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('G0 PASS');
  });

  it('turns an unknown create result into read-only verification before navigation', async () => {
    const api = fakeApi({
      createRequirement: vi.fn(async (_input, key) => {
        throw new RequirementSubmissionUnknownError(key);
      }),
      getRequirementSubmission: vi.fn(
        async () =>
          ({
            status: 'CREATED',
            existingResourceId: incompleteDetail.id,
          }) as const,
      ),
    });
    render(<App api={api} />);
    await screen.findByText('渠道需求优先级规则');
    fireEvent.click(screen.getByRole('button', { name: '新建需求' }));
    fireEvent.change(screen.getByLabelText('需求名称'), {
      target: { value: incompleteDetail.name },
    });
    fireEvent.change(screen.getByLabelText('原始想法'), {
      target: { value: incompleteDetail.originalIdea },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText('保存结果待核验')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '再次提交' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核验保存结果' }));
    await waitFor(() => expect(api.getRequirement).toHaveBeenCalled());
    expect(await screen.findByText('补齐 G0 登记信息')).toBeTruthy();
  });

  it('re-enables submission only after unknown-result verification confirms no draft exists', async () => {
    const api = fakeApi({
      createRequirement: vi.fn(async (_input, key) => {
        throw new RequirementSubmissionUnknownError(key);
      }),
      getRequirementSubmission: vi.fn(
        async () =>
          ({
            status: 'NOT_FOUND',
            existingResourceId: null,
          }) as const,
      ),
    });
    render(<App api={api} />);
    await screen.findByText('渠道需求优先级规则');
    fireEvent.click(screen.getByRole('button', { name: '新建需求' }));
    fireEvent.change(screen.getByLabelText('需求名称'), {
      target: { value: incompleteDetail.name },
    });
    fireEvent.change(screen.getByLabelText('原始想法'), {
      target: { value: incompleteDetail.originalIdea },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    const saveButton = await screen.findByRole('button', { name: '保存草稿' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '核验保存结果' }));
    expect(
      await screen.findByText('未发现已保存的需求，可以重新提交'),
    ).toBeTruthy();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });
});
