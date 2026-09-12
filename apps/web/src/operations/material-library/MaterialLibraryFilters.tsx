import { RefreshCw, Search, X } from 'lucide-react';

import {
  MATERIAL_BASELINE_STATUSES,
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
  type MaterialBaselineStatus,
  type MaterialPurpose,
  type MaterialSourceType,
  type SensitivityLevel,
} from '@pfc/contracts';
import {
  Button,
  FilterToolbar,
  SearchField as PlatformSearchField,
  SelectField,
  statusLabel,
} from '@pfc/ui';

import { purposeLabels, sensitivityLabels, sourceLabels } from '../model.ts';
import type { MaterialFilters } from './filters.ts';

export function MaterialLibraryFilters({
  filters,
  loading,
  onChange,
  onRefresh,
}: {
  filters: MaterialFilters;
  loading: boolean;
  onChange: (filters: MaterialFilters) => void;
  onRefresh: () => void;
}) {
  return (
    <FilterToolbar className="operations-toolbar material-toolbar">
      <PlatformSearchField
        ariaLabel="搜索需求名称"
        className="operations-search"
        clearAriaLabel="清除搜索"
        clearIcon={<X aria-hidden="true" size={15} strokeWidth={1.8} />}
        id="material-library-search"
        onChange={(search) => onChange({ ...filters, search })}
        placeholder="搜索需求名称"
        searchIcon={<Search aria-hidden="true" size={17} strokeWidth={1.8} />}
        value={filters.search}
      />
      <SelectField
        className="filter-control"
        hideLabel
        label="基线状态"
        onChange={(event) =>
          onChange({
            ...filters,
            status: event.target.value as MaterialBaselineStatus | '',
          })
        }
        value={filters.status}
      >
        <option value="">全部状态</option>
        {MATERIAL_BASELINE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {statusLabel(status)}
          </option>
        ))}
      </SelectField>
      <SelectField
        className="filter-control"
        hideLabel
        label="材料来源"
        onChange={(event) =>
          onChange({
            ...filters,
            sourceType: event.target.value as MaterialSourceType | '',
          })
        }
        value={filters.sourceType}
      >
        <option value="">全部来源</option>
        {MATERIAL_SOURCE_TYPES.map((source) => (
          <option key={source} value={source}>
            {sourceLabels[source]}
          </option>
        ))}
      </SelectField>
      <SelectField
        ariaLabel="材料用途筛选"
        className="filter-control"
        hideLabel
        label="材料用途"
        onChange={(event) =>
          onChange({
            ...filters,
            materialPurpose: event.target.value as MaterialPurpose | '',
          })
        }
        value={filters.materialPurpose}
      >
        <option value="">全部用途</option>
        {MATERIAL_PURPOSES.map((purpose) => (
          <option key={purpose} value={purpose}>
            {purposeLabels[purpose]}
          </option>
        ))}
      </SelectField>
      <SelectField
        ariaLabel="敏感级别筛选"
        className="filter-control"
        hideLabel
        label="敏感级别"
        onChange={(event) =>
          onChange({
            ...filters,
            sensitivity: event.target.value as SensitivityLevel | '',
          })
        }
        value={filters.sensitivity}
      >
        <option value="">全部级别</option>
        {SENSITIVITY_LEVELS.map((level) => (
          <option key={level} value={level}>
            {sensitivityLabels[level]}
          </option>
        ))}
      </SelectField>
      <Button
        aria-label="刷新材料"
        icon={<RefreshCw aria-hidden="true" size={17} strokeWidth={1.8} />}
        loading={loading}
        onClick={onRefresh}
        size="icon"
        title="刷新材料"
        variant="secondary"
      />
    </FilterToolbar>
  );
}
