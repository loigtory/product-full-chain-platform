import type {
  ActorRole,
  BridgeRegistrationDto,
  MutationEvidence,
} from '@pfc/contracts';

export type BridgeWorkspaceExchange = Readonly<{
  workspaceId: string;
  repositoryFingerprint: string;
  allowedRelativePath: string;
}>;

export interface BridgePairingRepositoryPort {
  findMembership(input: { teamId: string; accountId: string }): Promise<{
    role: ActorRole;
    status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  } | null>;
  listBridgesForTeam(teamId: string): Promise<readonly BridgeRegistrationDto[]>;
  createPairing(input: {
    id: string;
    teamId: string;
    pairingCodeDigest: string;
    expiresAt: string;
    createdBy: string;
    createdAt: string;
    mutation: MutationEvidence;
  }): Promise<{
    status: 'CREATED' | 'REPLAYED' | 'CONFLICT';
    pairingId: string | null;
    expiresAt: string | null;
  }>;
  exchangePairing(input: {
    pairingCodeDigest: string;
    bridgeId: string;
    credentialDigest: string;
    protocolVersion: 'pfc-bridge/1';
    bridgeVersion: string;
    nodeVersion: string;
    codexVersion: string | null;
    zedVersion: string | null;
    workspaces: readonly BridgeWorkspaceExchange[];
    exchangedAt: string;
  }): Promise<
    | { status: 'EXCHANGED'; bridgeId: string; teamId: string }
    | { status: 'INVALID' }
  >;
}
