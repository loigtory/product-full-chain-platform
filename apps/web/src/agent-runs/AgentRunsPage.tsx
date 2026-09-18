import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Search,
} from 'lucide-react';

import type {
  AgentControlAction,
  AgentRunDto,
  AgentRunEventDto,
  CurrentActorDto,
  SkillReleaseDto,
} from '@pfc/contracts';
import {
  EmptyState,
  FilterToolbar,
  MetricCard,
  MetricGrid,
  PageIntro,
  SearchField,
  SubNav,
} from '@pfc/ui';

import { AgentRunDetail } from './AgentRunDetail.tsx';
import { AgentRunList } from './AgentRunList.tsx';
import { AgentRunsHeader } from './AgentRunsHeader.tsx';
import { AgentAuditPanel } from './AgentAuditPanel.tsx';
import { ApprovalInbox } from './ApprovalInbox.tsx';
import { BridgeCenter } from './BridgeCenter.tsx';
import { agentRunsApi, type AgentRunsApi } from './api.ts';
import { routeAgentRunId } from './model.ts';
import { SkillCatalog } from './SkillCatalog.tsx';
import { StageCapabilityConfigPanel } from './StageCapabilityConfigPanel.tsx';
import './agent-runs.css';

type AgentRunsView =
  | 'RUNS'
  | 'APPROVALS'
  | 'BRIDGES'
  | 'SKILLS'
  | 'CAPABILITIES'
  | 'AUDIT';

function initialView(): AgentRunsView {
  const value = new URLSearchParams(window.location.search).get('view');
  if (value === 'skills') return 'SKILLS';
  if (value === 'capabilities') return 'CAPABILITIES';
  if (value === 'bridges') return 'BRIDGES';
  if (value === 'approvals') return 'APPROVALS';
  if (value === 'audit') return 'AUDIT';
  return 'RUNS';
}

export { type AgentRunsApi } from './api.ts';

export function AgentRunsPage({
  actor,
  api = agentRunsApi,
  onLogout,
}: {
  actor: CurrentActorDto;
  api?: AgentRunsApi;
  onLogout: () => void;
}) {
  const [view, setView] = useState<AgentRunsView>(initialView);
  const [items, setItems] = useState<readonly AgentRunDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(routeAgentRunId);
  const [run, setRun] = useState<AgentRunDto | null>(null);
  const [events, setEvents] = useState<readonly AgentRunEventDto[]>([]);
  const [skills, setSkills] = useState<readonly SkillReleaseDto[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(selectedId));
  const [skillsLoading, setSkillsLoading] = useState(
    () => initialView() === 'SKILLS',
  );
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void api
      .listRuns()
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setSelectedId((current) => {
          const next = current ?? response.items[0]?.id ?? null;
          if (next && next !== current) setDetailLoading(true);
          return next;
        });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '运行记录读取失败。',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);

  useEffect(() => {
    if (!selectedId || view !== 'RUNS') return;
    let active = true;
    void Promise.all([api.getRun(selectedId), api.listEvents(selectedId)])
      .then(([nextRun, response]) => {
        if (!active) return;
        setRun(nextRun);
        setEvents(response.items);
        setError(null);
        window.history.replaceState(
          null,
          '',
          `/jobs/${encodeURIComponent(nextRun.id)}`,
        );
      })
      .catch((reason: unknown) => {
        if (active) {
          setRun(null);
          setEvents([]);
          setError(
            reason instanceof Error ? reason.message : '运行详情读取失败。',
          );
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, selectedId, view, revision]);

  useEffect(() => {
    if (view !== 'SKILLS') return;
    let active = true;
    void api
      .listSkills()
      .then((response) => {
        if (active) {
          setSkills(response.items);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Skill 目录读取失败。',
          );
        }
      })
      .finally(() => {
        if (active) setSkillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, view, revision]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return items;
    return items.filter((item) =>
      [item.id, item.requirementId, item.status, item.resultSummary ?? '']
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(keyword),
    );
  }, [items, search]);

  const metrics = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) =>
        ['QUEUED', 'STARTING', 'RUNNING', 'VERIFYING'].includes(item.status),
      ).length,
      succeeded: items.filter((item) => item.status === 'SUCCEEDED').length,
      attention: items.filter((item) =>
        ['WAITING_INPUT', 'WAITING_APPROVAL', 'UNKNOWN', 'FAILED'].includes(
          item.status,
        ),
      ).length,
    }),
    [items],
  );
  const activeRunCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (
        item.bridgeId &&
        [
          'STARTING',
          'RUNNING',
          'WAITING_APPROVAL',
          'CANCELLING',
          'VERIFYING',
          'UNKNOWN',
        ].includes(item.status)
      ) {
        counts[item.bridgeId] = (counts[item.bridgeId] ?? 0) + 1;
      }
    }
    return counts;
  }, [items]);

  function changeView(next: AgentRunsView) {
    if (next === 'SKILLS') setSkillsLoading(true);
    setView(next);
    setError(null);
    window.history.replaceState(
      null,
      '',
      next === 'RUNS'
        ? selectedId
          ? `/jobs/${encodeURIComponent(selectedId)}`
          : '/jobs'
        : `/jobs?view=${next.toLocaleLowerCase('en-US')}`,
    );
  }

  function refresh() {
    setLoading(true);
    if (view === 'RUNS' && selectedId) setDetailLoading(true);
    if (view === 'SKILLS') setSkillsLoading(true);
    setRevision((value) => value + 1);
  }

  function selectRun(runId: string) {
    setDetailLoading(true);
    setSelectedId(runId);
  }

  async function controlRun(action: AgentControlAction, reasonCode: string) {
    if (!run) return;
    setError(null);
    try {
      const response = await api.controlRun(run.id, run.rowVersion, {
        action,
        reasonCode,
      });
      setRun(response.childRun ?? response.run);
      setSelectedId((response.childRun ?? response.run).id);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '运行控制失败。');
      throw reason;
    }
  }

  return (
    <div className="pfc-reference-theme agent-runs-page">
      <a className="skip-link" href="#agent-runs-main">
        跳到主要内容
      </a>
      <AgentRunsHeader
        actor={actor}
        jobsEnabled
        onLogout={onLogout}
        onRefresh={refresh}
      />
      <main id="agent-runs-main" tabIndex={-1}>
        <PageIntro
          context="POD-PFC-001 · M2-R2"
          description="在固定基线与范围胶囊内运行只读检查和受控工作区写入。"
          icon={<Bot aria-hidden="true" size={28} strokeWidth={1.8} />}
          module="agents"
          title="受控作业"
        >
          <SubNav
            ariaLabel="作业视图"
            onChange={changeView}
            options={[
              { label: '运行', value: 'RUNS' },
              { label: '审批', value: 'APPROVALS' },
              { label: 'Bridge', value: 'BRIDGES' },
              { label: 'Skills', value: 'SKILLS' },
              { label: '阶段能力', value: 'CAPABILITIES' },
              { label: '审计', value: 'AUDIT' },
            ]}
            value={view}
          />
        </PageIntro>

        <div className="agent-runs-content">
          {error ? (
            <div className="agent-runs-error" role="alert">
              <AlertTriangle aria-hidden="true" size={17} strokeWidth={1.8} />
              {error}
            </div>
          ) : null}

          {view === 'RUNS' ? (
            <>
              <MetricGrid className="agent-runs-metrics">
                <MetricCard
                  hint="当前可见范围"
                  icon={<Activity size={18} strokeWidth={1.8} />}
                  label="运行总数"
                  tone="blue"
                  value={metrics.total}
                />
                <MetricCard
                  hint="排队、启动或执行中"
                  icon={<Clock3 size={18} strokeWidth={1.8} />}
                  label="处理中"
                  tone="orange"
                  value={metrics.active}
                />
                <MetricCard
                  hint="已有结果读回"
                  icon={<CheckCircle2 size={18} strokeWidth={1.8} />}
                  label="已完成"
                  tone="purple"
                  value={metrics.succeeded}
                />
                <MetricCard
                  hint="失败、未知或待处理"
                  icon={<AlertTriangle size={18} strokeWidth={1.8} />}
                  label="需关注"
                  tone="red"
                  value={metrics.attention}
                />
              </MetricGrid>
              <FilterToolbar className="agent-runs-toolbar">
                <SearchField
                  ariaLabel="搜索运行"
                  onChange={setSearch}
                  placeholder="运行编号、需求编号或状态"
                  searchIcon={<Search size={17} strokeWidth={1.8} />}
                  value={search}
                />
                <span>{filteredItems.length} 条运行</span>
              </FilterToolbar>
              <div className="agent-runs-workspace">
                <aside aria-label="运行列表">
                  <AgentRunList
                    items={filteredItems}
                    loading={loading}
                    onSelect={selectRun}
                    selectedId={selectedId}
                  />
                </aside>
                <AgentRunDetail
                  events={events}
                  loading={detailLoading}
                  onControl={controlRun}
                  run={run}
                />
              </div>
            </>
          ) : view === 'APPROVALS' ? (
            <ApprovalInbox api={api} onChanged={refresh} revision={revision} />
          ) : view === 'BRIDGES' ? (
            <BridgeCenter
              activeRunCounts={activeRunCounts}
              api={api}
              canPair={actor.teams.some(
                (team) =>
                  team.id === actor.currentTeamId && team.role === 'TEAM_ADMIN',
              )}
              teamId={actor.currentTeamId}
              key={actor.currentTeamId ?? 'NO_TEAM'}
            />
          ) : view === 'SKILLS' ? (
            <SkillCatalog items={skills} loading={skillsLoading} />
          ) : view === 'CAPABILITIES' ? (
            <StageCapabilityConfigPanel />
          ) : (
            <AgentAuditPanel
              api={api}
              runs={items}
              selectedRunId={selectedId}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export function AgentRunsUnavailablePage({
  actor,
  onLogout,
}: {
  actor: CurrentActorDto;
  onLogout: () => void;
}) {
  return (
    <div className="pfc-reference-theme agent-runs-page">
      <AgentRunsHeader actor={actor} jobsEnabled={false} onLogout={onLogout} />
      <main>
        <PageIntro
          context="POD-PFC-001 · M2-R1"
          description="当前服务未开放 M2 作业模块，导航已按真实能力收起。"
          icon={<Bot aria-hidden="true" size={28} strokeWidth={1.8} />}
          module="agents"
          title="受控作业未启用"
        />
        <div className="agent-runs-content">
          <EmptyState
            description="启用并完成本地 PostgreSQL 集成后，作业入口才会开放。"
            icon={
              <AlertTriangle aria-hidden="true" size={24} strokeWidth={1.8} />
            }
            title="能力不可用"
          />
        </div>
      </main>
    </div>
  );
}
