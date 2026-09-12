import { useDeferredValue, useEffect, useState } from 'react';
import { FileStack } from 'lucide-react';

import type { MaterialLibraryItemDto } from '@pfc/contracts';
import {
  Button,
  PageIntro,
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
import { initialMaterialFilters, materialStorageKey } from './filters.ts';
import { MaterialLibraryFilters } from './MaterialLibraryFilters.tsx';
import { MaterialLibraryTable } from './MaterialLibraryTable.tsx';

const materialViewOptions = [
  { label: '全部材料', value: 'ALL' },
  { label: '待确认影响', value: 'PENDING' },
] as const;

export function MaterialLibraryPage({
  api,
  onOpenRequirement,
}: {
  api: RequirementsApi;
  onOpenRequirement: (id: string) => void;
}) {
  const [filters, setFilters] = useState(initialMaterialFilters);
  const deferredSearch = useDeferredValue(filters.search);
  const [items, setItems] = useState<readonly MaterialLibraryItemDto[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const queryKey = JSON.stringify([
    deferredSearch,
    filters.materialPurpose,
    filters.sensitivity,
    filters.sourceType,
    filters.status,
    revision,
  ]);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const loading =
    Boolean(api.listMaterialLibrary) && loadedQueryKey !== queryKey;

  useEffect(() => {
    window.sessionStorage.setItem(materialStorageKey, JSON.stringify(filters));
    if (window.location.pathname === '/material-library') {
      const query = new URLSearchParams();
      if (filters.view === 'PENDING') query.set('impact', 'pending');
      if (filters.search) query.set('search', filters.search);
      if (filters.status) query.set('status', filters.status);
      if (filters.sourceType) query.set('sourceType', filters.sourceType);
      if (filters.materialPurpose)
        query.set('materialPurpose', filters.materialPurpose);
      if (filters.sensitivity) query.set('sensitivity', filters.sensitivity);
      const suffix = query.size > 0 ? `?${query}` : '';
      window.history.replaceState(null, '', `/material-library${suffix}`);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    if (!api.listMaterialLibrary) return () => controller.abort();
    void api
      .listMaterialLibrary(
        {
          search: deferredSearch,
          status: selectValue(filters.status),
          sourceType: selectValue(filters.sourceType),
          materialPurpose: selectValue(filters.materialPurpose),
          sensitivity: selectValue(filters.sensitivity),
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
    filters.materialPurpose,
    filters.sensitivity,
    filters.sourceType,
    filters.status,
    queryKey,
    revision,
  ]);

  const visibleError = api.listMaterialLibrary
    ? error
    : '材料库读取能力未配置。';

  const loadMore = async () => {
    if (!api.listMaterialLibrary || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await api.listMaterialLibrary({
        search: deferredSearch,
        status: selectValue(filters.status),
        sourceType: selectValue(filters.sourceType),
        materialPurpose: selectValue(filters.materialPurpose),
        sensitivity: selectValue(filters.sensitivity),
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

  const pendingCount = items.filter((item) => item.pendingImpact).length;
  const referenceCount = items.reduce(
    (total, item) => total + item.materialRefs.length,
    0,
  );
  const currentCount = items.filter((item) => item.status === 'CURRENT').length;
  const candidateCount = items.filter(
    (item) => item.status === 'CANDIDATE',
  ).length;
  const historicalCount = items.filter(
    (item) => item.status === 'HISTORICAL',
  ).length;
  const visibleItems =
    filters.view === 'PENDING'
      ? items.filter((item) => Boolean(item.pendingImpact))
      : items;

  return (
    <div
      aria-label="UI-R12 材料库"
      className="pfc-reference-theme operations-reference-page"
      data-module="materials"
      data-ui-version="R12"
      role="region"
    >
      <PageIntro
        actions={
          <OperationsFreshness
            checkedAt={checkedAt}
            label="材料数据"
            loading={loading}
          />
        }
        className="operations-page-intro"
        context={null}
        description="统一查看需求基线、材料引用与待确认影响，保持证据来源可追溯。"
        icon={<FileStack size={30} strokeWidth={1.8} />}
        module="materials"
        title="材料库"
      >
        <SubNav
          ariaLabel="材料视图"
          onChange={(view) => setFilters({ ...filters, view })}
          options={materialViewOptions}
          value={filters.view}
        />
      </PageIntro>
      <section className="operations-page" aria-label="材料库列表">
        <SummaryGrid className="operations-summary-grid">
          <SummaryPanel
            aria-label="材料基线概览"
            items={[
              { label: '当前结果', value: items.length },
              { label: '材料引用', value: referenceCount },
              { label: '待确认影响', value: pendingCount },
            ]}
            meta={`${pendingCount} 项待确认`}
            title="材料基线"
          />
          <SummaryPanel
            aria-label="材料基线结构概览"
            items={[
              { label: '当前', value: currentCount },
              { label: '候选', value: candidateCount },
              { label: '历史', value: historicalCount },
            ]}
            meta={`${items.length} 条基线`}
            title="基线结构"
          />
        </SummaryGrid>

        <MaterialLibraryFilters
          filters={filters}
          loading={loading}
          onChange={setFilters}
          onRefresh={() => setRevision((value) => value + 1)}
        />

        <WorkPanel
          className="operations-work-panel"
          description={`${visibleItems.length} 项${filters.view === 'PENDING' ? '待确认影响' : '材料基线'}`}
          title="材料记录"
        >
          {loading && items.length === 0 ? (
            <LoadingRows />
          ) : visibleError ? (
            <OperationsState
              description={visibleError}
              icon="material"
              onRetry={() => setRevision((value) => value + 1)}
              title="材料数据读取失败"
            />
          ) : visibleItems.length === 0 ? (
            <OperationsState
              description={
                filters.view === 'PENDING'
                  ? '当前已读取结果中没有待确认影响，可切换至全部材料继续查看。'
                  : '调整基线状态、来源、用途、敏感级别或关键词后继续。'
              }
              icon="material"
              title="没有匹配的材料基线"
            />
          ) : (
            <MaterialLibraryTable
              items={visibleItems}
              onOpenRequirement={onOpenRequirement}
            />
          )}
          {!loading && !visibleError && nextCursor ? (
            <div className="operations-pagination">
              <Button
                aria-label="加载更多材料记录"
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
