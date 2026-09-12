import { describe, expect, it } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { MaterialImpactApplicationService } from '../../apps/server/src/material-impacts/index.ts';
import { InMemoryRequirementRepository } from '../../apps/server/src/requirements/index.ts';
import { createT6Fixture } from '../../packages/test-data/src/index.ts';

function harness(runId: string, includeInvalidatedRun = false) {
  const fixture = createT6Fixture(runId);
  const invalidatedRun = {
    ...fixture.gateRuns[1]!,
    gateRun: {
      ...fixture.gateRuns[1]!.gateRun,
      id: `${fixture.prefix}_GATE_G1_OLD`,
      validity: 'INVALIDATED' as const,
    },
  };
  const repository = new InMemoryRequirementRepository(
    [fixture.requirementWrite],
    [],
    includeInvalidatedRun
      ? [...fixture.gateRuns, invalidatedRun]
      : fixture.gateRuns,
  );
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const service = new MaterialImpactApplicationService({
    repository,
    authorizationPort: ports.authorization,
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  });
  return { fixture, repository, service };
}

describe('T6 material impact application service', () => {
  it('registers a pending candidate without switching the current baseline or stage', async () => {
    const { fixture, repository, service } = harness('T6_APP_PENDING');
    const response = await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );

    expect(response).toMatchObject({
      replayed: false,
      assessment: { status: 'PENDING' },
      requirement: {
        currentBaselineId: fixture.baselineId,
        currentStage: 'G3',
        rowVersion: 4,
      },
    });
    await expect(
      repository.listMaterialBaselinesByRequirement(fixture.requirementId),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.baselineId }),
        expect.objectContaining({
          id: response.assessment.candidateBaselineId,
          versionNumber: 2,
        }),
      ]),
    );
  });

  it('confirms impact once, switches baseline, and invalidates only selected-stage downstream runs', async () => {
    const { fixture, repository, service } = harness('T6_APP_IMPACTS');
    const pending = await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );
    const first = await service.confirmAssessment(
      fixture.actors.businessOwner,
      fixture.requirementId,
      pending.assessment.id,
      fixture.impactConfirmation,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.confirm,
    );
    const replay = await service.confirmAssessment(
      fixture.actors.businessOwner,
      fixture.requirementId,
      pending.assessment.id,
      fixture.impactConfirmation,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.confirm,
    );

    expect(first).toMatchObject({
      replayed: false,
      assessment: {
        decision: 'IMPACTS',
        invalidatedGateRunIds: [
          `${fixture.prefix}_GATE_G1`,
          `${fixture.prefix}_GATE_G3`,
        ],
      },
      requirement: { currentStage: 'G1', rowVersion: 5 },
    });
    expect(replay).toMatchObject({
      replayed: true,
      assessment: { id: first.assessment.id },
      requirement: { currentStage: 'G1', rowVersion: 5 },
    });
    const runs = await repository.listGateRunRecordsByRequirement(
      fixture.requirementId,
    );
    expect(
      runs.find((run) => run.gateRun.stage === 'G0')?.gateRun.validity,
    ).toBe('CURRENT');
    expect(
      runs.find((run) => run.gateRun.stage === 'G1')?.gateRun.validity,
    ).toBe('INVALIDATED');
  });

  it('confirms no impact without moving the stage or invalidating old conclusions', async () => {
    const { fixture, repository, service } = harness('T6_APP_NO_IMPACT');
    const pending = await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );
    const result = await service.confirmAssessment(
      fixture.actors.businessOwner,
      fixture.requirementId,
      pending.assessment.id,
      fixture.noImpactConfirmation,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.confirm,
    );

    expect(result.requirement.currentStage).toBe('G3');
    expect(result.assessment.invalidatedGateRunIds).toEqual([]);
    expect(
      (
        await repository.listGateRunRecordsByRequirement(fixture.requirementId)
      ).every((run) => run.gateRun.validity === 'CURRENT'),
    ).toBe(true);
  });

  it('does not count an already invalidated historical run in the new invalidation scope', async () => {
    const { fixture, service } = harness('T6_APP_CURRENT_SCOPE', true);
    const pending = await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );
    const result = await service.confirmAssessment(
      fixture.actors.businessOwner,
      fixture.requirementId,
      pending.assessment.id,
      fixture.impactConfirmation,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.confirm,
    );

    expect(result.assessment.invalidatedGateRunIds).not.toContain(
      `${fixture.prefix}_GATE_G1_OLD`,
    );
  });

  it('does not let a less-sensitive candidate bypass access to a restricted current requirement', async () => {
    const fixture = createT6Fixture('T6_APP_CURRENT_SENSITIVITY');
    const restrictedWrite = {
      ...fixture.requirementWrite,
      materialBaseline: {
        ...fixture.requirementWrite.materialBaseline!,
        sensitivity: 'RESTRICTED' as const,
      },
    };
    const repository = new InMemoryRequirementRepository(
      [restrictedWrite],
      [],
      fixture.gateRuns,
    );
    const authorizationFixtures = fixture.dependencyFixtures.authorization.map(
      (entry) => ({
        ...entry,
        data: {
          ...entry.data,
          membership: { ...entry.data.membership, restricted: 'NO' as const },
        },
      }),
    );
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      {
        ...fixture.dependencyFixtures,
        authorization: authorizationFixtures,
      },
      () => fixture.now,
    );
    const service = new MaterialImpactApplicationService({
      repository,
      authorizationPort: ports.authorization,
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });

    await expect(
      service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('re-authorizes an idempotent replay after access is revoked', async () => {
    const fixture = createT6Fixture('T6_APP_REPLAY_REVOKED');
    const repository = new InMemoryRequirementRepository(
      [fixture.requirementWrite],
      [],
      fixture.gateRuns,
    );
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      fixture.dependencyFixtures,
      () => fixture.now,
    );
    let revoked = false;
    const service = new MaterialImpactApplicationService({
      repository,
      authorizationPort: {
        lookupRequirementAuthorization: async (request) => {
          const result =
            await ports.authorization.lookupRequirementAuthorization(request);
          if (!revoked || result.status !== 'AVAILABLE') return result;
          return {
            ...result,
            data: {
              ...result.data,
              membership: {
                team: 'NO',
                requirement: 'NO',
                restricted: 'NO',
              },
            },
          };
        },
      },
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });
    await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );
    revoked = true;

    await expect(
      service.createAssessment(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.createRequest,
        fixture.idempotencyKeys.create,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an actor whose asserted responsibility is not in the current identity', async () => {
    const { fixture, service } = harness('T6_APP_ROLE');
    const pending = await service.createAssessment(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.createRequest,
      fixture.idempotencyKeys.create,
    );

    await expect(
      service.confirmAssessment(
        fixture.actors.businessOwner,
        fixture.requirementId,
        pending.assessment.id,
        { ...fixture.impactConfirmation, confirmedRole: 'PRODUCT_OWNER' },
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.confirm,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
