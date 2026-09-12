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

import { readStored } from '../model.ts';

export type MaterialLibraryView = 'ALL' | 'PENDING';

export type MaterialFilters = {
  view: MaterialLibraryView;
  search: string;
  status: MaterialBaselineStatus | '';
  sourceType: MaterialSourceType | '';
  materialPurpose: MaterialPurpose | '';
  sensitivity: SensitivityLevel | '';
};

export const materialStorageKey = 'pfc.material-library.filters.v1';

export function initialMaterialFilters(): MaterialFilters {
  const stored = readStored<MaterialFilters>(materialStorageKey);
  const query =
    window.location.pathname === '/material-library' && window.location.search
      ? new URLSearchParams(window.location.search)
      : null;
  const source = query
    ? {
        view: query.get('impact') === 'pending' ? 'PENDING' : 'ALL',
        search: query.get('search'),
        status: query.get('status'),
        sourceType: query.get('sourceType'),
        materialPurpose: query.get('materialPurpose'),
        sensitivity: query.get('sensitivity'),
      }
    : stored;
  return {
    view: source.view === 'PENDING' ? 'PENDING' : 'ALL',
    search: typeof source.search === 'string' ? source.search : '',
    status: MATERIAL_BASELINE_STATUSES.includes(
      source.status as MaterialBaselineStatus,
    )
      ? (source.status as MaterialBaselineStatus)
      : '',
    sourceType: MATERIAL_SOURCE_TYPES.includes(
      source.sourceType as MaterialSourceType,
    )
      ? (source.sourceType as MaterialSourceType)
      : '',
    materialPurpose: MATERIAL_PURPOSES.includes(
      source.materialPurpose as MaterialPurpose,
    )
      ? (source.materialPurpose as MaterialPurpose)
      : '',
    sensitivity: SENSITIVITY_LEVELS.includes(
      source.sensitivity as SensitivityLevel,
    )
      ? (source.sensitivity as SensitivityLevel)
      : '',
  };
}
