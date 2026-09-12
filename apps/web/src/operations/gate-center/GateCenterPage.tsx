import { useDeferredValue, useEffect, useState } from 'react';
import { History, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';

import {
  GATE_CENTER_STATUSES,
  LIFECYCLE_STAGES,
  type GateCenterItemDto,
  type GateCenterStatus,
  type GateRunMode,
  type LifecycleStage,
} from '@pfc/contracts';
import {
  Button,
  FilterToolbar,
  PageIntro,
  SearchField as PlatformSearchField,
  SelectField,
  statusLabel,
  SubNav,
  SummaryGrid,
  SummaryPanel,
  WorkPanel,
} from '@pfc/ui';

import type { RequirementsApi } from '../../requirements-api.ts';
import { errorMessage, selectValue } from '../model.ts';
import {
  LoadingRows,
  OperationsFreshness,
  OperationsState,
} from '../shared.tsx';
import { gateStorageKey, initialGateFilters } from './filters.ts';
import { GateCenterTable } from './GateCenterTable.tsx';

const gateViewOptions = [
  {
    icon: <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />,
    label: '当前待办',
    value: 'CURRENT',
  },
  {
    icon: <History aria-hidden="true" size={15} strokeWidth={1.8} />,
    label: '历史记录',
    value: 'HISTORY',
  },
] as const;

export function GateCenterPage({
  api,
  onOpenRequirement,
}: {
  api: RequirementsApi;
  onOpenRequirement: (id: string) => void;
}) {
  const [filters, setFilters] = useState(initialGateFilters);
  const deferredSearch = useDeferredValue(filters.search);
  const [items, setItems] = useState<readonly GateCenterItemDto[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const queryKey = JSON.stringify([
    deferredSearch,
    filters.mode,
    filters.stage,
    filters.status,
    filters.view,
    revision,
  ]);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const loading = Boolean(api.listGateCenter) && loadedQueryKey !== queryKey;

  useEffect(() => {
    window.sessionStorage.setItem(gateStorageKey, JSON.stringify(filters));
    if (window.location.pathname === '/gate-center') {
      const query = new URLSearchParams({ view: filters.view });
      if (filters.search) query.set('search', filters.search);
      if (filters.stage) query.set('stage', filters.stage);
      if (filters.status) query.set('status', filters.status);
      if (filters.mode) query.set('mode', filters.mode);
      window.history.replaceState(null, '', `/gate-center?${query}`);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    if (!api.listGateCenter) return () => controller.abort();
    void api
      .listGateCenter(
        {
          view: filters.view,
          search: deferredSearch,
          stage: selectValue(filters.stage),
          status: selectValue(filters.status),
          mode: selectValue(filters.mode),
          limit: 50,
        },
        controller.signal,
      )
      .then((response) => {
        setItems(response.items);
        setCheckedAt(response.checkedAt);
        setNextCursor(response.nextCursor);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError'))
          setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedQueryKey(queryKey);
      });
    return () => controller.abort();
  }, [
    api,
    deferredSearch,
    filters.mode,
    filters.stage,
    filters.status,
    filters.view,
    queryKey,
    revision,
  ]);

  const visibleError = api.listGateCenter ? error : '门禁中心读取能力未配置。';

  const loadMore = async () => {
    if (!api.listGateCenter || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await api.listGateCenter({
        view: filters.view,
        search: deferredSearch,
        stage: selectValue(filters.stage),
        status: selectValue(filters.status),
        mode: selectValue(filters.mode),
        cursor: nextCursor,
        limit: 50,
      });
      setItems((current) => [...current, ...response.items]);
      setCheckedAt(response.checkedAt);
      setNextCursor(response.nextCursor);
      setError(null);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  };

  const activeCount = items.filter((item) =>
    ['IN_PROGRESS', 'BLOCK', 'WARN', 'UNKNOWN'].includes(item.status),
  ).length;
  const notStartedCount = items.filter(
    (item) => item.status === 'NOT_STARTED',
  ).length;
  const automaticCount = items.filter(
    (item) => item.mode === 'AUTOMATIC',
  ).length;
  const manualCount = items.filter((item) => item.mode === 'MANUAL').length;
  const unrunCount = items.length - automaticCount - manualCount;

  return (
    <div
      aria-label="UI-R12 门禁中心"
      className="pfc-reference-theme operations-reference-page"
      data-module="gates"
      data-ui-version="R12"
      role="region"
    >
      <PageIntro
        actions={
          <OperationsFreshness
            checkedAt={checkedAt}
            label="门禁数据"
            loading={loading}
          />
        }
        className="operations-page-intro"
        context={null}
        description="聚合当前待办与历史运行结果，优先处理会阻断阶段推进的事项。"
        icon={<ShieldCheck size={30} strokeWidth={1.8} />}
        module="gates"
        title="门禁中心"
      >
        <SubNav
          ariaLabel="门禁记录范围"
          onChange={(view) => setFilters({ ...filters, view })}
          options={gateViewOptions}
          value={filters.view}
        />
      </PageIntro>
      <section className="operations-page" aria-label="门禁中心列表">
        <SummaryGrid className="operations-summary-grid">
          <SummaryPanel
            aria-label="门禁执行概览"
            items={[
              { label: '当前结果', value: items.length },
              { label: '需处理', value: activeCount },
              { label: '未运行', value: notStartedCount },
            ]}
            meta={`${activeCount} 项需处理`}
            title="门禁执行"
          />
          <SummaryPanel
            aria-label="门禁运行结构概览"
            items={[
              { label: '自动', value: automaticCount },
              { label: '人工', value: manualCount },
              { label: '尚未运行', value: unrunCount },
            ]}
            meta={`${automaticCount + manualCount} 项已运行`}
            title="运行结构"
          />
        </SummaryGrid>

        <FilterToolbar className="operations-toolbar gate-toolbar">
          <PlatformSearchField
            ariaLabel="搜索需求名称"
            className="operations-search"
            clearAriaLabel="清除搜索"
            clearIcon={<X aria-hidden="true" size={15} strokeWidth={1.8} />}
            id="gate-center-search"
            onChange={(search) => setFilters({ ...filters, search })}
            placeholder="搜索需求名称"
            searchIcon={
              <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            }
            value={filters.search}
          />
          <SelectField
            className="filter-control"
            hideLabel
            label="门禁阶段"
            onChange={(event) =>
              setFilters({
                ...filters,
                stage: event.target.value as LifecycleStage | '',
              })
            }
            value={filters.stage}
          >
            <option value="">全部阶段</option>
            {LIFECYCLE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="filter-control"
            hideLabel
            label="门禁状态"
            onChange={(event) =>
              setFilters({
                ...filters,
                status: event.target.value as GateCenterStatus | '',
              })
            }
            value={filters.status}
          >
            <option value="">全部状态</option>
            {GATE_CENTER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </SelectField>
          <SelectField
            className="filter-control"
            hideLabel
            label="运行模式"
            onChange={(event) =>
              setFilters({
                ...filters,
                mode: event.target.value as GateRunMode | '',
              })
            }
            value={filters.mode}
          >
            <option value="">全部模式</option>
            <option value="AUTOMATIC">自动</option>
            <option value="MANUAL">人工</option>
          </SelectField>
          <Button
            aria-label="刷新门禁"
            icon={<RefreshCw aria-hidden="true" size={17} strokeWidth={1.8} />}
            loading={loading}
            onClick={() => setRevision((value) => value + 1)}
            size="icon"
            title="刷新门禁"
            variant="secondary"
          />
        </FilterToolbar>

        <WorkPanel
          className="operations-work-panel"
          description={`${items.length} 项${filters.view === 'HISTORY' ? '历史记录' : '当前结果'}`}
          title="门禁记录"
        >
          {loading && items.length === 0 ? (
            <LoadingRows />
          ) : visibleError ? (
            <OperationsState
              description={visibleError}
              icon="gate"
              onRetry={() => setRevision((value) => value + 1)}
              title="门禁数据读取失败"
            />
          ) : items.length === 0 ? (
            <OperationsState
              description="调整阶段、状态、模式或关键词后继续。"
              icon="gate"
              title="没有匹配的门禁记录"
            />
          ) : (
            <GateCenterTable
              items={items}
              onOpenRequirement={onOpenRequirement}
            />
          )}
          {!loading && !visibleError && nextCursor ? (
            <div className="operations-pagination">
              <Button
                aria-label="加载更多门禁记录"
                loading={loadingMore}
                onClick={() => void loadMore()}
                variant="secondary"
              >
                {loadingMore ? '正在加载' : '加载更多'}
              </Button>
            </div>
          ) : null}
        </WorkPanel>
      </section>
    </div>
  );
}
