import { Columns3, LayoutList } from 'lucide-react';

import type {
  G0RegistrationDto,
  MaterialPurpose,
  MaterialSourceType,
  RequirementListScope,
  RequirementListView,
  SensitivityLevel,
} from '@pfc/contracts';
import type { SegmentedOption } from '@pfc/ui';

import { createUiIdempotencyKey } from '../idempotency.ts';
import type { PlatformNavigationPage } from '../platform/navigation.ts';
import { platformNavigationOptions } from '../platform/navigation.ts';
import { RequirementsApiError } from '../requirements-api.ts';

export const stages = Array.from({ length: 13 }, (_, index) => `G${index}`);

export const sourceOptions: ReadonlyArray<
  readonly [MaterialSourceType, string]
> = [
  ['BUSINESS_FEEDBACK', '业务反馈'],
  ['USER_INTERVIEW', '用户访谈'],
  ['OPERATIONS_ISSUE', '运营问题'],
  ['INTERNAL_IMPROVEMENT', '内部改进'],
  ['POLICY_OR_COMPLIANCE', '政策或合规'],
  ['OTHER', '其他'],
];

export const purposeOptions: ReadonlyArray<readonly [MaterialPurpose, string]> =
  [
    ['FACT', '事实依据'],
    ['CONSTRAINT', '约束条件'],
    ['ASSUMPTION', '待验证假设'],
    ['HISTORICAL_DESIGN', '历史设计'],
    ['REGRESSION_SAMPLE', '回归样本'],
  ];

export const sensitivityOptions: ReadonlyArray<
  readonly [SensitivityLevel, string, string]
> = [
  [
    'INTERNAL',
    '内部普通',
    '授权团队或需求成员可查看；仅进入已批准的 AI/Skill；不代表发布授权',
  ],
  [
    'RESTRICTED',
    '内部受限',
    '须有显式成员权限和本次动作授权；否则拒绝；不代表发布授权',
  ],
  ['PUBLIC', '可公开', '仍校验需求权限；不会自动匿名发布或对外传播'],
];

export const missingFieldLabels: Readonly<Record<string, string>> = {
  sourceType: '来源',
  sourceDescription: '来源说明',
  businessOwnerId: '业务责任人',
  materialPurpose: '材料用途',
  sensitivity: '敏感边界',
};

export type RegistrationForm = {
  sourceType: MaterialSourceType | '';
  sourceDescription: string;
  businessOwnerId: string;
  materialPurpose: MaterialPurpose | '';
  sensitivity: SensitivityLevel | '';
};

export type CreateForm = RegistrationForm & {
  name: string;
  originalIdea: string;
};

export const emptyRegistration: RegistrationForm = {
  sourceType: '',
  sourceDescription: '',
  businessOwnerId: '',
  materialPurpose: '',
  sensitivity: '',
};

export const emptyCreate: CreateForm = {
  name: '',
  originalIdea: '',
  ...emptyRegistration,
};

export const experienceActorId = 'CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS';

export const requirementScopeOptions: readonly SegmentedOption<RequirementListScope>[] =
  [
    { label: '全部需求', value: 'ALL' },
    { label: '待我处理', value: 'MINE' },
    { label: '阻断项', value: 'BLOCKED' },
  ];

export const requirementViewOptions: readonly SegmentedOption<RequirementListView>[] =
  [
    {
      icon: <LayoutList aria-hidden="true" size={15} strokeWidth={1.8} />,
      label: '表格',
      value: 'TABLE',
    },
    {
      icon: <Columns3 aria-hidden="true" size={15} strokeWidth={1.8} />,
      label: '按阶段',
      value: 'STAGE',
    },
  ];

export type WorkspacePage = PlatformNavigationPage;

export const workspaceNavigationOptions = platformNavigationOptions;

export function routeWorkspacePage(): WorkspacePage {
  if (window.location.pathname === '/gate-center') return 'GATE_CENTER';
  if (window.location.pathname === '/material-library') {
    return 'MATERIAL_LIBRARY';
  }
  if (/^\/requirements\/[^/]+$/.test(window.location.pathname)) {
    const from = new URLSearchParams(window.location.search).get('from');
    if (from === 'gate-center') return 'GATE_CENTER';
    if (from === 'material-library') return 'MATERIAL_LIBRARY';
  }
  return 'WORKBENCH';
}

export function pageTitle(page: WorkspacePage): string {
  if (page === 'TEAM_ADMIN') return '团队空间';
  if (page === 'AGENT_RUNS') return '受控作业';
  if (page === 'GATE_CENTER') return '门禁中心';
  if (page === 'MATERIAL_LIBRARY') return '材料库';
  return '需求工作台';
}

export function idempotencyKey(action: 'CREATE' | 'COMPLETE'): string {
  return createUiIdempotencyKey(action);
}

export function routeRequirementId(): string | null {
  const match = /^\/requirements\/([^/]+)$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function routeListState(): {
  scope: RequirementListScope;
  view: RequirementListView;
  search: string;
} {
  const query = new URLSearchParams(window.location.search);
  const rawScope = query.get('scope');
  const rawView = query.get('view');
  let retained: Partial<{
    scope: RequirementListScope;
    view: RequirementListView;
    search: string;
  }> = {};
  try {
    retained = JSON.parse(
      window.sessionStorage.getItem('pfc.workbench.view.v1') ?? '{}',
    ) as typeof retained;
  } catch {
    retained = {};
  }
  return {
    scope:
      rawScope === 'MINE' || rawScope === 'BLOCKED' || rawScope === 'ALL'
        ? rawScope
        : retained.scope === 'MINE' || retained.scope === 'BLOCKED'
          ? retained.scope
          : 'ALL',
    view:
      rawView === 'STAGE' || rawView === 'TABLE'
        ? rawView
        : retained.view === 'STAGE'
          ? 'STAGE'
          : 'TABLE',
    search: query.has('search')
      ? (query.get('search') ?? '')
      : (retained.search ?? ''),
  };
}

export function compactRegistration(form: RegistrationForm): G0RegistrationDto {
  return {
    sourceType: form.sourceType || null,
    sourceDescription: form.sourceDescription.trim() || null,
    businessOwnerId: form.businessOwnerId.trim() || null,
    materialPurpose: form.materialPurpose || null,
    sensitivity: form.sensitivity || null,
  };
}

export function friendlyTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function friendlyOwner(ownerId: string): string {
  return ownerId === experienceActorId ? '全权限体验账号' : ownerId;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RequirementsApiError) {
    if (error.code === 'PERMISSION_DENIED') return '你没有查看该需求的权限';
    if (error.code === 'VERSION_CONFLICT') {
      return '需求已被更新，请刷新后再补充';
    }
    if (error.code === 'DEPENDENCY_UNAVAILABLE') return '需求服务暂时不可用';
    return error.message;
  }
  return '服务暂时不可用，请稍后刷新';
}
