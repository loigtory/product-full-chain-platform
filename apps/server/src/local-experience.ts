import { randomUUID } from 'node:crypto';

import {
  ACTOR_ROLES,
  REQUIREMENT_ACTIONS,
  type ActorContext,
  type CapabilityResult,
} from '@pfc/contracts';

import type { DependencyPorts } from './dependencies/index.ts';

export const EXPERIENCE_SCHEMA = 'pfc_experience' as const;
export const EXPERIENCE_ID_PREFIX = 'CODEx_TEST_EXPERIENCE_' as const;
export const EXPERIENCE_ACTOR_ID =
  `${EXPERIENCE_ID_PREFIX}ACTOR_FULL_ACCESS` as const;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;
type Clock = () => string;

export type ExperienceRuntimeConfig = Readonly<{
  enabled: boolean;
  schemaName: 'pfc' | typeof EXPERIENCE_SCHEMA;
}>;

export function loadExperienceRuntimeConfig(
  environment: EnvironmentSource,
): ExperienceRuntimeConfig {
  const value = environment.PFC_EXPERIENCE_MODE;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('EXPERIENCE_MODE_FLAG_INVALID');
  }
  const enabled = value === 'true';
  if (enabled && environment.APP_ENV !== 'local') {
    throw new Error('EXPERIENCE_MODE_ENV_FORBIDDEN');
  }
  return {
    enabled,
    schemaName: enabled ? EXPERIENCE_SCHEMA : 'pfc',
  };
}

export function createExperienceActor(): ActorContext {
  return {
    actorId: EXPERIENCE_ACTOR_ID,
    roles: ACTOR_ROLES,
    teamIds: [`${EXPERIENCE_ID_PREFIX}TEAM_FULL_ACCESS`],
    authenticationStatus: 'AUTHENTICATED',
  };
}

function available<T>(checkedAt: string, data: T): CapabilityResult<T> {
  return {
    status: 'AVAILABLE',
    source: 'FIXTURE',
    capabilityVersion: 'fixture/experience/v1',
    checkedAt,
    data,
  };
}

function unknown<T>(checkedAt: string): CapabilityResult<T> {
  return {
    status: 'UNKNOWN',
    source: 'FIXTURE',
    capabilityVersion: 'fixture/experience/v1',
    checkedAt,
    reasonCode: 'EXPERIENCE_SCOPE_MISMATCH',
  };
}

function isExperienceId(value: string): boolean {
  return value.startsWith(EXPERIENCE_ID_PREFIX);
}

function isExperienceScope(...values: readonly string[]): boolean {
  return values.every(isExperienceId);
}

export function createExperienceDependencyPorts(
  clock: Clock = () => new Date().toISOString(),
): DependencyPorts {
  return {
    authorization: {
      lookupRequirementAuthorization: async (request) => {
        if (
          request.actor.actorId !== EXPERIENCE_ACTOR_ID ||
          !isExperienceId(request.requirementId)
        ) {
          return unknown(clock());
        }
        return available(clock(), {
          actorId: request.actor.actorId,
          requirementId: request.requirementId,
          membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
          allowedActions: REQUIREMENT_ACTIONS,
          approvedTransmissionTargets: [],
          actionAuthorizations: [],
        });
      },
    },
    artifactEvidence: {
      listEvidence: async (request) => {
        if (
          request.actorId !== EXPERIENCE_ACTOR_ID ||
          request.evidenceRefIds.length === 0 ||
          !isExperienceScope(
            request.requirementId,
            request.baselineId,
            ...request.evidenceRefIds,
          )
        ) {
          return unknown(clock());
        }
        return available(
          clock(),
          request.evidenceRefIds.map((evidenceRefId) => ({
            evidenceRefId,
            baselineId: request.baselineId,
            referenceType: 'EXPERIENCE_SYNTHETIC_EVIDENCE',
            sensitivity: 'INTERNAL' as const,
            validity: 'VALID' as const,
          })),
        );
      },
    },
    gateExecution: {
      getGateExecutionCapability: async (request) =>
        request.actorId === EXPERIENCE_ACTOR_ID &&
        isExperienceScope(request.requirementId, request.baselineId)
          ? available(clock(), { executable: true as const })
          : unknown(clock()),
      executeGate: async (request) =>
        request.actorId === EXPERIENCE_ACTOR_ID &&
        isExperienceScope(
          request.requirementId,
          request.baselineId,
          request.idempotencyKey,
        )
          ? available(clock(), {
              executionId: `${EXPERIENCE_ID_PREFIX}EXECUTION_${randomUUID()}`,
              status: 'COMPLETED' as const,
              result: 'PASS' as const,
            })
          : unknown(clock()),
    },
    deliverySummary: {
      getDeliverySummary: async (request) =>
        request.actorId === EXPERIENCE_ACTOR_ID &&
        isExperienceScope(request.requirementId, request.baselineId)
          ? available(clock(), {
              status: 'PRESENT' as const,
              result: 'PASS' as const,
              summaryVersion: 'experience/v1',
            })
          : unknown(clock()),
    },
  };
}

export function createExperienceIdFactory() {
  return (kind: string): string =>
    `${EXPERIENCE_ID_PREFIX}${kind.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${randomUUID()}`;
}
