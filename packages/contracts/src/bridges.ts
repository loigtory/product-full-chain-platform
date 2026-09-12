export const BRIDGE_STATUSES = [
  'OFFLINE',
  'ONLINE',
  'DEGRADED',
  'REVOKED',
] as const;

export const BRIDGE_CAPABILITY_STATES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'UNVERIFIED',
] as const;

export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];
export type BridgeCapabilityState = (typeof BRIDGE_CAPABILITY_STATES)[number];

export type BridgeWorkspaceDto = Readonly<{
  workspaceId: string;
  name: string;
  repositoryLabel: string;
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'FAILED';
  gitBaseline: string | null;
  verifiedAt: string | null;
}>;

export type BridgeCapabilitySummaryDto = Readonly<{
  capturedAt: string;
  expiresAt: string;
  codexAppServer: BridgeCapabilityState;
  zedCli: BridgeCapabilityState;
  workspaceCount: number;
  skillCount: number;
  mcp: BridgeCapabilityState;
  mcpReadToolCount: number;
  mcpConfigFingerprint: string | null;
}>;

export type BridgeRegistrationDto = Readonly<{
  id: string;
  teamId: string;
  protocolVersion: string;
  bridgeVersion: string;
  nodeVersion: string;
  codexVersion: string | null;
  zedVersion: string | null;
  status: BridgeStatus;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  workspaces: readonly BridgeWorkspaceDto[];
  capability: BridgeCapabilitySummaryDto | null;
}>;

export type BridgeListResponse = Readonly<{
  items: readonly BridgeRegistrationDto[];
}>;

export type CreateBridgePairingResponse = Readonly<{
  replayed: boolean;
  pairingId: string;
  pairingCode: string | null;
  expiresAt: string;
}>;
