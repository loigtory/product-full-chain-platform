import type {
  ArtifactEvidencePort,
  ArtifactEvidenceRequest,
  AuthorizationLookup,
  AuthorizationPort,
  CapabilityResult,
  DeliverySummary,
  DeliverySummaryPort,
  DeliverySummaryRequest,
  EvidenceDescriptor,
  GateExecutionCapability,
  GateExecutionCapabilityRequest,
  GateExecutionPort,
  GateExecutionReceipt,
  GateExecutionRequest,
  LifecycleStage,
  RequirementAction,
  RequirementAuthorizationSnapshot,
} from '@pfc/contracts';

export type DependencyRuntimeConfig = Readonly<{
  appEnvironment:
    'local' | 'test' | 'development' | 'preview' | 'staging' | 'production';
  fixtureAdaptersEnabled: boolean;
}>;

export type DependencyFixtureSet = Readonly<{
  authorization?: readonly Readonly<{
    actorId: string;
    requirementId: string;
    action: RequirementAction;
    data: RequirementAuthorizationSnapshot;
  }>[];
  artifacts?: readonly Readonly<{
    actorId: string;
    requirementId: string;
    baselineId: string;
    evidenceRefIds: readonly string[];
    data: readonly EvidenceDescriptor[];
  }>[];
  gateExecutions?: readonly Readonly<{
    actorId: string;
    requirementId: string;
    baselineId: string;
    stage: LifecycleStage;
    idempotencyKey: string;
    data: GateExecutionReceipt;
  }>[];
  gateExecutionCapabilities?: readonly Readonly<{
    actorId: string;
    requirementId: string;
    baselineId: string;
    stage: LifecycleStage;
    data: GateExecutionCapability;
  }>[];
  deliverySummaries?: readonly Readonly<{
    actorId: string;
    requirementId: string;
    baselineId: string;
    stage: LifecycleStage;
    data: DeliverySummary;
  }>[];
}>;

export type DependencyPorts = Readonly<{
  authorization: AuthorizationPort;
  artifactEvidence: ArtifactEvidencePort;
  gateExecution: GateExecutionPort;
  deliverySummary: DeliverySummaryPort;
}>;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;
type Clock = () => string;

const environments = [
  'local',
  'test',
  'development',
  'preview',
  'staging',
  'production',
] as const;

function assertFixtureEnvironment(config: DependencyRuntimeConfig): void {
  if (
    config.fixtureAdaptersEnabled &&
    config.appEnvironment !== 'local' &&
    config.appEnvironment !== 'test'
  ) {
    throw new Error('FIXTURE_ADAPTER_ENV_FORBIDDEN');
  }
}

export function loadDependencyRuntimeConfig(
  environment: EnvironmentSource,
): DependencyRuntimeConfig {
  if (
    !environments.includes(environment.APP_ENV as (typeof environments)[number])
  ) {
    throw new Error('APP_ENV_INVALID');
  }
  if (
    environment.FIXTURE_ADAPTERS_ENABLED !== 'true' &&
    environment.FIXTURE_ADAPTERS_ENABLED !== 'false'
  ) {
    throw new Error('FIXTURE_ADAPTER_FLAG_INVALID');
  }
  const config: DependencyRuntimeConfig = {
    appEnvironment:
      environment.APP_ENV as DependencyRuntimeConfig['appEnvironment'],
    fixtureAdaptersEnabled: environment.FIXTURE_ADAPTERS_ENABLED === 'true',
  };
  assertFixtureEnvironment(config);
  return config;
}

function unavailable<T>(checkedAt: string): CapabilityResult<T> {
  return {
    status: 'UNAVAILABLE',
    source: 'UNAVAILABLE',
    capabilityVersion: 'unconfigured/v1',
    checkedAt,
    reasonCode: 'CAPABILITY_NOT_CONFIGURED',
  };
}

function fixtureUnknown<T>(checkedAt: string): CapabilityResult<T> {
  return {
    status: 'UNKNOWN',
    source: 'FIXTURE',
    capabilityVersion: 'fixture/t2/v1',
    checkedAt,
    reasonCode: 'FIXTURE_RESULT_NOT_FOUND',
  };
}

function fixtureAvailable<T>(checkedAt: string, data: T): CapabilityResult<T> {
  return {
    status: 'AVAILABLE',
    source: 'FIXTURE',
    capabilityVersion: 'fixture/t2/v1',
    checkedAt,
    data,
  };
}

function sameStringSet(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value) => second.includes(value)) &&
    second.every((value) => first.includes(value))
  );
}

export function createUnavailableDependencyPorts(
  clock: Clock = () => new Date().toISOString(),
): DependencyPorts {
  return {
    authorization: {
      lookupRequirementAuthorization: async () =>
        unavailable<RequirementAuthorizationSnapshot>(clock()),
    },
    artifactEvidence: {
      listEvidence: async () =>
        unavailable<readonly EvidenceDescriptor[]>(clock()),
    },
    gateExecution: {
      getGateExecutionCapability: async () =>
        unavailable<GateExecutionCapability>(clock()),
      executeGate: async () => unavailable<GateExecutionReceipt>(clock()),
    },
    deliverySummary: {
      getDeliverySummary: async () => unavailable<DeliverySummary>(clock()),
    },
  };
}

function createFixturePorts(
  fixtures: DependencyFixtureSet,
  clock: Clock,
): DependencyPorts {
  return {
    authorization: {
      lookupRequirementAuthorization: async (request: AuthorizationLookup) => {
        const match = fixtures.authorization?.find(
          (item) =>
            item.actorId === request.actor.actorId &&
            item.requirementId === request.requirementId &&
            item.action === request.action,
        );
        return match
          ? fixtureAvailable(clock(), match.data)
          : fixtureUnknown(clock());
      },
    },
    artifactEvidence: {
      listEvidence: async (request: ArtifactEvidenceRequest) => {
        const match = fixtures.artifacts?.find(
          (item) =>
            item.actorId === request.actorId &&
            item.requirementId === request.requirementId &&
            item.baselineId === request.baselineId &&
            sameStringSet(item.evidenceRefIds, request.evidenceRefIds),
        );
        return match
          ? fixtureAvailable(clock(), match.data)
          : fixtureUnknown(clock());
      },
    },
    gateExecution: {
      getGateExecutionCapability: async (
        request: GateExecutionCapabilityRequest,
      ) => {
        const match = fixtures.gateExecutionCapabilities?.find(
          (item) =>
            item.actorId === request.actorId &&
            item.requirementId === request.requirementId &&
            item.baselineId === request.baselineId &&
            item.stage === request.stage,
        );
        return match
          ? fixtureAvailable(clock(), match.data)
          : fixtureUnknown<GateExecutionCapability>(clock());
      },
      executeGate: async (request: GateExecutionRequest) => {
        const match = fixtures.gateExecutions?.find(
          (item) =>
            item.actorId === request.actorId &&
            item.requirementId === request.requirementId &&
            item.baselineId === request.baselineId &&
            item.stage === request.stage &&
            item.idempotencyKey === request.idempotencyKey,
        );
        return match
          ? fixtureAvailable(clock(), match.data)
          : fixtureUnknown(clock());
      },
    },
    deliverySummary: {
      getDeliverySummary: async (request: DeliverySummaryRequest) => {
        const match = fixtures.deliverySummaries?.find(
          (item) =>
            item.actorId === request.actorId &&
            item.requirementId === request.requirementId &&
            item.baselineId === request.baselineId &&
            item.stage === request.stage,
        );
        return match
          ? fixtureAvailable(clock(), match.data)
          : fixtureUnknown(clock());
      },
    },
  };
}

export function createDependencyPorts(
  config: DependencyRuntimeConfig,
  fixtures: DependencyFixtureSet = {},
  clock: Clock = () => new Date().toISOString(),
): DependencyPorts {
  assertFixtureEnvironment(config);
  return config.fixtureAdaptersEnabled
    ? createFixturePorts(fixtures, clock)
    : createUnavailableDependencyPorts(clock);
}
