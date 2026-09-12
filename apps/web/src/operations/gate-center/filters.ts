import {
  GATE_CENTER_STATUSES,
  LIFECYCLE_STAGES,
  type GateCenterStatus,
  type GateCenterView,
  type GateRunMode,
  type LifecycleStage,
} from '@pfc/contracts';

import { readStored } from '../model.ts';

export type GateFilters = {
  view: GateCenterView;
  search: string;
  stage: LifecycleStage | '';
  status: GateCenterStatus | '';
  mode: GateRunMode | '';
};

export const gateStorageKey = 'pfc.gate-center.filters.v1';

export function initialGateFilters(): GateFilters {
  const stored = readStored<GateFilters>(gateStorageKey);
  const query =
    window.location.pathname === '/gate-center' && window.location.search
      ? new URLSearchParams(window.location.search)
      : null;
  const source = query
    ? {
        view: query.get('view'),
        search: query.get('search'),
        stage: query.get('stage'),
        status: query.get('status'),
        mode: query.get('mode'),
      }
    : stored;
  return {
    view: source.view === 'HISTORY' ? 'HISTORY' : 'CURRENT',
    search: typeof source.search === 'string' ? source.search : '',
    stage: LIFECYCLE_STAGES.includes(source.stage as LifecycleStage)
      ? (source.stage as LifecycleStage)
      : '',
    status: GATE_CENTER_STATUSES.includes(source.status as GateCenterStatus)
      ? (source.status as GateCenterStatus)
      : '',
    mode:
      source.mode === 'AUTOMATIC' || source.mode === 'MANUAL'
        ? source.mode
        : '',
  };
}
