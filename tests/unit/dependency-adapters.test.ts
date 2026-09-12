import { describe, expect, it } from 'vitest';

import {
  createDependencyPorts,
  loadDependencyRuntimeConfig,
} from '../../apps/server/src/dependencies/index.ts';
import { createT2AccessFixture } from '../../packages/test-data/src/index.ts';

const fixture = createT2AccessFixture('T2_ADAPTERS');

describe('T2 dependency configuration isolation', () => {
  it('parses explicit local fixture configuration', () => {
    expect(
      loadDependencyRuntimeConfig({
        APP_ENV: 'local',
        FIXTURE_ADAPTERS_ENABLED: 'true',
      }),
    ).toEqual({ appEnvironment: 'local', fixtureAdaptersEnabled: true });
  });

  it.each(['preview', 'staging', 'production'])(
    'rejects fixture adapters in %s',
    (appEnvironment) => {
      expect(() =>
        loadDependencyRuntimeConfig({
          APP_ENV: appEnvironment,
          FIXTURE_ADAPTERS_ENABLED: 'true',
        }),
      ).toThrowError('FIXTURE_ADAPTER_ENV_FORBIDDEN');
    },
  );

  it('rejects missing or ambiguous environment configuration', () => {
    expect(() =>
      loadDependencyRuntimeConfig({ FIXTURE_ADAPTERS_ENABLED: 'false' }),
    ).toThrowError('APP_ENV_INVALID');
    expect(() =>
      loadDependencyRuntimeConfig({
        APP_ENV: 'local',
        FIXTURE_ADAPTERS_ENABLED: 'yes',
      }),
    ).toThrowError('FIXTURE_ADAPTER_FLAG_INVALID');
  });
});

describe('T2 unavailable and fixture dependency adapters', () => {
  it('returns explicit unavailable results by default without fabricated data', async () => {
    const ports = createDependencyPorts({
      appEnvironment: 'local',
      fixtureAdaptersEnabled: false,
    });
    const results = await Promise.all([
      ports.authorization.lookupRequirementAuthorization(
        fixture.portRequests.authorization,
      ),
      ports.artifactEvidence.listEvidence(fixture.portRequests.artifacts),
      ports.gateExecution.executeGate(fixture.portRequests.gateExecution),
      ports.deliverySummary.getDeliverySummary(
        fixture.portRequests.deliverySummary,
      ),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        status: 'UNAVAILABLE',
        source: 'UNAVAILABLE',
        capabilityVersion: 'unconfigured/v1',
        reasonCode: 'CAPABILITY_NOT_CONFIGURED',
      });
      expect('data' in result).toBe(false);
    }
  });

  it('returns only explicitly configured fixture results and marks missing entries UNKNOWN', async () => {
    const ports = createDependencyPorts(
      { appEnvironment: 'test', fixtureAdaptersEnabled: true },
      fixture.dependencyFixtures,
    );

    await expect(
      ports.authorization.lookupRequirementAuthorization(
        fixture.portRequests.authorization,
      ),
    ).resolves.toMatchObject({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      data: fixture.snapshots.allowed,
    });
    await expect(
      ports.artifactEvidence.listEvidence(fixture.portRequests.artifacts),
    ).resolves.toMatchObject({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      data: [expect.objectContaining({ evidenceRefId: fixture.materialRefId })],
    });
    await expect(
      ports.gateExecution.executeGate(fixture.portRequests.gateExecution),
    ).resolves.toMatchObject({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      data: { result: 'BLOCK' },
    });
    await expect(
      ports.deliverySummary.getDeliverySummary(
        fixture.portRequests.deliverySummary,
      ),
    ).resolves.toMatchObject({
      status: 'AVAILABLE',
      source: 'FIXTURE',
      data: { status: 'MISSING', result: 'BLOCK' },
    });

    await expect(
      ports.authorization.lookupRequirementAuthorization({
        ...fixture.portRequests.authorization,
        requirementId: 'CODEx_TEST_T2_ADAPTERS_REQ_MISSING',
      }),
    ).resolves.toMatchObject({
      status: 'UNKNOWN',
      source: 'FIXTURE',
      reasonCode: 'FIXTURE_RESULT_NOT_FOUND',
    });

    const mismatchedResults = await Promise.all([
      ports.authorization.lookupRequirementAuthorization({
        ...fixture.portRequests.authorization,
        action: 'CONFIRM_QUESTION',
      }),
      ports.artifactEvidence.listEvidence({
        ...fixture.portRequests.artifacts,
        evidenceRefIds: ['CODEx_TEST_T2_ADAPTERS_MATERIAL_MISSING'],
      }),
      ports.gateExecution.executeGate({
        ...fixture.portRequests.gateExecution,
        idempotencyKey: 'CODEx_TEST_T2_ADAPTERS_IDEMPOTENCY_OTHER',
      }),
      ports.deliverySummary.getDeliverySummary({
        ...fixture.portRequests.deliverySummary,
        actorId: fixture.actors.outsider.actorId,
      }),
    ]);
    for (const result of mismatchedResults) {
      expect(result).toMatchObject({
        status: 'UNKNOWN',
        source: 'FIXTURE',
        reasonCode: 'FIXTURE_RESULT_NOT_FOUND',
      });
      expect('data' in result).toBe(false);
    }
  });
});
