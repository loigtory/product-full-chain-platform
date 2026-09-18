import { LogOut, Plus, Workflow } from 'lucide-react';

import type { CurrentActorDto } from '@pfc/contracts';
import { Button, GlobalHeader, PrimaryNav } from '@pfc/ui';

import { workspaceNavigationOptions, type WorkspacePage } from './model.tsx';

export function WorkbenchHeader({
  actor,
  experienceMode,
  jobsEnabled,
  onCreate,
  onLogout,
  onNavigate,
  operationsRoute,
  page,
}: {
  actor?: CurrentActorDto;
  experienceMode: boolean;
  jobsEnabled: boolean;
  onCreate: () => void;
  onLogout?: () => void;
  onNavigate: (page: WorkspacePage) => void;
  operationsRoute: boolean;
  page: WorkspacePage;
}) {
  return (
    <GlobalHeader
      account={
        <span className="header-account">
          <span className="avatar">PM</span>
          <span>
            {experienceMode
              ? '全权限体验'
              : (actor?.displayName ?? '产品负责人')}
            <small>
              {experienceMode
                ? operationsRoute
                  ? '本地体验空间'
                  : 'PFC_EXPERIENCE'
                : (actor?.teams.find((team) => team.id === actor.currentTeamId)
                    ?.name ?? 'LOCAL')}
            </small>
          </span>
          {onLogout ? (
            <button
              aria-label="退出登录"
              className="header-icon-action"
              onClick={onLogout}
              title="退出登录"
              type="button"
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </span>
      }
      actions={
        <>
          <Button
            aria-label="预算报表"
            onClick={() => window.location.assign('/budget')}
            variant="secondary"
          >
            预算
          </Button>
          <Button
            aria-label="新建需求"
            icon={<Plus aria-hidden="true" size={17} strokeWidth={2} />}
            onClick={onCreate}
          >
            新建需求
          </Button>
        </>
      }
      brand={
        <div
          className={`header-brand ${operationsRoute ? 'operations-header-brand' : ''}`.trim()}
        >
          <span aria-hidden="true">
            <Workflow size={20} strokeWidth={1.8} />
          </span>
          <strong>
            产品全链路<small>Product Flow</small>
          </strong>
        </div>
      }
      className={
        operationsRoute ? 'pfc-reference-theme pfc-reference-header' : ''
      }
      density={page === 'WORKBENCH' ? 'compact' : 'default'}
      navigation={
        <PrimaryNav
          ariaLabel="主导航"
          onChange={onNavigate}
          options={workspaceNavigationOptions(jobsEnabled)}
          value={page}
        />
      }
      data-module={
        page === 'GATE_CENTER'
          ? 'gates'
          : page === 'MATERIAL_LIBRARY'
            ? 'materials'
            : page === 'AGENT_RUNS'
              ? 'agents'
              : 'requirements'
      }
    />
  );
}
