import { describe, expect, it } from 'vitest';

import {
  loadDeliveryPlan,
  validateDeliveryPlan,
  validateRuntimeConfiguration,
} from '../../scripts/check-delivery-governance.ts';

function clonePlan() {
  return structuredClone(loadDeliveryPlan());
}

describe('POD delivery governance', () => {
  it('accepts the checked-in POD-PFC-001 delivery ledger', () => {
    expect(validateDeliveryPlan(clonePlan())).toEqual([]);
  });

  it('requires all five confirmed CAPs and all 26 Units', () => {
    const plan = clonePlan();
    plan.capabilities = plan.capabilities.filter(
      (capability) => capability.id !== 'CAP-PFC-03',
    );

    expect(validateDeliveryPlan(plan)).toContain(
      'CAPABILITY_SET_MISMATCH:CAP-PFC-03',
    );
  });

  it('does not allow M1 completion while its cross-CAP Units are incomplete', () => {
    const plan = clonePlan();
    const milestone = plan.milestones.find((item) => item.id === 'M1');
    const artifactCatalog = plan.capabilities
      .find((item) => item.id === 'CAP-PFC-02')
      ?.units.find((item) => item.id === 'UNIT-PFC-02-01');
    if (!milestone) throw new Error('M1_REQUIRED');
    if (!artifactCatalog) throw new Error('M1_ARTIFACT_CATALOG_REQUIRED');
    artifactCatalog.status = 'LOCAL_VERIFIED';
    milestone.status = 'COMPLETED';

    expect(validateDeliveryPlan(plan)).toContain(
      'MILESTONE_COMPLETION_INVALID:M1:UNIT-PFC-02-01',
    );
  });

  it('rejects fixture-backed integration and acceptance claims', () => {
    const plan = clonePlan();
    const capability = plan.capabilities.find(
      (item) => item.id === 'CAP-PFC-01',
    );
    if (!capability) throw new Error('CAP_PFC_01_REQUIRED');
    capability.integrationStatus = 'INTEGRATED';
    capability.acceptanceStatus = 'ACCEPTED';
    capability.dependencySources = ['FIXTURE'];

    expect(validateDeliveryPlan(plan)).toEqual(
      expect.arrayContaining([
        'FIXTURE_INTEGRATION_CLAIM:CAP-PFC-01',
        'FIXTURE_ACCEPTANCE_CLAIM:CAP-PFC-01',
      ]),
    );
  });

  it('requires PostgreSQL business persistence and test-only fixtures', () => {
    const plan = clonePlan();
    plan.runtimeDataPolicy.businessStateStore = 'MEMORY';
    plan.runtimeDataPolicy.interactiveFixturePolicy = 'ALLOWED';
    plan.runtimeDataPolicy.acceptanceMayUseFixture = true;

    expect(validateDeliveryPlan(plan)).toEqual(
      expect.arrayContaining([
        'BUSINESS_STATE_STORE_INVALID',
        'INTERACTIVE_FIXTURE_POLICY_INVALID',
        'FIXTURE_ACCEPTANCE_POLICY_INVALID',
      ]),
    );
  });

  it('requires one explicit POD-level next route while delivery is incomplete', () => {
    const plan = clonePlan();
    plan.platformStatus.nextRoute = '';

    expect(validateDeliveryPlan(plan)).toContain('POD_NEXT_ROUTE_REQUIRED');
  });

  it('rejects fixture and experience modes in an actual local runtime config', () => {
    expect(
      validateRuntimeConfiguration(
        'FIXTURE_ADAPTERS_ENABLED=true\nPFC_EXPERIENCE_MODE=true\nPFC_LOCAL_TEST_RUN_ID=M2_R1_REAL_20260906\n',
        'LOCAL',
      ),
    ).toEqual([
      'FIXTURE_RUNTIME_FORBIDDEN:LOCAL',
      'EXPERIENCE_RUNTIME_FORBIDDEN:LOCAL',
      'LOCAL_TEST_RUN_ID_STANDARD_SCHEMA_FORBIDDEN:LOCAL',
    ]);
  });

  it('allows a missing or blank local test run ID in standard config', () => {
    expect(
      validateRuntimeConfiguration(
        [
          'FIXTURE_ADAPTERS_ENABLED=false',
          'PFC_EXPERIENCE_MODE=false',
          'PFC_LOCAL_TEST_RUN_ID=',
          'SOME_OTHER_KEY=value',
          '',
        ].join('\r\n'),
        'LOCAL',
      ),
    ).toEqual([]);
    expect(
      validateRuntimeConfiguration(
        'FIXTURE_ADAPTERS_ENABLED=false\nPFC_EXPERIENCE_MODE=false\n',
        'LOCAL',
      ),
    ).toEqual([]);
  });
});
