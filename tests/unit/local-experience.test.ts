import { describe, expect, it } from 'vitest';

import {
  ACTOR_ROLES,
  REQUIREMENT_ACTIONS,
} from '../../packages/contracts/src/index.ts';
import {
  EXPERIENCE_ACTOR_ID,
  EXPERIENCE_ID_PREFIX,
  EXPERIENCE_SCHEMA,
  createExperienceActor,
  createExperienceDependencyPorts,
  createExperienceIdFactory,
  loadExperienceRuntimeConfig,
} from '../../apps/server/src/local-experience.ts';

describe('local PostgreSQL experience mode', () => {
  it('is explicit, local-only, and pinned to the isolated schema', () => {
    expect(
      loadExperienceRuntimeConfig({
        APP_ENV: 'local',
        PFC_EXPERIENCE_MODE: 'false',
      }),
    ).toEqual({ enabled: false, schemaName: 'pfc' });
    expect(
      loadExperienceRuntimeConfig({
        APP_ENV: 'local',
        PFC_EXPERIENCE_MODE: 'true',
      }),
    ).toEqual({ enabled: true, schemaName: EXPERIENCE_SCHEMA });
    expect(() =>
      loadExperienceRuntimeConfig({
        APP_ENV: 'production',
        PFC_EXPERIENCE_MODE: 'true',
      }),
    ).toThrow('EXPERIENCE_MODE_ENV_FORBIDDEN');
    expect(() =>
      loadExperienceRuntimeConfig({
        APP_ENV: 'local',
        PFC_EXPERIENCE_MODE: 'yes',
      }),
    ).toThrow('EXPERIENCE_MODE_FLAG_INVALID');
  });

  it('resolves one authenticated actor with every current lifecycle role', () => {
    expect(createExperienceActor()).toEqual({
      actorId: EXPERIENCE_ACTOR_ID,
      roles: ACTOR_ROLES,
      teamIds: [`${EXPERIENCE_ID_PREFIX}TEAM_FULL_ACCESS`],
      authenticationStatus: 'AUTHENTICATED',
    });
  });

  it('allows all current actions while keeping fixture capabilities prefix-scoped', async () => {
    const checkedAt = '2026-09-05T09:00:00.000Z';
    const ports = createExperienceDependencyPorts(() => checkedAt);
    const requirementId = `${EXPERIENCE_ID_PREFIX}REQUIREMENT_1`;
    const baselineId = `${EXPERIENCE_ID_PREFIX}BASELINE_1`;
    const actor = createExperienceActor();

    const authorization =
      await ports.authorization.lookupRequirementAuthorization({
        actor,
        requirementId,
        action: 'RUN_GATE',
      });
    expect(authorization).toMatchObject({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      checkedAt,
      data: {
        actorId: EXPERIENCE_ACTOR_ID,
        requirementId,
        allowedActions: REQUIREMENT_ACTIONS,
      },
    });

    const capability = await ports.gateExecution.getGateExecutionCapability({
      actorId: EXPERIENCE_ACTOR_ID,
      requirementId,
      baselineId,
      stage: 'G0',
    });
    expect(capability).toMatchObject({
      status: 'AVAILABLE',
      data: { executable: true },
    });

    const execution = await ports.gateExecution.executeGate({
      actorId: EXPERIENCE_ACTOR_ID,
      requirementId,
      baselineId,
      stage: 'G0',
      idempotencyKey: `${EXPERIENCE_ID_PREFIX}IDEMPOTENCY_1`,
    });
    expect(execution).toMatchObject({
      status: 'AVAILABLE',
      data: { status: 'COMPLETED', result: 'PASS' },
    });

    const outOfScope = await ports.artifactEvidence.listEvidence({
      actorId: EXPERIENCE_ACTOR_ID,
      requirementId,
      baselineId,
      evidenceRefIds: ['REAL_EVIDENCE_1'],
    });
    expect(outOfScope.status).toBe('UNKNOWN');
  });

  it('generates restart-safe prefixed runtime identifiers', () => {
    const id = createExperienceIdFactory()('requirement');
    expect(id.startsWith(`${EXPERIENCE_ID_PREFIX}REQUIREMENT_`)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(160);
  });
});
