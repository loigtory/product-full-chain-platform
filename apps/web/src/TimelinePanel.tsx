import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type { TimelineEventDto } from '@pfc/contracts';

import {
  RequirementsApiError,
  type RequirementsApi,
} from './requirements-api.ts';

const eventLabels: Readonly<Record<string, string>> = {
  'requirement.created': '需求已创建',
  'g0.completed': 'G0 登记已补齐',
  'question.answered': '问题已回答',
  'decision.confirmed': '决定已确认',
  'gate.started': '门禁已启动',
  'gate.completed': '门禁已完成',
  'requirement.advanced': '阶段已推进',
  'material-impact.created': '材料影响待确认',
  'baseline.switched': '材料基线已切换',
};

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function summary(event: TimelineEventDto): string {
  const before = event.beforeSummary?.stage ?? event.beforeSummary?.baselineId;
  const after = event.afterSummary.stage ?? event.afterSummary.baselineId;
  if (event.afterSummary.decision === 'NO_IMPACT') {
    return '确认不影响现有结论';
  }
  if (event.afterSummary.decision === 'IMPACTS') {
    const invalidated = `影响 ${event.afterSummary.invalidatedCount ?? 0} 条门禁结论`;
    return before && after && before !== after
      ? `${before} → ${after} · ${invalidated}`
      : invalidated;
  }
  if (before && after && before !== after) return `${before} → ${after}`;
  return String(after ?? event.afterSummary.status ?? '已记录');
}

function eventContext(event: TimelineEventDto): string | null {
  if (event.type !== 'baseline.switched') return null;
  const beforeBaseline = event.beforeSummary?.baselineId;
  const afterBaseline = event.afterSummary.baselineId;
  const confirmedRole = event.afterSummary.confirmedRole;
  const parts = [
    beforeBaseline && afterBaseline
      ? `${String(beforeBaseline)} → ${String(afterBaseline)}`
      : null,
    confirmedRole ? String(confirmedRole) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function TimelinePanel({
  api,
  requirementId,
  onAuthorityRefresh,
}: {
  api: RequirementsApi;
  requirementId: string;
  onAuthorityRefresh: () => Promise<void>;
}) {
  const [items, setItems] = useState<readonly TimelineEventDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(api.listTimeline));
  const latestSequence = items.reduce(
    (latest, item) => Math.max(latest, item.sequence),
    0,
  );

  const load = useCallback(
    async (cursor: string | null = null) => {
      if (!api.listTimeline) return;
      try {
        const response = await api.listTimeline(requirementId, cursor);
        setItems((current) =>
          cursor ? [...current, ...response.items] : response.items,
        );
        setNextCursor(response.nextCursor);
        setCheckedAt(response.checkedAt);
        setError(null);
      } catch (caught) {
        if (
          caught instanceof RequirementsApiError &&
          caught.code === 'PERMISSION_DENIED'
        ) {
          setItems([]);
          setNextCursor(null);
          setCheckedAt(null);
          setError('你没有查看该需求的权限');
          await onAuthorityRefresh();
        } else {
          setError('时间线暂不可用');
        }
      } finally {
        setLoading(false);
      }
    },
    [api, onAuthorityRefresh, requirementId],
  );

  useEffect(() => {
    if (!api.listTimeline) return;
    let active = true;
    api
      .listTimeline(requirementId, null)
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
        setCheckedAt(response.checkedAt);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (
          caught instanceof RequirementsApiError &&
          caught.code === 'PERMISSION_DENIED'
        ) {
          setItems([]);
          setNextCursor(null);
          setCheckedAt(null);
          setError('你没有查看该需求的权限');
          void onAuthorityRefresh();
        } else {
          setError('时间线暂不可用');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, onAuthorityRefresh, requirementId]);

  function reload(cursor: string | null = null): void {
    setLoading(true);
    void load(cursor);
  }

  useEffect(() => {
    if (!api.subscribeToRequirementEvents || loading) return;
    const subscription = api.subscribeToRequirementEvents(
      requirementId,
      latestSequence,
      () => {
        void Promise.all([load(), onAuthorityRefresh()]);
      },
    );
    return () => subscription.close();
  }, [api, latestSequence, load, loading, onAuthorityRefresh, requirementId]);

  return (
    <section className="detail-section timeline-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">权威记录 · 时间线</p>
          <h2>时间线</h2>
        </div>
        <button
          aria-label="重新加载时间线"
          className="icon-button"
          disabled={loading || !api.listTimeline}
          onClick={() => reload()}
          title="重新加载时间线"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? 'spinning-icon' : undefined}
            size={17}
            strokeWidth={1.8}
          />
        </button>
      </div>
      {error ? (
        <div className="notice-banner warning" role="status">
          {error}
          {checkedAt ? `；最近成功读取 ${timestamp(checkedAt)}` : ''}
        </div>
      ) : null}
      {!api.listTimeline ? (
        <p>时间线能力尚未配置</p>
      ) : loading && items.length === 0 ? (
        <p>正在读取时间线...</p>
      ) : items.length === 0 ? (
        <p>暂无变化记录</p>
      ) : (
        <ol className="timeline-list">
          {items.map((event) => (
            <li key={event.eventId}>
              <span className="timeline-marker" aria-hidden="true" />
              <div>
                <strong>{eventLabels[event.type] ?? event.type}</strong>
                <p>{summary(event)}</p>
                {eventContext(event) ? (
                  <p className="timeline-context">{eventContext(event)}</p>
                ) : null}
                <small>
                  {timestamp(event.occurredAt)} · v{event.aggregateVersion}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => reload(nextCursor)}
          type="button"
        >
          加载更早记录
        </button>
      ) : null}
    </section>
  );
}
