import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Columns3,
  Database,
  LayoutList,
  Layers3,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';

import type {
  RequirementDetailDto,
  RequirementListItemDto,
  RequirementListScope,
  RequirementListView,
} from '@pfc/contracts';
import {
  Button,
  DetailSheet,
  EmptyState,
  GlobalHeader,
  MetricCard,
  MetricGrid,
  PageIntro,
  PrimaryNav,
  SearchField,
  SegmentedControl,
  SelectField,
  SummaryGrid,
  SummaryPanel,
  WorkPanel,
  type SegmentedOption,
} from '@pfc/ui';

import { StatusPill } from './StatusPill.tsx';
import {
  RequirementsApiError,
  type RequirementsApi,
} from './requirements-api.ts';
import './workbench-preview.css';

const stages = Array.from({ length: 13 }, (_, index) => `G${index}`);

type PreviewSort = 'UPDATED_DESC' | 'STAGE_ASC' | 'NAME_ASC';
type PreviewNavigation = 'REQUIREMENTS' | 'GATES' | 'MATERIALS';

const scopeOptions: readonly SegmentedOption<RequirementListScope>[] = [
  { label: '全部需求', value: 'ALL' },
  { label: '待我处理', value: 'MINE' },
  { label: '阻断项', value: 'BLOCKED' },
];

const viewOptions: readonly SegmentedOption<RequirementListView>[] = [
  {
    icon: <LayoutList aria-hidden="true" size={16} strokeWidth={1.8} />,
    label: '表格',
    value: 'TABLE',
  },
  {
    icon: <Columns3 aria-hidden="true" size={16} strokeWidth={1.8} />,
    label: '按阶段',
    value: 'STAGE',
  },
];

const navigationOptions = [
  { label: '需求管理', value: 'REQUIREMENTS' },
  { label: '门禁中心', value: 'GATES' },
  { label: '材料库', value: 'MATERIALS' },
] as const;

function readPreviewRoute(): {
  scope: RequirementListScope;
  search: string;
  selected: string | null;
  sort: PreviewSort;
  view: RequirementListView;
} {
  const params = new URLSearchParams(window.location.search);
  const rawScope = params.get('scope');
  const rawSort = params.get('sort');
  const rawView = params.get('view');
  return {
    scope: rawScope === 'MINE' || rawScope === 'BLOCKED' ? rawScope : 'ALL',
    search: params.get('search') ?? '',
    selected: params.get('selected'),
    sort:
      rawSort === 'STAGE_ASC' || rawSort === 'NAME_ASC'
        ? rawSort
        : 'UPDATED_DESC',
    view: rawView === 'STAGE' ? 'STAGE' : 'TABLE',
  };
}

function friendlyTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ownerLabel(ownerId: string | null): string {
  if (!ownerId || ownerId === '待补充') return '待分配';
  if (ownerId.startsWith('CODEx_TEST_')) return '本地体验负责人';
  return ownerId;
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof RequirementsApiError) {
    if (error.code === 'PERMISSION_DENIED') return '当前账号无权读取该内容';
    if (error.code === 'DEPENDENCY_UNAVAILABLE') return '需求服务暂时不可用';
    return error.message;
  }
  return '暂时无法读取需求，请稍后重试';
}

function compareItems(
  left: RequirementListItemDto,
  right: RequirementListItemDto,
  sort: PreviewSort,
): number {
  if (sort === 'NAME_ASC') return left.name.localeCompare(right.name, 'zh-CN');
  if (sort === 'STAGE_ASC') {
    return (
      stages.indexOf(left.currentStage) - stages.indexOf(right.currentStage)
    );
  }
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function PreviewTable({
  items,
  onSelect,
  selectedId,
}: {
  items: readonly RequirementListItemDto[];
  onSelect: (item: RequirementListItemDto, trigger: HTMLButtonElement) => void;
  selectedId: string | null;
}) {
  return (
    <div className="preview-table-wrap">
      <table aria-label="需求列表" className="preview-table">
        <colgroup>
          <col className="preview-table__name" />
          <col className="preview-table__stage" />
          <col className="preview-table__status" />
          <col className="preview-table__owner" />
          <col className="preview-table__action" />
          <col className="preview-table__time" />
        </colgroup>
        <thead>
          <tr>
            <th>需求名称</th>
            <th>阶段</th>
            <th>门禁状态</th>
            <th>责任人</th>
            <th>下一步</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={selectedId === item.id ? 'is-selected' : undefined}
              key={item.id}
            >
              <td>
                <button
                  aria-label={`${item.name}，查看详情`}
                  className="preview-requirement-link"
                  data-status={item.gateProjection.toLowerCase()}
                  onClick={(event) => onSelect(item, event.currentTarget)}
                  type="button"
                >
                  <span>{item.name}</span>
                  <ChevronRight
                    aria-hidden="true"
                    size={16}
                    strokeWidth={1.8}
                  />
                </button>
              </td>
              <td>
                <span className="preview-stage-label">{item.currentStage}</span>
              </td>
              <td>
                <StatusPill value={item.gateProjection} />
              </td>
              <td>{ownerLabel(item.ownerId)}</td>
              <td className="preview-table__truncate" title={item.nextAction}>
                {item.nextAction}
              </td>
              <td className="preview-table__timestamp">
                {friendlyTimestamp(item.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewStageBoard({
  items,
  onSelect,
  selectedId,
}: {
  items: readonly RequirementListItemDto[];
  onSelect: (item: RequirementListItemDto, trigger: HTMLButtonElement) => void;
  selectedId: string | null;
}) {
  const populatedStages = stages.filter((stage) =>
    items.some((item) => item.currentStage === stage),
  );
  return (
    <div className="preview-stage-board" data-testid="preview-stage-board">
      {populatedStages.map((stage) => {
        const stageItems = items.filter((item) => item.currentStage === stage);
        return (
          <section className="preview-stage-lane" key={stage}>
            <header>
              <span>
                <Layers3 aria-hidden="true" size={16} strokeWidth={1.8} />
                <strong>{stage}</strong>
              </span>
              <small>{stageItems.length} 项</small>
            </header>
            <div>
              {stageItems.map((item) => (
                <button
                  aria-label={`${item.name}，查看详情`}
                  className={
                    selectedId === item.id
                      ? 'preview-stage-item is-selected'
                      : 'preview-stage-item'
                  }
                  key={item.id}
                  onClick={(event) => onSelect(item, event.currentTarget)}
                  type="button"
                >
                  <span className="preview-stage-item__heading">
                    <strong>{item.name}</strong>
                    <ChevronRight
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
                  </span>
                  <span className="preview-stage-item__meta">
                    <StatusPill value={item.gateProjection} />
                    <span>{ownerLabel(item.ownerId)}</span>
                  </span>
                  <small>{item.nextAction}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DetailContent({
  detail,
  error,
  loading,
  onRetry,
}: {
  detail: RequirementDetailDto | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div
        aria-label="正在读取需求详情"
        className="preview-detail-skeleton"
        role="status"
      >
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (error) {
    return (
      <div className="preview-detail-state" role="alert">
        <AlertTriangle aria-hidden="true" size={28} strokeWidth={1.8} />
        <strong>{error}</strong>
        <Button onClick={onRetry} size="sm" variant="secondary">
          重新读取
        </Button>
      </div>
    );
  }
  if (!detail) return null;
  const currentIndex = stages.indexOf(detail.currentStage);
  return (
    <div className="preview-detail-content">
      <section className="preview-detail-summary">
        <span className="preview-detail-kicker">
          <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.8} />
          只读详情
        </span>
        <h2>{detail.name}</h2>
        <div className="preview-detail-tags">
          <span className="preview-stage-label">{detail.currentStage}</span>
          <StatusPill value={detail.gateProjection} />
        </div>
      </section>
      <section className="preview-detail-section">
        <h3>需求说明</h3>
        <p>{detail.originalIdea}</p>
      </section>
      <section className="preview-detail-section">
        <div className="preview-detail-section__heading">
          <h3>生命周期</h3>
          <span>当前 {detail.currentStage}</span>
        </div>
        <div aria-label="需求生命周期" className="preview-lifecycle">
          {stages.map((stage, index) => (
            <span
              aria-current={index === currentIndex ? 'step' : undefined}
              className={
                index < currentIndex
                  ? 'is-complete'
                  : index === currentIndex
                    ? 'is-current'
                    : undefined
              }
              key={stage}
              title={stage}
            />
          ))}
        </div>
      </section>
      <section className="preview-detail-section">
        <h3>当前上下文</h3>
        <dl className="preview-detail-facts">
          <div>
            <dt>责任人</dt>
            <dd>{ownerLabel(detail.businessOwnerId ?? detail.initiatorId)}</dd>
          </div>
          <div>
            <dt>登记状态</dt>
            <dd>{detail.missingFields.length === 0 ? '完整' : '待补充'}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{friendlyTimestamp(detail.createdAt)}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{friendlyTimestamp(detail.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function WorkbenchPreviewPage({
  api,
  experienceMode,
}: {
  api: RequirementsApi;
  experienceMode: boolean;
}) {
  const [initial] = useState(readPreviewRoute);
  const [scope, setScope] = useState<RequirementListScope>(initial.scope);
  const [search, setSearch] = useState(initial.search);
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<PreviewSort>(initial.sort);
  const [view, setView] = useState<RequirementListView>(initial.view);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selected);
  const [items, setItems] = useState<readonly RequirementListItemDto[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<RequirementDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initial.selected));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ scope, view, sort });
    if (search) params.set('search', search);
    if (selectedId) params.set('selected', selectedId);
    window.history.replaceState(
      null,
      '',
      `/ui-preview/workbench?${params.toString()}`,
    );
  }, [scope, search, selectedId, sort, view]);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .listRequirements(
        { scope, search: deferredSearch, limit: 50 },
        controller.signal,
      )
      .then((response) => {
        setItems(response.items);
        setCheckedAt(response.checkedAt);
        setPartial(response.partial);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(previewErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, deferredSearch, revision, scope]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void api
      .getRequirement(selectedId, controller.signal)
      .then(setDetail)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setDetail(null);
          setDetailError(previewErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [api, detailRevision, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedId]);

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => compareItems(left, right, sort)),
    [items, sort],
  );
  const blockedCount = items.filter(
    (item) => item.gateProjection === 'BLOCK',
  ).length;
  const warningCount = items.filter(
    (item) => item.gateProjection === 'WARN',
  ).length;
  const notStartedCount = items.filter(
    (item) => item.gateProjection === 'NOT_STARTED',
  ).length;
  const activeStages = stages.filter((stage) =>
    items.some((item) => item.currentStage === stage),
  );
  const stageCount = activeStages.length;
  const earliestStage = activeStages.at(0) ?? '-';
  const latestStage = activeStages.at(-1) ?? '-';

  function selectItem(
    item: RequirementListItemDto,
    trigger: HTMLButtonElement,
  ) {
    triggerRef.current = trigger;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setSelectedId(item.id);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  function navigate(value: PreviewNavigation) {
    if (value === 'GATES') window.location.assign('/gate-center');
    if (value === 'MATERIALS') window.location.assign('/material-library');
  }

  const listDescription = loading
    ? '正在同步最新数据'
    : `${items.length} 项${partial ? '，当前为部分结果' : ''}`;

  return (
    <div className="pfc-reference-theme preview-shell">
      <a className="skip-link" href="#ui-r11-workbench">
        跳到主要内容
      </a>
      <GlobalHeader
        account={
          <span className="header-account preview-account">
            <span className="avatar">PM</span>
            <span>
              {experienceMode ? '全权限体验' : '产品负责人'}
              <small>{experienceMode ? '本地体验空间' : '本地工作区'}</small>
            </span>
          </span>
        }
        actions={
          <span className="preview-readonly-chip">
            <LockKeyhole aria-hidden="true" size={15} strokeWidth={1.8} />
            只读体验
          </span>
        }
        brand={
          <div className="header-brand preview-brand">
            <span aria-hidden="true">
              <Workflow size={20} strokeWidth={1.8} />
            </span>
            <strong>产品全链路</strong>
          </div>
        }
        className="pfc-reference-header"
        data-module="requirements"
        navigation={
          <PrimaryNav
            ariaLabel="主导航"
            onChange={navigate}
            options={navigationOptions}
            value="REQUIREMENTS"
          />
        }
      />

      <main
        aria-label="UI-R11 需求工作台预览"
        className="preview-main"
        id="ui-r11-workbench"
        tabIndex={-1}
      >
        <PageIntro
          actions={
            <div className="preview-page-meta">
              <span>
                <Database aria-hidden="true" size={15} strokeWidth={1.8} />
                本地数据库 · 只读
              </span>
              <small>
                {checkedAt
                  ? `更新于 ${friendlyTimestamp(checkedAt)}`
                  : '正在连接'}
              </small>
            </div>
          }
          className="preview-page-heading"
          context={null}
          description="集中查看需求状态、阶段进展与当前待办。"
          icon={<ClipboardList size={30} strokeWidth={1.8} />}
          module="requirements"
          title="需求工作台"
        />
        <div className="preview-container">
          <MetricGrid aria-label="需求概览">
            <MetricCard
              aria-label={`当前需求 ${items.length}`}
              hint={partial ? '当前分页结果' : '当前筛选结果'}
              icon={<ClipboardList size={20} strokeWidth={1.8} />}
              label="当前需求"
              tone="blue"
              value={items.length}
            />
            <MetricCard
              aria-label={`阻断项 ${blockedCount}`}
              hint="需要优先处理"
              icon={<ShieldCheck size={20} strokeWidth={1.8} />}
              label="阻断项"
              tone="red"
              value={blockedCount}
            />
            <MetricCard
              aria-label={`需关注 ${warningCount}`}
              hint="需复核门禁结果"
              icon={<AlertTriangle size={20} strokeWidth={1.8} />}
              label="需关注"
              tone="orange"
              value={warningCount}
            />
            <MetricCard
              aria-label={`覆盖阶段 ${stageCount}`}
              hint={`${stageCount} 个阶段`}
              icon={<BarChart3 size={20} strokeWidth={1.8} />}
              label="覆盖阶段"
              tone="purple"
              value={stageCount}
            />
          </MetricGrid>

          <SummaryGrid
            aria-label="需求分布摘要"
            className="preview-summary-grid"
          >
            <SummaryPanel
              items={[
                { label: '最早阶段', value: earliestStage },
                { label: '最前阶段', value: latestStage },
                { label: '覆盖阶段', value: stageCount },
              ]}
              meta={`${stageCount} 个阶段`}
              title="阶段推进"
            />
            <SummaryPanel
              items={[
                { label: '阻断', value: blockedCount },
                { label: '需关注', value: warningCount },
                { label: '未开始', value: notStartedCount },
              ]}
              meta={`${blockedCount + warningCount} 项需处理`}
              title="门禁态势"
            />
          </SummaryGrid>

          <section aria-label="需求筛选" className="preview-filter-panel">
            <SegmentedControl
              ariaLabel="需求范围"
              onChange={(value) => {
                setError(null);
                setLoading(true);
                setScope(value);
              }}
              options={scopeOptions}
              value={scope}
            />
            <SearchField
              ariaLabel="搜索需求"
              className="preview-search"
              clearAriaLabel="清除搜索"
              clearIcon={<X aria-hidden="true" size={15} strokeWidth={1.8} />}
              onChange={(value) => {
                setError(null);
                setLoading(true);
                setSearch(value);
              }}
              placeholder="搜索需求名称"
              searchIcon={
                <Search aria-hidden="true" size={17} strokeWidth={1.8} />
              }
              value={search}
            />
            <SelectField
              ariaLabel="需求排序"
              hideLabel
              label="排序"
              onChange={(event) => setSort(event.target.value as PreviewSort)}
              value={sort}
            >
              <option value="UPDATED_DESC">最近更新</option>
              <option value="STAGE_ASC">阶段顺序</option>
              <option value="NAME_ASC">需求名称</option>
            </SelectField>
            <SegmentedControl
              ariaLabel="视图"
              onChange={setView}
              options={viewOptions}
              value={view}
            />
            <Button
              aria-label="刷新需求"
              icon={
                <RefreshCw
                  aria-hidden="true"
                  className={loading ? 'spinning-icon' : undefined}
                  size={17}
                  strokeWidth={1.8}
                />
              }
              loading={false}
              onClick={() => {
                setError(null);
                setLoading(true);
                setRevision((value) => value + 1);
              }}
              size="icon"
              title="刷新需求"
              variant="secondary"
            />
          </section>

          <WorkPanel
            actions={
              <span
                aria-live="polite"
                className="preview-panel-meta"
                role="status"
              >
                <CircleDot aria-hidden="true" size={14} strokeWidth={1.8} />
                {checkedAt
                  ? `更新于 ${friendlyTimestamp(checkedAt)}`
                  : '等待数据'}
              </span>
            }
            description={listDescription}
            title={view === 'TABLE' ? '需求列表' : '阶段分布'}
          >
            {error ? (
              <div className="preview-list-state" role="alert">
                <AlertTriangle aria-hidden="true" size={30} strokeWidth={1.8} />
                <strong>{error}</strong>
                <span>保留当前筛选条件后重新读取。</span>
                <Button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    setRevision((value) => value + 1);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  重新加载
                </Button>
              </div>
            ) : loading && items.length === 0 ? (
              <div
                aria-label="正在读取需求列表"
                className="preview-list-skeleton"
                role="status"
              >
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            ) : sortedItems.length === 0 ? (
              <EmptyState
                description={
                  search
                    ? '调整关键词或清除搜索条件。'
                    : '当前筛选范围没有需求。'
                }
                icon={<ClipboardList size={30} strokeWidth={1.8} />}
                title={search ? '没有匹配的需求' : '当前范围暂无需求'}
              />
            ) : view === 'TABLE' ? (
              <PreviewTable
                items={sortedItems}
                onSelect={selectItem}
                selectedId={selectedId}
              />
            ) : (
              <PreviewStageBoard
                items={sortedItems}
                onSelect={selectItem}
                selectedId={selectedId}
              />
            )}
          </WorkPanel>
        </div>
      </main>

      {selectedId ? (
        <DetailSheet
          ariaLabel="需求详情"
          className="preview-detail-sheet"
          onDismiss={closeDetail}
          scrimLabel="关闭需求详情"
        >
          <header className="preview-detail-header">
            <span>需求详情</span>
            <Button
              aria-label="关闭需求详情"
              icon={<X aria-hidden="true" size={18} strokeWidth={1.8} />}
              onClick={closeDetail}
              size="icon"
              variant="ghost"
            />
          </header>
          <DetailContent
            detail={detail}
            error={detailError}
            loading={detailLoading}
            onRetry={() => {
              setDetailError(null);
              setDetailLoading(true);
              setDetailRevision((value) => value + 1);
            }}
          />
        </DetailSheet>
      ) : null}
    </div>
  );
}
