import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

type UnitStatus =
  | 'PLANNED'
  | 'DESIGN_PENDING'
  | 'IMPLEMENTING'
  | 'LOCAL_VERIFIED'
  | 'INTEGRATED'
  | 'ACCEPTED'
  | 'DEFERRED';

type Capability = {
  id: string;
  implementationStatus: UnitStatus;
  integrationStatus: 'NOT_STARTED' | 'BLOCKED' | 'IN_PROGRESS' | 'INTEGRATED';
  acceptanceStatus: 'NOT_STARTED' | 'BLOCKED' | 'ACCEPTED';
  dependencySources: string[];
  nextRoute: string;
  units: Array<{ id: string; status: UnitStatus }>;
};

type DeliveryPlan = {
  podId: string;
  authority: {
    confirmedCapabilityCount: number;
    confirmedUnitCount: number;
  };
  currentMilestone: string;
  milestones: Array<{
    id: string;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
    requiredUnitIds: string[];
  }>;
  capabilities: Capability[];
  runtimeDataPolicy: {
    businessStateStore: string;
    standardDatabase: string;
    standardSchema: string;
    interactiveFixturePolicy: string;
    testSchemaPattern: string;
    acceptanceMayUseFixture: boolean;
    legacyModes: Array<{
      name: string;
      status: string;
      countedAsCapability: boolean;
    }>;
  };
  platformStatus: { nextRoute: string };
};

const expectedUnits = new Map<string, string[]>([
  ['CAP-PFC-01', createUnitIds('CAP-PFC-01', 5)],
  ['CAP-PFC-02', createUnitIds('CAP-PFC-02', 5)],
  ['CAP-PFC-03', createUnitIds('CAP-PFC-03', 6)],
  ['CAP-PFC-04', createUnitIds('CAP-PFC-04', 5)],
  ['CAP-PFC-05', createUnitIds('CAP-PFC-05', 5)],
]);

const expectedMilestoneUnits = new Map<string, string[]>([
  [
    'M1',
    [
      ...createUnitIds('CAP-PFC-01', 5),
      'UNIT-PFC-02-01',
      'UNIT-PFC-04-01',
      'UNIT-PFC-04-02',
      'UNIT-PFC-04-03',
    ],
  ],
  [
    'M2',
    [
      'UNIT-PFC-02-02',
      'UNIT-PFC-02-03',
      'UNIT-PFC-02-04',
      'UNIT-PFC-02-05',
      'UNIT-PFC-03-01',
      'UNIT-PFC-03-02',
      'UNIT-PFC-03-03',
      'UNIT-PFC-03-05',
      'UNIT-PFC-03-06',
      'UNIT-PFC-04-04',
      'UNIT-PFC-04-05',
    ],
  ],
  ['M3', ['UNIT-PFC-03-04', ...createUnitIds('CAP-PFC-05', 5)]],
]);

function createUnitIds(capabilityId: string, count: number): string[] {
  const prefix = capabilityId.replace('CAP-', 'UNIT-');
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`,
  );
}

function compareSets(
  actual: readonly string[],
  expected: readonly string[],
): string[] {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return [
    ...expected.filter((value) => !actualSet.has(value)),
    ...actual.filter((value) => !expectedSet.has(value)),
  ];
}

export function loadDeliveryPlan(root = process.cwd()): DeliveryPlan {
  return JSON.parse(
    readFileSync(resolve(root, '.quality-gate/delivery-plan.json'), 'utf8'),
  ) as DeliveryPlan;
}

export function validateDeliveryPlan(plan: DeliveryPlan): string[] {
  const errors: string[] = [];
  const capabilityIds = plan.capabilities.map(({ id }) => id);
  const expectedCapabilityIds = [...expectedUnits.keys()];

  for (const id of compareSets(capabilityIds, expectedCapabilityIds)) {
    errors.push(`CAPABILITY_SET_MISMATCH:${id}`);
  }
  if (
    new Set(capabilityIds).size !== capabilityIds.length ||
    plan.authority.confirmedCapabilityCount !== 5
  ) {
    errors.push('CAPABILITY_COUNT_INVALID');
  }

  const unitStatuses = new Map<string, UnitStatus>();
  for (const capability of plan.capabilities) {
    const expected = expectedUnits.get(capability.id) ?? [];
    const actual = capability.units.map(({ id }) => id);
    for (const id of compareSets(actual, expected)) {
      errors.push(`UNIT_SET_MISMATCH:${capability.id}:${id}`);
    }
    for (const unit of capability.units) {
      if (unitStatuses.has(unit.id)) errors.push(`UNIT_DUPLICATE:${unit.id}`);
      unitStatuses.set(unit.id, unit.status);
    }

    const hasNonRealDependency = capability.dependencySources.some((source) =>
      ['FIXTURE', 'UNAVAILABLE'].includes(source),
    );
    if (capability.integrationStatus === 'INTEGRATED' && hasNonRealDependency) {
      errors.push(`FIXTURE_INTEGRATION_CLAIM:${capability.id}`);
    }
    if (capability.acceptanceStatus === 'ACCEPTED' && hasNonRealDependency) {
      errors.push(`FIXTURE_ACCEPTANCE_CLAIM:${capability.id}`);
    }
    if (
      capability.acceptanceStatus !== 'ACCEPTED' &&
      !capability.nextRoute.trim()
    ) {
      errors.push(`CAP_NEXT_ROUTE_REQUIRED:${capability.id}`);
    }
  }

  if (unitStatuses.size !== 26 || plan.authority.confirmedUnitCount !== 26) {
    errors.push('UNIT_COUNT_INVALID');
  }

  const milestoneIds = plan.milestones.map(({ id }) => id);
  for (const id of compareSets(milestoneIds, [
    ...expectedMilestoneUnits.keys(),
  ])) {
    errors.push(`MILESTONE_SET_MISMATCH:${id}`);
  }
  for (const milestone of plan.milestones) {
    const expected = expectedMilestoneUnits.get(milestone.id) ?? [];
    for (const id of compareSets(milestone.requiredUnitIds, expected)) {
      errors.push(`MILESTONE_SCOPE_MISMATCH:${milestone.id}:${id}`);
    }
    if (milestone.status === 'COMPLETED') {
      for (const unitId of milestone.requiredUnitIds) {
        if (
          !['INTEGRATED', 'ACCEPTED'].includes(unitStatuses.get(unitId) ?? '')
        ) {
          errors.push(`MILESTONE_COMPLETION_INVALID:${milestone.id}:${unitId}`);
        }
      }
    }
  }

  if (!milestoneIds.includes(plan.currentMilestone)) {
    errors.push('CURRENT_MILESTONE_INVALID');
  }
  if (plan.runtimeDataPolicy.businessStateStore !== 'POSTGRESQL') {
    errors.push('BUSINESS_STATE_STORE_INVALID');
  }
  if (
    plan.runtimeDataPolicy.standardDatabase !== 'pfc_local' ||
    plan.runtimeDataPolicy.standardSchema !== 'pfc'
  ) {
    errors.push('STANDARD_DATABASE_TARGET_INVALID');
  }
  if (plan.runtimeDataPolicy.interactiveFixturePolicy !== 'TEST_ONLY') {
    errors.push('INTERACTIVE_FIXTURE_POLICY_INVALID');
  }
  if (plan.runtimeDataPolicy.testSchemaPattern !== 'codex_test_*') {
    errors.push('TEST_SCHEMA_POLICY_INVALID');
  }
  if (plan.runtimeDataPolicy.acceptanceMayUseFixture !== false) {
    errors.push('FIXTURE_ACCEPTANCE_POLICY_INVALID');
  }
  const experienceMode = plan.runtimeDataPolicy.legacyModes.find(
    ({ name }) => name === 'pfc_experience',
  );
  if (
    !experienceMode ||
    experienceMode.countedAsCapability ||
    experienceMode.status !== 'RETIRE_BEFORE_M1_EXIT'
  ) {
    errors.push('LEGACY_EXPERIENCE_POLICY_INVALID');
  }
  if (!plan.platformStatus.nextRoute.trim()) {
    errors.push('POD_NEXT_ROUTE_REQUIRED');
  }

  return [...new Set(errors)];
}

export function validateRuntimeConfiguration(
  input: string,
  source: string,
): string[] {
  const errors: string[] = [];
  if (/^FIXTURE_ADAPTERS_ENABLED=true\s*$/m.test(input)) {
    errors.push(`FIXTURE_RUNTIME_FORBIDDEN:${source}`);
  }
  if (/^PFC_EXPERIENCE_MODE=true\s*$/m.test(input)) {
    errors.push(`EXPERIENCE_RUNTIME_FORBIDDEN:${source}`);
  }
  if (/^PFC_LOCAL_TEST_RUN_ID=[^\S\r\n]*\S.*$/m.test(input)) {
    errors.push(`LOCAL_TEST_RUN_ID_STANDARD_SCHEMA_FORBIDDEN:${source}`);
  }
  return errors;
}

export function checkDeliveryGovernance(root = process.cwd()): void {
  const plan = loadDeliveryPlan(root);
  const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
  const errors = validateDeliveryPlan(plan);
  const localEnvironmentPath = resolve(root, '.env.local');

  if (!/^FIXTURE_ADAPTERS_ENABLED=false\s*$/m.test(envExample)) {
    errors.push('FIXTURE_DEFAULT_MUST_BE_DISABLED');
  }
  if (!/^PFC_EXPERIENCE_MODE=false\s*$/m.test(envExample)) {
    errors.push('EXPERIENCE_DEFAULT_MUST_BE_DISABLED');
  }
  if (existsSync(localEnvironmentPath)) {
    errors.push(
      ...validateRuntimeConfiguration(
        readFileSync(localEnvironmentPath, 'utf8'),
        'LOCAL',
      ),
    );
  }
  if (errors.length > 0) {
    throw new Error(`DELIVERY_GOVERNANCE_INVALID:${errors.join(',')}`);
  }

  const unitCount = plan.capabilities.reduce(
    (total, capability) => total + capability.units.length,
    0,
  );
  console.log(
    `DELIVERY_GOVERNANCE_OK pod=${plan.podId} caps=${plan.capabilities.length} units=${unitCount} milestone=${plan.currentMilestone} next=${plan.platformStatus.nextRoute}`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkDeliveryGovernance();
}
