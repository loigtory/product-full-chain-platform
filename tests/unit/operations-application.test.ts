import { describe, expect, it } from 'vitest';

import type {
  ActorContext,
  AuthorizationPort,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';

import {
  OperationsApplicationService,
  strictestSensitivity,
} from '../../apps/server/src/operations/application-service.ts';
import type { OperationsRepositoryPort } from '../../apps/server/src/operations/repository-port.ts';

const now = '2026-09-05T12:00:00.000Z';
const actor: ActorContext = {
  actorId: 'CODEx_TEST_UI_R6_ACTOR',
  roles: ['PRODUCT_MANAGER'],
  teamIds: ['CODEx_TEST_UI_R6_TEAM'],
  authenticationStatus: 'AUTHENTICATED',
};

function authorization(restricted: 'YES' | 'NO' = 'YES'): AuthorizationPort {
  return {
    async lookupRequirementAuthorization(request) {
      const allowed = request.requirementId === 'CODEx_TEST_UI_R6_ALLOWED';
      const data: RequirementAuthorizationSnapshot = {
        actorId: request.actor.actorId,
        requirementId: request.requirementId,
        membership: {
          team: allowed ? 'YES' : 'NO',
          requirement: allowed ? 'YES' : 'NO',
          restricted: allowed ? restricted : 'NO',
        },
        allowedActions: allowed ? ['VIEW_REQUIREMENT'] : [],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      };
      return {
        status: 'AVAILABLE',
        source: 'FIXTURE',
        capabilityVersion: 'fixture/ui-r6/v1',
        checkedAt: now,
        data,
      };
    },
  };
}

function repository(): OperationsRepositoryPort {
  const gateItem = (requirementId: string, requirementName: string) => ({
    key: `CURRENT:${requirementId}`,
    requirementId,
    requirementName,
    requirementStage: 'G3' as const,
    stage: 'G3' as const,
    baselineId: `${requirementId}_BASELINE`,
    gateRunId: null,
    mode: null,
    status: 'NOT_STARTED' as const,
    validity: null,
    ownerId: actor.actorId,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    nextAction: '运行当前门禁',
    historyCount: 2,
    sensitivity: 'RESTRICTED' as const,
  });
  const materialItem = (requirementId: string, requirementName: string) => ({
    baselineId: `${requirementId}_BASELINE`,
    requirementId,
    requirementName,
    requirementStage: 'G3' as const,
    versionNumber: 1,
    status: 'CURRENT' as const,
    sourceType: 'BUSINESS_FEEDBACK' as const,
    sourceDescription: null,
    materialPurpose: 'FACT' as const,
    sensitivity: 'RESTRICTED' as const,
    confirmedBy: actor.actorId,
    confirmedAt: now,
    createdAt: now,
    materialRefs: [],
    pendingImpact: null,
  });
  return {
    async listGateCenterItems() {
      return {
        items: [
          gateItem('CODEx_TEST_UI_R6_ALLOWED', '可查看门禁需求'),
          gateItem('CODEx_TEST_UI_R6_DENIED', '不可查看门禁需求'),
        ],
        nextCursor: null,
      };
    },
    async listMaterialLibraryItems() {
      return {
        items: [
          materialItem('CODEx_TEST_UI_R6_ALLOWED', '可查看材料需求'),
          materialItem('CODEx_TEST_UI_R6_DENIED', '不可查看材料需求'),
        ],
        nextCursor: null,
      };
    },
  };
}

describe('UI-R6 operations application service', () => {
  it('removes unauthorized requirements from gate and material aggregates', async () => {
    const service = new OperationsApplicationService({
      repository: repository(),
      authorizationPort: authorization(),
      now: () => now,
    });

    const [gates, materials] = await Promise.all([
      service.listGateCenter(actor, {
        view: 'CURRENT',
        search: '',
        stage: null,
        status: null,
        mode: null,
        cursor: null,
        limit: 20,
      }),
      service.listMaterialLibrary(actor, {
        search: '',
        status: null,
        sourceType: null,
        materialPurpose: null,
        sensitivity: null,
        cursor: null,
        limit: 20,
      }),
    ]);

    expect(gates).toMatchObject({
      checkedAt: now,
      items: [{ requirementName: '可查看门禁需求' }],
    });
    expect(materials).toMatchObject({
      checkedAt: now,
      items: [{ requirementName: '可查看材料需求' }],
    });
    expect(JSON.stringify({ gates, materials })).not.toContain('不可查看');
    expect(gates.items[0]).not.toHaveProperty('sensitivity');
  });

  it('authorizes a repeated requirement with its strictest sensitivity', async () => {
    expect(strictestSensitivity('INTERNAL', 'PUBLIC')).toBe('INTERNAL');
    expect(strictestSensitivity('PUBLIC', 'RESTRICTED')).toBe('RESTRICTED');
    expect(strictestSensitivity('RESTRICTED', 'INTERNAL')).toBe('RESTRICTED');
  });

  it('uses material reference sensitivity when authorizing a library row', async () => {
    const baseRepository = repository();
    const sensitiveRefRepository: OperationsRepositoryPort = {
      ...baseRepository,
      async listMaterialLibraryItems(query) {
        const page = await baseRepository.listMaterialLibraryItems(query);
        const item = page.items[0]!;
        return {
          ...page,
          items: [
            {
              ...item,
              sensitivity: 'INTERNAL',
              materialRefs: [
                {
                  id: 'CODEx_TEST_UI_R6_RESTRICTED_REF',
                  referenceType: 'SECURITY_REVIEW',
                  source: 'SYNTHETIC_TEST',
                  version: '1',
                  sensitivity: 'RESTRICTED',
                  validity: 'VALID',
                },
              ],
            },
          ],
        };
      },
    };
    const service = new OperationsApplicationService({
      repository: sensitiveRefRepository,
      authorizationPort: authorization('NO'),
      now: () => now,
    });

    const response = await service.listMaterialLibrary(actor, {
      search: '',
      status: null,
      sourceType: null,
      materialPurpose: null,
      sensitivity: null,
      cursor: null,
      limit: 20,
    });

    expect(response.items).toEqual([]);
  });

  it('continues repository pagination after an unauthorized page', async () => {
    const baseRepository = repository();
    const pagedRepository: OperationsRepositoryPort = {
      ...baseRepository,
      async listGateCenterItems(query) {
        return query.cursor
          ? {
              items: [
                {
                  ...(await baseRepository.listGateCenterItems(query))
                    .items[0]!,
                  requirementId: 'CODEx_TEST_UI_R6_ALLOWED',
                  requirementName: '后续可查看门禁需求',
                },
              ],
              nextCursor: null,
            }
          : {
              items: [
                {
                  ...(await baseRepository.listGateCenterItems(query))
                    .items[1]!,
                  requirementId: 'CODEx_TEST_UI_R6_DENIED',
                  requirementName: '首屏不可查看门禁需求',
                },
              ],
              nextCursor: '1',
            };
      },
    };
    const service = new OperationsApplicationService({
      repository: pagedRepository,
      authorizationPort: authorization(),
      now: () => now,
    });

    const response = await service.listGateCenter(actor, {
      view: 'CURRENT',
      search: '',
      stage: null,
      status: null,
      mode: null,
      cursor: null,
      limit: 1,
    });

    expect(response).toMatchObject({
      items: [{ requirementName: '后续可查看门禁需求' }],
      nextCursor: null,
    });
  });
});
