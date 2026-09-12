import { Bot, LogOut, RefreshCw, Workflow } from 'lucide-react';

import type { CurrentActorDto } from '@pfc/contracts';
import { Button, GlobalHeader, PrimaryNav } from '@pfc/ui';

import {
  platformNavigationOptions,
  type PlatformNavigationPage,
} from '../platform/navigation.ts';

export function AgentRunsHeader({
  actor,
  jobsEnabled,
  onLogout,
  onRefresh,
}: {
  actor: CurrentActorDto;
  jobsEnabled: boolean;
  onLogout: () => void;
  onRefresh?: () => void;
}) {
  const team = actor.teams.find((item) => item.id === actor.currentTeamId);

  function navigate(page: PlatformNavigationPage) {
    if (page === 'AGENT_RUNS') return;
    if (page === 'GATE_CENTER') window.location.assign('/gate-center');
    else if (page === 'MATERIAL_LIBRARY') {
      window.location.assign('/material-library');
    } else if (page === 'TEAM_ADMIN') window.location.assign('/team-admin');
    else window.location.assign('/');
  }

  return (
    <GlobalHeader
      account={
        <span className="header-account">
          <span className="avatar">
            {actor.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {actor.displayName}
            <small>{team?.name ?? '未选择团队'}</small>
          </span>
          <button
            aria-label="退出登录"
            className="header-icon-action"
            onClick={onLogout}
            title="退出登录"
            type="button"
          >
            <LogOut aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </span>
      }
      actions={
        onRefresh ? (
          <Button
            aria-label="刷新作业数据"
            icon={<RefreshCw aria-hidden="true" size={17} strokeWidth={1.8} />}
            onClick={onRefresh}
            size="icon"
            title="刷新作业数据"
            variant="secondary"
          />
        ) : null
      }
      brand={
        <div className="header-brand operations-header-brand">
          <span aria-hidden="true">
            <Workflow size={20} strokeWidth={1.8} />
          </span>
          <strong>
            产品全链路<small>Product Flow</small>
          </strong>
        </div>
      }
      className="pfc-reference-header"
      data-module="agents"
      density="compact"
      navigation={
        <PrimaryNav
          ariaLabel="主导航"
          onChange={navigate}
          options={platformNavigationOptions(jobsEnabled).map((option) =>
            option.value === 'AGENT_RUNS'
              ? {
                  ...option,
                  icon: <Bot aria-hidden="true" size={15} strokeWidth={1.8} />,
                }
              : option,
          )}
          value="AGENT_RUNS"
        />
      }
    />
  );
}
