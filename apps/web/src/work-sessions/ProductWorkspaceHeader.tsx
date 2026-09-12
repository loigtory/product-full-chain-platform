import { Bot, LogOut, RefreshCw, Workflow } from 'lucide-react';

import type { CurrentActorDto } from '@pfc/contracts';
import { Button, GlobalHeader, PrimaryNav } from '@pfc/ui';

const navigation = [
  { label: '我的工作台', value: 'MY_WORK' },
  { label: '产品空间', value: 'PRODUCT_SPACE' },
  { label: '交付中心', value: 'DELIVERY' },
  { label: '治理中心', value: 'GOVERNANCE' },
] as const;

export function ProductWorkspaceHeader({
  actor,
  onLogout,
  onRefresh,
  refreshing,
}: {
  actor: CurrentActorDto;
  onLogout: () => void;
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  const team = actor.teams.find((item) => item.id === actor.currentTeamId);

  function navigate(value: (typeof navigation)[number]['value']) {
    if (value === 'PRODUCT_SPACE') return;
    if (value === 'MY_WORK') window.location.assign('/');
    if (value === 'DELIVERY') window.location.assign('/jobs');
    if (value === 'GOVERNANCE') window.location.assign('/gate-center');
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
        <Button
          aria-label="刷新 AI 工作空间"
          disabled={!onRefresh}
          icon={<RefreshCw aria-hidden="true" size={17} strokeWidth={1.8} />}
          loading={refreshing}
          onClick={onRefresh}
          size="icon"
          title="刷新 AI 工作空间"
          variant="secondary"
        />
      }
      brand={
        <div className="header-brand operations-header-brand">
          <span aria-hidden="true">
            <Workflow size={20} strokeWidth={1.8} />
          </span>
          <strong>
            产品全链路<small>AI Product Flow</small>
          </strong>
        </div>
      }
      className="pfc-reference-header"
      data-module="requirements"
      density="compact"
      navigation={
        <PrimaryNav
          ariaLabel="平台主导航"
          onChange={navigate}
          options={navigation.map((item) =>
            item.value === 'PRODUCT_SPACE'
              ? {
                  ...item,
                  icon: <Bot aria-hidden="true" size={15} strokeWidth={1.8} />,
                }
              : item,
          )}
          value="PRODUCT_SPACE"
        />
      }
    />
  );
}
