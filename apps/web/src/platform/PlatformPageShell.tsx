import type { ReactNode } from 'react';
import { LogOut, Workflow } from 'lucide-react';

import type { CurrentActorDto } from '@pfc/contracts';

import './platform-shell.css';

export function PlatformPageShell({
  actor,
  active,
  title,
  description,
  actions,
  children,
  jobsEnabled = false,
  onLogout,
}: {
  actor: CurrentActorDto;
  active: 'requirements' | 'gates' | 'materials' | 'jobs' | 'team';
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  jobsEnabled?: boolean;
  onLogout: () => void;
}) {
  const team = actor.teams.find((item) => item.id === actor.currentTeamId);
  return (
    <div className="platform-page">
      <header className="platform-header">
        <a className="platform-brand" href="/">
          <span aria-hidden="true">
            <Workflow size={19} strokeWidth={1.8} />
          </span>
          <strong>
            产品全链路<small>Product Flow</small>
          </strong>
        </a>
        <nav aria-label="主导航">
          <a
            aria-current={active === 'requirements' ? 'page' : undefined}
            href="/"
          >
            需求管理
          </a>
          <a
            aria-current={active === 'gates' ? 'page' : undefined}
            href="/gate-center"
          >
            门禁中心
          </a>
          <a
            aria-current={active === 'materials' ? 'page' : undefined}
            href="/material-library"
          >
            材料库
          </a>
          {jobsEnabled ? (
            <a
              aria-current={active === 'jobs' ? 'page' : undefined}
              href="/jobs"
            >
              作业
            </a>
          ) : null}
          <a
            aria-current={active === 'team' ? 'page' : undefined}
            href="/team-admin"
          >
            团队空间
          </a>
        </nav>
        <div className="platform-account">
          <span className="avatar">
            {actor.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{actor.displayName}</strong>
            <small>{team?.name ?? '未选择团队'}</small>
          </span>
          <button
            aria-label="退出登录"
            onClick={onLogout}
            title="退出登录"
            type="button"
          >
            <LogOut aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <main>
        <header className="platform-page-heading">
          <div>
            <p>本地工作空间 · PostgreSQL</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </div>
          {actions ? (
            <div className="platform-page-actions">{actions}</div>
          ) : null}
        </header>
        <div className="platform-page-content">{children}</div>
      </main>
    </div>
  );
}
