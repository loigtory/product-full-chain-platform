import {
  GATE_CENTER_STATUSES,
  GATE_CENTER_VIEWS,
  GATE_RUN_MODES,
  LIFECYCLE_STAGES,
  MATERIAL_BASELINE_STATUSES,
  MATERIAL_PURPOSES,
  MATERIAL_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
  type GateCenterStatus,
  type GateCenterView,
  type GateRunMode,
  type LifecycleStage,
  type MaterialBaselineStatus,
  type MaterialPurpose,
  type MaterialSourceType,
  type SensitivityLevel,
} from '@pfc/contracts';
import { DomainRuleViolation } from '@pfc/domain';
import type { FastifyInstance } from 'fastify';

import type { ActorResolver } from '../requirements/routes.ts';
import type { OperationsApplicationService } from './application-service.ts';

function serviceOrThrow(
  service: OperationsApplicationService | undefined,
): OperationsApplicationService {
  if (!service) {
    throw new DomainRuleViolation(
      'DEPENDENCY_UNAVAILABLE',
      'Operations read capability is not configured.',
    );
  }
  return service;
}

const paginationProperties = {
  search: { type: 'string', maxLength: 200, default: '' },
  cursor: { type: 'string', maxLength: 20 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
} as const;

export function registerOperationsRoutes(
  server: FastifyInstance,
  input: {
    service?: OperationsApplicationService;
    resolveActor: ActorResolver;
  },
): void {
  server.get(
    '/api/v1/gate-center',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            view: {
              type: 'string',
              enum: GATE_CENTER_VIEWS,
              default: 'CURRENT',
            },
            stage: { type: 'string', enum: LIFECYCLE_STAGES },
            status: { type: 'string', enum: GATE_CENTER_STATUSES },
            mode: { type: 'string', enum: GATE_RUN_MODES },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        view?: GateCenterView;
        search?: string;
        stage?: LifecycleStage;
        status?: GateCenterStatus;
        mode?: GateRunMode;
        cursor?: string;
        limit?: number;
      };
      return serviceOrThrow(input.service).listGateCenter(
        await input.resolveActor(request),
        {
          view: query.view ?? 'CURRENT',
          search: query.search ?? '',
          stage: query.stage ?? null,
          status: query.status ?? null,
          mode: query.mode ?? null,
          cursor: query.cursor ?? null,
          limit: query.limit ?? 20,
        },
      );
    },
  );

  server.get(
    '/api/v1/material-library',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            status: { type: 'string', enum: MATERIAL_BASELINE_STATUSES },
            sourceType: { type: 'string', enum: MATERIAL_SOURCE_TYPES },
            materialPurpose: { type: 'string', enum: MATERIAL_PURPOSES },
            sensitivity: { type: 'string', enum: SENSITIVITY_LEVELS },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        search?: string;
        status?: MaterialBaselineStatus;
        sourceType?: MaterialSourceType;
        materialPurpose?: MaterialPurpose;
        sensitivity?: SensitivityLevel;
        cursor?: string;
        limit?: number;
      };
      return serviceOrThrow(input.service).listMaterialLibrary(
        await input.resolveActor(request),
        {
          search: query.search ?? '',
          status: query.status ?? null,
          sourceType: query.sourceType ?? null,
          materialPurpose: query.materialPurpose ?? null,
          sensitivity: query.sensitivity ?? null,
          cursor: query.cursor ?? null,
          limit: query.limit ?? 20,
        },
      );
    },
  );
}
