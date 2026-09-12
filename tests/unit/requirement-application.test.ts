import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InMemoryRequirementRepository,
  RequirementApplicationService,
} from '../../apps/server/src/requirements/index.ts';
import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { DomainRuleViolation } from '../../packages/domain/src/index.ts';
import { createT3Fixture } from '../../packages/test-data/src/index.ts';

const fixture = createT3Fixture('T3_APPLICATION');

function createService() {
  const repository = new InMemoryRequirementRepository(fixture.seedWrites);
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const service = new RequirementApplicationService({
    repository,
    authorizationPort: ports.authorization,
    deliverySummaryPort: ports.deliverySummary,
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  });
  return { repository, service };
}

describe('T3 requirement application service', () => {
  it('lists only authorized projections and preserves dependency UNKNOWN as WARN', async () => {
    const { service } = createService();
    const result = await service.listRequirements(
      fixture.actors.productManager,
      { scope: 'ALL', search: '', limit: 20, cursor: null },
    );

    expect(result.items.map((item) => item.id)).toEqual([
      fixture.requirementIds.incomplete,
      fixture.requirementIds.complete,
    ]);
    expect(result.items[0]).not.toHaveProperty('originalIdea');
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.requirementIds.complete,
          gateProjection: 'NOT_STARTED',
          dependencyStatus: 'UNKNOWN',
          warningCode: 'DELIVERY_SUMMARY_UNKNOWN',
        }),
      ]),
    );
  });

  it('does not read requirement body when authorization is denied', async () => {
    const { repository, service } = createService();

    await expect(
      service.getRequirement(
        fixture.actors.productManager,
        fixture.requirementIds.denied,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(repository.detailReadCount(fixture.requirementIds.denied)).toBe(0);
  });

  it('keeps authorized detail readable when the gate capability probe throws', async () => {
    const repository = new InMemoryRequirementRepository(fixture.seedWrites);
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      fixture.dependencyFixtures,
      () => fixture.now,
    );
    const service = new RequirementApplicationService({
      repository,
      authorizationPort: ports.authorization,
      deliverySummaryPort: ports.deliverySummary,
      gateExecutionPort: {
        getGateExecutionCapability: async () => {
          throw new Error('synthetic probe failure');
        },
        executeGate: ports.gateExecution.executeGate,
      },
      now: () => fixture.now,
    });

    await expect(
      service.getRequirement(
        fixture.actors.productManager,
        fixture.requirementIds.complete,
      ),
    ).resolves.toMatchObject({
      id: fixture.requirementIds.complete,
      gateExecution: {
        status: 'UNKNOWN',
        reasonCode: 'GATE_EXECUTION_PROBE_FAILED',
      },
    });
  });

  it('creates incomplete and complete G0 drafts without treating either as PASS', async () => {
    const { repository, service } = createService();
    const initialMaterialRefCount = repository.materialRefCount();
    const incomplete = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.incomplete,
      fixture.idempotencyKeys.incomplete,
    );
    expect(repository.materialRefCount()).toBe(initialMaterialRefCount);
    const complete = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.complete,
      fixture.idempotencyKeys.complete,
    );

    expect(incomplete).toMatchObject({
      replayed: false,
      requirement: {
        gateProjection: 'BLOCK',
        currentBaseline: null,
      },
    });
    expect(incomplete.requirement.missingFields.length).toBeGreaterThan(0);
    expect(complete).toMatchObject({
      replayed: false,
      requirement: {
        gateProjection: 'NOT_STARTED',
        missingFields: [],
        currentBaseline: { versionNumber: 1 },
      },
    });
    expect(repository.materialRefCount()).toBe(initialMaterialRefCount + 1);
    await expect(
      repository.listMaterialRefsByBaseline(
        complete.requirement.currentBaseline!.id,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        referenceType: 'ORIGINAL_IDEA',
        source: fixture.createInputs.complete.originalIdea,
        version: '1',
        contentHash: `sha256:${createHash('sha256')
          .update(fixture.createInputs.complete.originalIdea)
          .digest('hex')}`,
        sensitivity: 'INTERNAL',
        validity: 'VALID',
      }),
    ]);
    await expect(
      service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.complete,
        fixture.idempotencyKeys.complete,
      ),
    ).resolves.toMatchObject({ replayed: true });
    expect(repository.materialRefCount()).toBe(initialMaterialRefCount + 1);
  });

  it('keeps same-name submissions separate but replays the same key safely', async () => {
    const { service } = createService();
    const first = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.sameName,
      fixture.idempotencyKeys.sameNameFirst,
    );
    const second = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.sameName,
      fixture.idempotencyKeys.sameNameSecond,
    );
    const replay = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.sameName,
      fixture.idempotencyKeys.sameNameFirst,
    );

    expect(first.requirement.id).not.toBe(second.requirement.id);
    expect(replay).toMatchObject({
      replayed: true,
      requirement: { id: first.requirement.id },
    });
  });

  it('rejects reusing an idempotency key with a different request', async () => {
    const { service } = createService();
    await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.incomplete,
      fixture.idempotencyKeys.conflict,
    );

    await expect(
      service.createRequirement(
        fixture.actors.productManager,
        fixture.createInputs.complete,
        fixture.idempotencyKeys.conflict,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('recovers a submission by key without creating another requirement', async () => {
    const { service } = createService();
    const created = await service.createRequirement(
      fixture.actors.productManager,
      fixture.createInputs.incomplete,
      fixture.idempotencyKeys.recovery,
    );
    const before = await service.listRequirements(
      fixture.actors.productManager,
      { scope: 'ALL', search: '', limit: 20, cursor: null },
    );
    const recovery = await service.getRequirementSubmission(
      fixture.actors.productManager,
      fixture.idempotencyKeys.recovery,
    );
    const after = await service.listRequirements(
      fixture.actors.productManager,
      { scope: 'ALL', search: '', limit: 20, cursor: null },
    );

    expect(recovery).toEqual({
      status: 'CREATED',
      existingResourceId: created.requirement.id,
    });
    expect(after.items).toHaveLength(before.items.length);
  });

  it('completes G0 once and rejects a stale row version', async () => {
    const { repository, service } = createService();
    const completed = await service.completeG0Registration(
      fixture.actors.productManager,
      fixture.requirementIds.incomplete,
      fixture.completeRegistration,
      0,
      fixture.idempotencyKeys.completeRegistration,
    );

    expect(completed.requirement).toMatchObject({
      rowVersion: 1,
      gateProjection: 'NOT_STARTED',
      missingFields: [],
      currentBaseline: { versionNumber: 1 },
    });
    await expect(
      repository.listMaterialRefsByBaseline(
        completed.requirement.currentBaseline!.id,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        referenceType: 'ORIGINAL_IDEA',
        source: 'T3 synthetic local-only idea INCOMPLETE.',
        version: '1',
        contentHash: `sha256:${createHash('sha256')
          .update('T3 synthetic local-only idea INCOMPLETE.')
          .digest('hex')}`,
        sensitivity: 'RESTRICTED',
        validity: 'VALID',
      }),
    ]);
    await expect(
      service.completeG0Registration(
        fixture.actors.productManager,
        fixture.requirementIds.incomplete,
        fixture.completeRegistration,
        0,
        fixture.idempotencyKeys.completeRegistration,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      requirement: {
        id: fixture.requirementIds.incomplete,
        rowVersion: 1,
        gateProjection: 'NOT_STARTED',
      },
    });
    await expect(
      service.completeG0Registration(
        fixture.actors.productManager,
        fixture.requirementIds.incomplete,
        fixture.completeRegistration,
        0,
        fixture.idempotencyKeys.staleRegistration,
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolation);
    await expect(
      service.completeG0Registration(
        fixture.actors.productManager,
        fixture.requirementIds.incomplete,
        fixture.completeRegistration,
        0,
        fixture.idempotencyKeys.staleRegistration,
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
