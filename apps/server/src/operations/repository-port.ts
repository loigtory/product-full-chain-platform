import type {
  GateCenterItemDto,
  GateCenterStatus,
  GateCenterView,
  GateRunMode,
  LifecycleStage,
  MaterialBaselineStatus,
  MaterialLibraryItemDto,
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from '@pfc/contracts';

export type GateCenterQuery = Readonly<{
  view: GateCenterView;
  search: string;
  stage: LifecycleStage | null;
  status: GateCenterStatus | null;
  mode: GateRunMode | null;
  cursor: string | null;
  limit: number;
}>;

export type MaterialLibraryQuery = Readonly<{
  search: string;
  status: MaterialBaselineStatus | null;
  sourceType: MaterialSourceType | null;
  materialPurpose: MaterialPurpose | null;
  sensitivity: SensitivityLevel | null;
  cursor: string | null;
  limit: number;
}>;

export type GateCenterRecord = GateCenterItemDto &
  Readonly<{ sensitivity: SensitivityLevel }>;

export type MaterialLibraryRecord = MaterialLibraryItemDto;

export interface OperationsRepositoryPort {
  listGateCenterItems(query: GateCenterQuery): Promise<
    Readonly<{
      items: readonly GateCenterRecord[];
      nextCursor: string | null;
    }>
  >;
  listMaterialLibraryItems(query: MaterialLibraryQuery): Promise<
    Readonly<{
      items: readonly MaterialLibraryRecord[];
      nextCursor: string | null;
    }>
  >;
}
