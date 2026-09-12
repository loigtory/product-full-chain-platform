import { CAPABILITY_STATES, type CapabilityState } from './capabilities.ts';
import { PRODUCT_WORK_TURN_PROTOCOL_VERSION } from './product-work-turn.ts';

export const BRIDGE_CAPABILITY_SNAPSHOT_VERSION =
  'pfc-bridge-capabilities/1' as const;
export const BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION =
  'pfc-bridge-capabilities/2' as const;

export type BridgeCapabilitySnapshotV1 = Readonly<{
  snapshotVersion: typeof BRIDGE_CAPABILITY_SNAPSHOT_VERSION;
  capturedAt: string;
  runtime: Readonly<{
    nodeVersion: string;
    codexAppServer: CapabilityState;
    zedCli: CapabilityState;
  }>;
  workspaces: readonly Readonly<{
    workspaceId: string;
    gitBaseline: string;
  }>[];
  skills: readonly Readonly<{
    releaseId: string;
    contentHash: string;
  }>[];
  productWorkTurn?: Readonly<{
    state: CapabilityState;
    protocolVersion: typeof PRODUCT_WORK_TURN_PROTOCOL_VERSION;
  }>;
}>;

export type BridgeMcpCapabilitySnapshot = Readonly<{
  state: CapabilityState;
  configFingerprint: string;
  servers: readonly Readonly<{
    name: string;
    runtimeStatus: 'CONNECTED' | 'UNAVAILABLE' | 'UNVERIFIED';
    authStatus: 'UNKNOWN' | 'UNSUPPORTED' | 'READY' | 'REQUIRED';
    tools: readonly Readonly<{
      name: string;
      inputSchemaHash: string;
      readOnlyHint: boolean | null;
    }>[];
  }>[];
}>;

export type BridgeCapabilitySnapshotV2 = Readonly<
  Omit<BridgeCapabilitySnapshotV1, 'snapshotVersion'> & {
    snapshotVersion: typeof BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION;
    mcp: BridgeMcpCapabilitySnapshot;
  }
>;

export type BridgeCapabilitySnapshot =
  BridgeCapabilitySnapshotV1 | BridgeCapabilitySnapshotV2;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(code);
  }
}

function boundedString(value: unknown, code: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(code);
  }
  return value;
}

function identifier(value: unknown, code: string): string {
  const result = boundedString(value, code, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(result)) {
    throw new Error(code);
  }
  return result;
}

function capability(value: unknown, code: string): CapabilityState {
  if (!CAPABILITY_STATES.includes(value as CapabilityState)) {
    throw new Error(code);
  }
  return value as CapabilityState;
}

export function parseBridgeCapabilitySnapshot(
  value: unknown,
): BridgeCapabilitySnapshot {
  if (!record(value)) throw new Error('BRIDGE_CAPABILITY_INVALID');
  exactFields(
    value,
    [
      'snapshotVersion',
      'capturedAt',
      'runtime',
      'workspaces',
      'skills',
      ...(Object.hasOwn(value, 'productWorkTurn') ? ['productWorkTurn'] : []),
      ...(Object.hasOwn(value, 'mcp') ? ['mcp'] : []),
    ],
    'BRIDGE_CAPABILITY_FIELDS_INVALID',
  );
  if (
    value.snapshotVersion !== BRIDGE_CAPABILITY_SNAPSHOT_VERSION &&
    value.snapshotVersion !== BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION
  ) {
    throw new Error('BRIDGE_CAPABILITY_VERSION_UNSUPPORTED');
  }
  const isV2 = value.snapshotVersion === BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION;
  if (isV2 !== Object.hasOwn(value, 'mcp')) {
    throw new Error('BRIDGE_CAPABILITY_FIELDS_INVALID');
  }
  const capturedAt = boundedString(
    value.capturedAt,
    'BRIDGE_CAPABILITY_CAPTURED_AT_INVALID',
  );
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error('BRIDGE_CAPABILITY_CAPTURED_AT_INVALID');
  }
  if (!record(value.runtime)) {
    throw new Error('BRIDGE_CAPABILITY_RUNTIME_INVALID');
  }
  exactFields(
    value.runtime,
    ['nodeVersion', 'codexAppServer', 'zedCli'],
    'BRIDGE_CAPABILITY_RUNTIME_FIELDS_INVALID',
  );
  boundedString(
    value.runtime.nodeVersion,
    'BRIDGE_CAPABILITY_NODE_VERSION_INVALID',
    80,
  );
  capability(
    value.runtime.codexAppServer,
    'BRIDGE_CAPABILITY_CODEX_STATE_INVALID',
  );
  capability(value.runtime.zedCli, 'BRIDGE_CAPABILITY_ZED_STATE_INVALID');

  if (
    !Array.isArray(value.workspaces) ||
    value.workspaces.length < 1 ||
    value.workspaces.length > 20
  ) {
    throw new Error('BRIDGE_CAPABILITY_WORKSPACES_INVALID');
  }
  const workspaceIds = new Set<string>();
  for (const workspace of value.workspaces) {
    if (!record(workspace)) {
      throw new Error('BRIDGE_CAPABILITY_WORKSPACE_INVALID');
    }
    exactFields(
      workspace,
      ['workspaceId', 'gitBaseline'],
      'BRIDGE_CAPABILITY_WORKSPACE_FIELDS_INVALID',
    );
    const workspaceId = identifier(
      workspace.workspaceId,
      'BRIDGE_CAPABILITY_WORKSPACE_ID_INVALID',
    );
    if (workspaceIds.has(workspaceId)) {
      throw new Error('BRIDGE_CAPABILITY_WORKSPACE_DUPLICATE');
    }
    workspaceIds.add(workspaceId);
    if (
      !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(
        boundedString(
          workspace.gitBaseline,
          'BRIDGE_CAPABILITY_GIT_BASELINE_INVALID',
          64,
        ),
      )
    ) {
      throw new Error('BRIDGE_CAPABILITY_GIT_BASELINE_INVALID');
    }
  }

  if (!Array.isArray(value.skills) || value.skills.length > 50) {
    throw new Error('BRIDGE_CAPABILITY_SKILLS_INVALID');
  }
  const releaseIds = new Set<string>();
  for (const skill of value.skills) {
    if (!record(skill)) throw new Error('BRIDGE_CAPABILITY_SKILL_INVALID');
    exactFields(
      skill,
      ['releaseId', 'contentHash'],
      'BRIDGE_CAPABILITY_SKILL_FIELDS_INVALID',
    );
    const releaseId = identifier(
      skill.releaseId,
      'BRIDGE_CAPABILITY_SKILL_RELEASE_ID_INVALID',
    );
    if (releaseIds.has(releaseId)) {
      throw new Error('BRIDGE_CAPABILITY_SKILL_DUPLICATE');
    }
    releaseIds.add(releaseId);
    if (
      !/^sha256:[a-f\d]{64}$/i.test(
        boundedString(
          skill.contentHash,
          'BRIDGE_CAPABILITY_SKILL_HASH_INVALID',
          80,
        ),
      )
    ) {
      throw new Error('BRIDGE_CAPABILITY_SKILL_HASH_INVALID');
    }
  }
  if (value.productWorkTurn !== undefined) {
    if (!record(value.productWorkTurn)) {
      throw new Error('BRIDGE_CAPABILITY_PRODUCT_WORK_TURN_INVALID');
    }
    exactFields(
      value.productWorkTurn,
      ['state', 'protocolVersion'],
      'BRIDGE_CAPABILITY_PRODUCT_WORK_TURN_FIELDS_INVALID',
    );
    capability(
      value.productWorkTurn.state,
      'BRIDGE_CAPABILITY_PRODUCT_WORK_TURN_STATE_INVALID',
    );
    if (
      value.productWorkTurn.protocolVersion !==
      PRODUCT_WORK_TURN_PROTOCOL_VERSION
    ) {
      throw new Error(
        'BRIDGE_CAPABILITY_PRODUCT_WORK_TURN_VERSION_UNSUPPORTED',
      );
    }
  }
  if (isV2) {
    if (!record(value.mcp)) throw new Error('BRIDGE_CAPABILITY_MCP_INVALID');
    exactFields(
      value.mcp,
      ['state', 'configFingerprint', 'servers'],
      'BRIDGE_CAPABILITY_MCP_FIELDS_INVALID',
    );
    capability(value.mcp.state, 'BRIDGE_CAPABILITY_MCP_STATE_INVALID');
    if (
      !/^sha256:[a-f\d]{64}$/i.test(
        boundedString(
          value.mcp.configFingerprint,
          'BRIDGE_CAPABILITY_MCP_FINGERPRINT_INVALID',
          80,
        ),
      )
    ) {
      throw new Error('BRIDGE_CAPABILITY_MCP_FINGERPRINT_INVALID');
    }
    if (!Array.isArray(value.mcp.servers) || value.mcp.servers.length > 20) {
      throw new Error('BRIDGE_CAPABILITY_MCP_SERVERS_INVALID');
    }
    const serverNames = new Set<string>();
    for (const server of value.mcp.servers) {
      if (!record(server))
        throw new Error('BRIDGE_CAPABILITY_MCP_SERVER_INVALID');
      exactFields(
        server,
        ['name', 'runtimeStatus', 'authStatus', 'tools'],
        'BRIDGE_CAPABILITY_MCP_SERVER_FIELDS_INVALID',
      );
      const serverName = boundedString(
        server.name,
        'BRIDGE_CAPABILITY_MCP_SERVER_NAME_INVALID',
        160,
      );
      if (serverNames.has(serverName)) {
        throw new Error('BRIDGE_CAPABILITY_MCP_SERVER_DUPLICATE');
      }
      serverNames.add(serverName);
      if (
        !['CONNECTED', 'UNAVAILABLE', 'UNVERIFIED'].includes(
          String(server.runtimeStatus),
        )
      ) {
        throw new Error('BRIDGE_CAPABILITY_MCP_RUNTIME_STATUS_INVALID');
      }
      if (
        !['UNKNOWN', 'UNSUPPORTED', 'READY', 'REQUIRED'].includes(
          String(server.authStatus),
        )
      ) {
        throw new Error('BRIDGE_CAPABILITY_MCP_AUTH_STATUS_INVALID');
      }
      if (!Array.isArray(server.tools) || server.tools.length > 50) {
        throw new Error('BRIDGE_CAPABILITY_MCP_TOOLS_INVALID');
      }
      const toolNames = new Set<string>();
      for (const tool of server.tools) {
        if (!record(tool))
          throw new Error('BRIDGE_CAPABILITY_MCP_TOOL_INVALID');
        exactFields(
          tool,
          ['name', 'inputSchemaHash', 'readOnlyHint'],
          'BRIDGE_CAPABILITY_MCP_TOOL_FIELDS_INVALID',
        );
        const toolName = boundedString(
          tool.name,
          'BRIDGE_CAPABILITY_MCP_TOOL_NAME_INVALID',
          160,
        );
        if (toolNames.has(toolName)) {
          throw new Error('BRIDGE_CAPABILITY_MCP_TOOL_DUPLICATE');
        }
        toolNames.add(toolName);
        if (
          !/^sha256:[a-f\d]{64}$/i.test(
            boundedString(
              tool.inputSchemaHash,
              'BRIDGE_CAPABILITY_MCP_SCHEMA_HASH_INVALID',
              80,
            ),
          )
        ) {
          throw new Error('BRIDGE_CAPABILITY_MCP_SCHEMA_HASH_INVALID');
        }
        if (
          tool.readOnlyHint !== null &&
          typeof tool.readOnlyHint !== 'boolean'
        ) {
          throw new Error('BRIDGE_CAPABILITY_MCP_READ_ONLY_HINT_INVALID');
        }
      }
    }
  }
  return value as unknown as BridgeCapabilitySnapshot;
}
