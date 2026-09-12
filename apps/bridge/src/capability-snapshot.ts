import {
  BRIDGE_CAPABILITY_SNAPSHOT_VERSION,
  BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION,
  type BridgeCapabilitySnapshot,
  type BridgeMcpCapabilitySnapshot,
} from '../../../packages/protocol/src/index.ts';

import type { WorkspaceInspectorPort } from './ports.ts';

export interface BridgeCapabilityRegistry {
  listVerifiedWorkspaces(): readonly Readonly<{
    workspaceId: string;
    path: string;
  }>[];
  listEnabledSkills(): Promise<
    readonly Readonly<{ releaseId: string; contentHash: string }>[]
  >;
}

export async function createBridgeCapabilitySnapshot(input: {
  registry: BridgeCapabilityRegistry;
  workspaceInspector: WorkspaceInspectorPort;
  capturedAt: string;
  nodeVersion: string;
  codexAppServer: BridgeCapabilitySnapshot['runtime']['codexAppServer'];
  zedCli: BridgeCapabilitySnapshot['runtime']['zedCli'];
  productWorkTurn?: BridgeCapabilitySnapshot['productWorkTurn'];
  mcp?: BridgeMcpCapabilitySnapshot;
}): Promise<BridgeCapabilitySnapshot> {
  const workspaces = await Promise.all(
    input.registry.listVerifiedWorkspaces().map(async (workspace) => ({
      workspaceId: workspace.workspaceId,
      gitBaseline: await input.workspaceInspector.currentGitBaseline(
        workspace.path,
      ),
    })),
  );
  const base = {
    capturedAt: input.capturedAt,
    runtime: {
      nodeVersion: input.nodeVersion,
      codexAppServer: input.codexAppServer,
      zedCli: input.zedCli,
    },
    workspaces,
    skills: await input.registry.listEnabledSkills(),
    ...(input.productWorkTurn
      ? { productWorkTurn: input.productWorkTurn }
      : {}),
  };
  return input.mcp
    ? {
        ...base,
        snapshotVersion: BRIDGE_CAPABILITY_SNAPSHOT_V2_VERSION,
        mcp: input.mcp,
      }
    : {
        ...base,
        snapshotVersion: BRIDGE_CAPABILITY_SNAPSHOT_VERSION,
      };
}
