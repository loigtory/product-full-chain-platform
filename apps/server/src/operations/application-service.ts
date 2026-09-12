import type {
  ActorContext,
  AuthorizationPort,
  GateCenterResponse,
  MaterialLibraryResponse,
  SensitivityLevel,
} from '@pfc/contracts';

import { RequirementAuthorizationService } from '../access/authorization-service.ts';
import type {
  GateCenterQuery,
  MaterialLibraryQuery,
  OperationsRepositoryPort,
} from './repository-port.ts';

const sensitivityRank: Readonly<Record<SensitivityLevel, number>> = {
  PUBLIC: 0,
  INTERNAL: 1,
  RESTRICTED: 2,
};
const authorizationScanPageLimit = 10;

export function strictestSensitivity(
  left: SensitivityLevel,
  right: SensitivityLevel,
): SensitivityLevel {
  return sensitivityRank[left] >= sensitivityRank[right] ? left : right;
}

export class OperationsApplicationService {
  private readonly authorization: RequirementAuthorizationService;
  private readonly repository: OperationsRepositoryPort;
  private readonly now: () => string;

  constructor(input: {
    repository: OperationsRepositoryPort;
    authorizationPort: AuthorizationPort;
    now?: () => string;
  }) {
    this.repository = input.repository;
    this.authorization = new RequirementAuthorizationService(
      input.authorizationPort,
    );
    this.now = input.now ?? (() => new Date().toISOString());
  }

  async listGateCenter(
    actor: ActorContext,
    query: GateCenterQuery,
  ): Promise<GateCenterResponse> {
    const items: GateCenterResponse['items'][number][] = [];
    let cursor = query.cursor;
    let scannedPages = 0;
    const visitedCursors = new Set<string | null>();
    do {
      if (visitedCursors.has(cursor))
        throw new Error('OPERATIONS_CURSOR_STALLED');
      visitedCursors.add(cursor);
      scannedPages += 1;
      const page = await this.repository.listGateCenterItems({
        ...query,
        cursor,
        limit: query.limit - items.length,
      });
      const allowed = await this.allowedRequirements(
        actor,
        page.items.map((item) => ({
          requirementId: item.requirementId,
          sensitivity: item.sensitivity,
          materialRefIds: [] as readonly string[],
        })),
      );
      items.push(
        ...page.items
          .filter((item) => allowed.has(item.requirementId))
          .map(({ sensitivity, ...item }) => {
            void sensitivity;
            return item;
          }),
      );
      cursor = page.nextCursor;
    } while (
      items.length < query.limit &&
      cursor !== null &&
      scannedPages < authorizationScanPageLimit
    );
    return {
      items,
      nextCursor: cursor,
      checkedAt: this.now(),
    };
  }

  async listMaterialLibrary(
    actor: ActorContext,
    query: MaterialLibraryQuery,
  ): Promise<MaterialLibraryResponse> {
    const items: MaterialLibraryResponse['items'][number][] = [];
    let cursor = query.cursor;
    let scannedPages = 0;
    const visitedCursors = new Set<string | null>();
    do {
      if (visitedCursors.has(cursor))
        throw new Error('OPERATIONS_CURSOR_STALLED');
      visitedCursors.add(cursor);
      scannedPages += 1;
      const page = await this.repository.listMaterialLibraryItems({
        ...query,
        cursor,
        limit: query.limit - items.length,
      });
      const allowed = await this.allowedRequirements(
        actor,
        page.items.map((item) => ({
          requirementId: item.requirementId,
          sensitivity: item.materialRefs.reduce(
            (sensitivity, ref) =>
              strictestSensitivity(sensitivity, ref.sensitivity),
            item.sensitivity,
          ),
          materialRefIds: item.materialRefs.map((ref) => ref.id),
        })),
      );
      items.push(
        ...page.items.filter((item) => allowed.has(item.requirementId)),
      );
      cursor = page.nextCursor;
    } while (
      items.length < query.limit &&
      cursor !== null &&
      scannedPages < authorizationScanPageLimit
    );
    return {
      items,
      nextCursor: cursor,
      checkedAt: this.now(),
    };
  }

  private async allowedRequirements(
    actor: ActorContext,
    candidates: readonly Readonly<{
      requirementId: string;
      sensitivity: SensitivityLevel;
      materialRefIds: readonly string[];
    }>[],
  ): Promise<ReadonlySet<string>> {
    const unique = new Map<
      string,
      Readonly<{
        sensitivity: SensitivityLevel;
        materialRefIds: readonly string[];
      }>
    >();
    for (const item of candidates) {
      const current = unique.get(item.requirementId);
      unique.set(item.requirementId, {
        sensitivity: current
          ? strictestSensitivity(current.sensitivity, item.sensitivity)
          : item.sensitivity,
        materialRefIds: [
          ...new Set([
            ...(current?.materialRefIds ?? []),
            ...item.materialRefIds,
          ]),
        ],
      });
    }
    const decisions = await Promise.all(
      [...unique].map(async ([requirementId, item]) => ({
        requirementId,
        decision: await this.authorization.authorize(actor, {
          requirementId,
          action: 'VIEW_REQUIREMENT',
          sensitivity: item.sensitivity,
          materialRefIds: item.materialRefIds,
          requestedAt: this.now(),
        }),
      })),
    );
    return new Set(
      decisions
        .filter((item) => item.decision.decision === 'ALLOW')
        .map((item) => item.requirementId),
    );
  }
}
