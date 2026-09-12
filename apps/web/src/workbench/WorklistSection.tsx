import { LoaderCircle, Search, X } from 'lucide-react';

import type {
  RequirementListItemDto,
  RequirementListScope,
  RequirementListView,
} from '@pfc/contracts';
import {
  Button,
  FilterToolbar,
  SearchField as PlatformSearchField,
  SegmentedControl,
  SubNav,
} from '@pfc/ui';

import {
  friendlyTimestamp,
  requirementScopeOptions,
  requirementViewOptions,
} from './model.tsx';
import { RequirementList } from './RequirementList.tsx';

export function WorklistSection({
  items,
  lastCheckedAt,
  listError,
  listLoading,
  scope,
  search,
  view,
  onOpen,
  onRetry,
  onScopeChange,
  onSearchChange,
  onViewChange,
}: {
  items: readonly RequirementListItemDto[];
  lastCheckedAt: string | null;
  listError: string | null;
  listLoading: boolean;
  scope: RequirementListScope;
  search: string;
  view: RequirementListView;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onScopeChange: (scope: RequirementListScope) => void;
  onSearchChange: (search: string) => void;
  onViewChange: (view: RequirementListView) => void;
}) {
  return (
    <section className="worklist">
      <FilterToolbar className="worklist-controls">
        <SubNav
          ariaLabel="需求范围"
          className="worklist-scopes"
          onChange={onScopeChange}
          options={requirementScopeOptions}
          value={scope}
        />
        <div className="worklist-control-cluster">
          <PlatformSearchField
            ariaLabel="搜索需求"
            className="worklist-search"
            clearAriaLabel="清除搜索"
            clearIcon={<X aria-hidden="true" size={15} strokeWidth={1.8} />}
            id="requirement-search"
            onChange={onSearchChange}
            placeholder="搜索需求名称"
            searchIcon={
              <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            }
            value={search}
          />
          <SegmentedControl
            ariaLabel="视图"
            className="view-switch"
            onChange={onViewChange}
            options={requirementViewOptions}
            value={view}
          />
        </div>
      </FilterToolbar>
      <div aria-live="polite" className="worklist-meta" role="status">
        <span>共 {items.length} 条需求</span>
        {listLoading && items.length > 0 ? (
          <span className="updating-state">
            <LoaderCircle
              aria-hidden="true"
              className="spinning-icon"
              size={14}
              strokeWidth={1.8}
            />
            正在更新
          </span>
        ) : lastCheckedAt ? (
          <span>更新于 {friendlyTimestamp(lastCheckedAt)}</span>
        ) : null}
      </div>
      {listError ? (
        <div className="notice-banner error" role="alert">
          <span>
            {listError}
            {lastCheckedAt
              ? `；当前内容读取于 ${friendlyTimestamp(lastCheckedAt)}`
              : ''}
          </span>
          <Button onClick={onRetry} variant="secondary">
            重新加载
          </Button>
        </div>
      ) : null}
      <RequirementList
        items={items}
        loading={listLoading}
        onOpen={onOpen}
        search={search}
        view={view}
      />
    </section>
  );
}
