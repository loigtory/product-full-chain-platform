import { describe, expect, it, vi } from 'vitest';

import { createDependencyPorts } from '../../apps/server/src/dependencies/index.ts';
import { GateRunApplicationService } from '../../apps/server/src/gate-runs/index.ts';
import { InMemoryRequirementRepository } from '../../apps/server/src/requirements/in-memory-repository.ts';
import { DomainRuleViolation } from '../../packages/domain/src/index.ts';
import { createT5Fixture } from '../../packages/test-data/src/index.ts';

function harness(runId: string, options: { dueQuestion?: boolean } = {}) {
  const fixture = createT5Fixture(runId);
  const repository = new InMemoryRequirementRepository(
    [fixture.requirementWrite],
    options.dueQuestion ? [fixture.dueQuestionRecord] : fixture.questionRecords,
  );
  const ports = createDependencyPorts(
    { appEnvironment: 'test', fixtureAdaptersEnabled: true },
    fixture.dependencyFixtures,
    () => fixture.now,
  );
  const executeGate = vi.fn(ports.gateExecution.executeGate);
  const service = new GateRunApplicationService({
    repository,
    authorizationPort: ports.authorization,
    artifactEvidencePort: ports.artifactEvidence,
    gateExecutionPort: {
      ...ports.gateExecution,
      executeGate,
    },
    now: () => fixture.now,
    idFactory: fixture.createIdFactory(),
  });
  return { fixture, repository, service, executeGate, ports };
}

describe('T5 GateRun application service', () => {
  it('does not create an automatic run when the execution capability is unavailable', async () => {
    const { fixture, repository, ports } = harness('T5_APP_UNAVAILABLE');
    const service = new GateRunApplicationService({
      repository,
      authorizationPort: ports.authorization,
      artifactEvidencePort: ports.artifactEvidence,
      gateExecutionPort: {
        getGateExecutionCapability: async () => ({
          status: 'UNAVAILABLE',
          source: 'UNAVAILABLE',
          capabilityVersion: 'unconfigured/v1',
          checkedAt: fixture.now,
          reasonCode: 'CAPABILITY_NOT_CONFIGURED',
        }),
        executeGate: vi.fn(),
      },
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });

    await expect(
      service.startAutomaticGateRun(
        fixture.actors.productManager,
        fixture.requirementId,
        fixture.automaticRequest,
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.automatic,
      ),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(
      await repository.listGateRunRecordsByRequirement(fixture.requirementId),
    ).toEqual([]);
  });

  it('creates a local BLOCK without calling the execution port for a due OPEN question', async () => {
    const { fixture, service, executeGate } = harness('T5_APP_BLOCK', {
      dueQuestion: true,
    });
    const response = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automatic,
    );

    expect(response.gateRun).toMatchObject({
      status: 'COMPLETED',
      result: 'BLOCK',
      checks: [
        expect.objectContaining({
          result: 'BLOCK',
          ownerId: fixture.dueQuestionRecord.question.ownerId,
        }),
      ],
    });
    expect(response.requirement.currentStage).toBe('G0');
    expect(executeGate).not.toHaveBeenCalled();
  });

  it('completes an automatic PASS and advances exactly once on replay', async () => {
    const { fixture, service, executeGate } = harness('T5_APP_PASS');
    const first = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automatic,
    );
    const replay = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automatic,
    );

    expect(first).toMatchObject({
      gateRun: {
        result: 'PASS',
        advancement: { fromStage: 'G0', toStage: 'G1' },
      },
      requirement: { currentStage: 'G1' },
    });
    expect(replay).toMatchObject({
      replayed: true,
      gateRun: { id: first.gateRun.id },
      requirement: { currentStage: 'G1' },
    });
    expect(executeGate).toHaveBeenCalledTimes(1);
  });

  it('reuses one IN_PROGRESS run for a different idempotency key', async () => {
    const { fixture, repository, ports } = harness('T5_APP_PROCESSING');
    const executeGate = vi.fn(async () => ({
      status: 'AVAILABLE' as const,
      source: 'FIXTURE' as const,
      capabilityVersion: 'fixture/t5/v1',
      checkedAt: fixture.now,
      data: {
        executionId: `${fixture.prefix}_EXECUTION_RUNNING`,
        status: 'RUNNING' as const,
        result: null,
      },
    }));
    const service = new GateRunApplicationService({
      repository,
      authorizationPort: ports.authorization,
      artifactEvidencePort: ports.artifactEvidence,
      gateExecutionPort: {
        ...ports.gateExecution,
        executeGate,
      },
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });
    const first = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automatic,
    );
    const second = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automaticSecond,
    );

    expect(first.gateRun.status).toBe('IN_PROGRESS');
    expect(second).toMatchObject({
      reusedInProgress: true,
      gateRun: { id: first.gateRun.id, status: 'IN_PROGRESS' },
    });
    expect(executeGate).toHaveBeenCalledTimes(1);
  });

  it('registers a manual PASS only with current accessible evidence and responsibility', async () => {
    const { fixture, service } = harness('T5_APP_MANUAL');
    const response = await service.registerManualGateRun(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.manualRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.manual,
    );

    expect(response).toMatchObject({
      gateRun: {
        mode: 'MANUAL',
        result: 'PASS',
        confirmedRole: 'BUSINESS_OWNER',
        evidence: [{ evidenceRefId: fixture.evidenceRefId }],
      },
      requirement: { currentStage: 'G1' },
    });
  });

  it('resumes an idempotent manual run left IN_PROGRESS by a failed completion', async () => {
    const { fixture, service, repository } = harness('T5_APP_MANUAL_RESUME');
    const complete = repository.completeGateRun.bind(repository);
    let failCompletion = true;
    repository.completeGateRun = vi.fn(async (command) => {
      if (failCompletion) throw new Error('synthetic completion failure');
      return complete(command);
    });

    await expect(
      service.registerManualGateRun(
        fixture.actors.businessOwner,
        fixture.requirementId,
        fixture.manualRequest,
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.manual,
      ),
    ).rejects.toThrow('synthetic completion failure');
    await expect(
      repository.listGateRunRecordsByRequirement(fixture.requirementId),
    ).resolves.toEqual([
      expect.objectContaining({
        gateRun: expect.objectContaining({ status: 'IN_PROGRESS' }),
      }),
    ]);

    failCompletion = false;
    const recovered = await service.registerManualGateRun(
      fixture.actors.businessOwner,
      fixture.requirementId,
      fixture.manualRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.manual,
    );

    expect(recovered).toMatchObject({
      replayed: true,
      reusedInProgress: false,
      gateRun: { status: 'COMPLETED', result: 'PASS' },
      requirement: { currentStage: 'G1' },
    });
  });

  it('rejects invalid evidence and leaves GateRun empty', async () => {
    const { fixture, service, repository } = harness('T5_APP_BAD_EVIDENCE');
    await expect(
      service.registerManualGateRun(
        fixture.actors.businessOwner,
        fixture.requirementId,
        { ...fixture.manualRequest, evidenceRefIds: ['CODEx_TEST_WRONG'] },
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.manual,
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolation);
    expect(
      await repository.listGateRunRecordsByRequirement(fixture.requirementId),
    ).toEqual([]);
  });

  it('rejects duplicate evidence descriptors that do not cover every requested ref', async () => {
    const { fixture, repository, ports } = harness('T5_APP_DUPLICATE_EVIDENCE');
    const duplicateEvidence = fixture.dependencyFixtures.artifacts[0]!.data[0]!;
    const service = new GateRunApplicationService({
      repository,
      authorizationPort: ports.authorization,
      artifactEvidencePort: {
        listEvidence: async () => ({
          status: 'AVAILABLE',
          source: 'FIXTURE',
          capabilityVersion: 'fixture/t5/duplicate-evidence',
          checkedAt: fixture.now,
          data: [duplicateEvidence, duplicateEvidence],
        }),
      },
      gateExecutionPort: ports.gateExecution,
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });

    await expect(
      service.registerManualGateRun(
        fixture.actors.businessOwner,
        fixture.requirementId,
        {
          ...fixture.manualRequest,
          evidenceRefIds: [
            fixture.evidenceRefId,
            `${fixture.prefix}_EVIDENCE_MISSING`,
          ],
        },
        fixture.requirementWrite.requirement.rowVersion,
        fixture.idempotencyKeys.manual,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      repository.listGateRunRecordsByRequirement(fixture.requirementId),
    ).resolves.toEqual([]);
  });

  it('persists UNKNOWN without advancing when execution cannot be confirmed', async () => {
    const { fixture, repository, ports } = harness('T5_APP_UNKNOWN');
    const service = new GateRunApplicationService({
      repository,
      authorizationPort: ports.authorization,
      artifactEvidencePort: ports.artifactEvidence,
      gateExecutionPort: {
        ...ports.gateExecution,
        executeGate: async () => ({
          status: 'UNKNOWN',
          source: 'FIXTURE',
          capabilityVersion: 'fixture/t5/v1',
          checkedAt: fixture.now,
          reasonCode: 'EXECUTION_RESULT_UNKNOWN',
        }),
      },
      now: () => fixture.now,
      idFactory: fixture.createIdFactory(),
    });
    const response = await service.startAutomaticGateRun(
      fixture.actors.productManager,
      fixture.requirementId,
      fixture.automaticRequest,
      fixture.requirementWrite.requirement.rowVersion,
      fixture.idempotencyKeys.automatic,
    );

    expect(response).toMatchObject({
      gateRun: { result: 'UNKNOWN', unknownReason: 'EXECUTION_RESULT_UNKNOWN' },
      requirement: { currentStage: 'G0' },
    });
  });
});
