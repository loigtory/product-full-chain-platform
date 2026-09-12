import { useEffect, useState } from 'react';
import { Search, ScrollText } from 'lucide-react';

import type { AgentAuditEntryDto, AgentRunDto } from '@pfc/contracts';
import {
  DataTableFrame,
  EmptyState,
  FilterToolbar,
  SearchField,
  SelectField,
  WorkPanel,
} from '@pfc/ui';

import type { AgentRunsApi } from './api.ts';
import { formatAgentRunTimestamp } from './model.ts';

export function AgentAuditPanel({
  api,
  runs,
  selectedRunId,
}: {
  api: AgentRunsApi;
  runs: readonly AgentRunDto[];
  selectedRunId: string | null;
}) {
  const query = new URLSearchParams(window.location.search);
  const [runId, setRunId] = useState<string | null>(
    query.get('auditRun') ?? selectedRunId ?? runs[0]?.id ?? null,
  );
  const [items, setItems] = useState<readonly AgentAuditEntryDto[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState(query.get('auditQuery') ?? '');
  const [decision, setDecision] = useState(query.get('auditDecision') ?? 'ALL');
  const [period, setPeriod] = useState(query.get('auditPeriod') ?? 'ALL');
  const [referenceTime] = useState(() => Date.now());
  const effectiveRunId = runId ?? selectedRunId ?? runs[0]?.id ?? null;
  const loading = Boolean(effectiveRunId && loadedRunId !== effectiveRunId);

  useEffect(() => {
    if (!effectiveRunId) return;
    let active = true;
    void api
      .listAudit(effectiveRunId)
      .then((response) => {
        if (active) {
          setItems(response.items);
          setLoadedRunId(effectiveRunId);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : '审计记录读取失败。',
          );
          setLoadedRunId(effectiveRunId);
        }
      });
    return () => {
      active = false;
    };
  }, [api, effectiveRunId]);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    next.set('view', 'audit');
    if (effectiveRunId) next.set('auditRun', effectiveRunId);
    else next.delete('auditRun');
    if (keyword) next.set('auditQuery', keyword);
    else next.delete('auditQuery');
    if (decision !== 'ALL') next.set('auditDecision', decision);
    else next.delete('auditDecision');
    if (period !== 'ALL') next.set('auditPeriod', period);
    else next.delete('auditPeriod');
    window.history.replaceState(null, '', `/jobs?${next}`);
  }, [decision, effectiveRunId, keyword, period]);

  const cutoff =
    period === '24H'
      ? referenceTime - 24 * 60 * 60 * 1000
      : period === '7D'
        ? referenceTime - 7 * 24 * 60 * 60 * 1000
        : null;
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  const filteredItems = items.filter(
    (entry) =>
      (decision === 'ALL' || entry.decision === decision) &&
      (cutoff === null || Date.parse(entry.occurredAt) >= cutoff) &&
      (!normalizedKeyword ||
        [entry.actorId, entry.action, entry.targetId, entry.targetType]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedKeyword)),
  );

  return (
    <WorkPanel
      className="agent-audit-panel"
      description={
        effectiveRunId ? `运行 ${effectiveRunId}` : '尚无可查看的运行'
      }
      title="审计记录"
    >
      {error ? (
        <p className="agent-runs-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <FilterToolbar className="agent-audit-filters">
        <SelectField
          label="运行"
          onChange={(event) => setRunId(event.target.value || null)}
          value={effectiveRunId ?? ''}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id}
            </option>
          ))}
        </SelectField>
        <SearchField
          ariaLabel="筛选审计操作者或动作"
          onChange={setKeyword}
          placeholder="操作者、动作或目标"
          searchIcon={<Search aria-hidden="true" size={16} strokeWidth={1.8} />}
          value={keyword}
        />
        <SelectField
          label="判定"
          onChange={(event) => setDecision(event.target.value)}
          value={decision}
        >
          <option value="ALL">全部</option>
          <option value="ALLOW">允许</option>
          <option value="DENY">拒绝</option>
        </SelectField>
        <SelectField
          label="时间"
          onChange={(event) => setPeriod(event.target.value)}
          value={period}
        >
          <option value="ALL">全部</option>
          <option value="24H">最近 24 小时</option>
          <option value="7D">最近 7 天</option>
        </SelectField>
      </FilterToolbar>
      {loading ? (
        <p className="agent-runs-state" role="status">
          正在读取审计记录...
        </p>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          description="该运行尚未形成可展示的审计事件。"
          icon={<ScrollText size={24} strokeWidth={1.8} />}
          title="暂无审计记录"
        />
      ) : (
        <DataTableFrame className="agent-audit-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>操作者</th>
                <th>判定</th>
                <th>目标</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatAgentRunTimestamp(entry.occurredAt)}</td>
                  <td>
                    <strong>{entry.action}</strong>
                    {entry.reason ? <small>{entry.reason}</small> : null}
                  </td>
                  <td>{entry.actorId}</td>
                  <td>{entry.decision}</td>
                  <td>
                    <span>{entry.targetType}</span>
                    <small>{entry.targetId}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      )}
    </WorkPanel>
  );
}
