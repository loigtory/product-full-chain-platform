import type {
  ActorRole,
  BridgeCapabilityState,
  BridgeCapabilitySummaryDto,
  BridgeRegistrationDto,
  MutationEvidence,
} from '@pfc/contracts';

import type { LifecycleKysely } from './database.ts';
import { appendMutationEvidence, claimMutation } from './mutation-evidence.ts';

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableTimestamp(value: Date | string | null): string | null {
  return value === null ? null : timestamp(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capabilityState(value: unknown): value is BridgeCapabilityState {
  return ['AVAILABLE', 'UNAVAILABLE', 'UNVERIFIED'].includes(String(value));
}

function capabilitySummary(input: {
  capabilities: unknown;
  capturedAt: Date | string;
  expiresAt: Date | string;
}): BridgeCapabilitySummaryDto | null {
  if (!record(input.capabilities) || !record(input.capabilities.runtime)) {
    return null;
  }
  const { runtime, workspaces, skills, mcp } = input.capabilities;
  if (
    !capabilityState(runtime.codexAppServer) ||
    !capabilityState(runtime.zedCli) ||
    !Array.isArray(workspaces) ||
    !Array.isArray(skills)
  ) {
    return null;
  }
  return {
    capturedAt: timestamp(input.capturedAt),
    expiresAt: timestamp(input.expiresAt),
    codexAppServer: runtime.codexAppServer,
    zedCli: runtime.zedCli,
    workspaceCount: workspaces.length,
    skillCount: skills.length,
    mcp: record(mcp) && capabilityState(mcp.state) ? mcp.state : 'UNVERIFIED',
    mcpReadToolCount:
      record(mcp) && Array.isArray(mcp.servers)
        ? mcp.servers.reduce(
            (count, server) =>
              count +
              (record(server) && Array.isArray(server.tools)
                ? server.tools.length
                : 0),
            0,
          )
        : 0,
    mcpConfigFingerprint:
      record(mcp) &&
      typeof mcp.configFingerprint === 'string' &&
      /^sha256:[a-f0-9]{64}$/i.test(mcp.configFingerprint)
        ? mcp.configFingerprint.toLowerCase()
        : null,
  };
}

export class PostgresBridgePairingRepository {
  private readonly db;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  async findMembership(input: { teamId: string; accountId: string }): Promise<{
    role: ActorRole;
    status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  } | null> {
    return (
      (await this.db
        .selectFrom('team_memberships')
        .select(['role', 'status'])
        .where('team_id', '=', input.teamId)
        .where('account_id', '=', input.accountId)
        .executeTakeFirst()) ?? null
    );
  }

  async listBridgesForTeam(
    teamId: string,
  ): Promise<readonly BridgeRegistrationDto[]> {
    const bridges = await this.db
      .selectFrom('bridge_registrations')
      .selectAll()
      .where('team_id', '=', teamId)
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute();

    return Promise.all(
      bridges.map(async (bridge): Promise<BridgeRegistrationDto> => {
        const [workspaceRows, latestCapability] = await Promise.all([
          this.db
            .selectFrom('bridge_workspace_bindings')
            .innerJoin(
              'workspaces',
              'workspaces.id',
              'bridge_workspace_bindings.workspace_id',
            )
            .select([
              'bridge_workspace_bindings.workspace_id',
              'bridge_workspace_bindings.verification_status',
              'bridge_workspace_bindings.current_git_baseline',
              'bridge_workspace_bindings.verified_at',
              'workspaces.name',
              'workspaces.repository_label',
            ])
            .where('bridge_workspace_bindings.bridge_id', '=', bridge.id)
            .orderBy('workspaces.name')
            .execute(),
          this.db
            .selectFrom('bridge_capability_snapshots')
            .select(['capabilities', 'captured_at', 'expires_at'])
            .where('bridge_id', '=', bridge.id)
            .orderBy('captured_at', 'desc')
            .executeTakeFirst(),
        ]);
        return {
          id: bridge.id,
          teamId: bridge.team_id,
          protocolVersion: bridge.protocol_version,
          bridgeVersion: bridge.bridge_version,
          nodeVersion: bridge.node_version,
          codexVersion: bridge.codex_version,
          zedVersion: bridge.zed_version,
          status: bridge.status,
          lastHeartbeatAt: nullableTimestamp(bridge.last_heartbeat_at),
          revokedAt: nullableTimestamp(bridge.revoked_at),
          workspaces: workspaceRows.map((workspace) => ({
            workspaceId: workspace.workspace_id,
            name: workspace.name,
            repositoryLabel: workspace.repository_label,
            verificationStatus: workspace.verification_status,
            gitBaseline: workspace.current_git_baseline,
            verifiedAt: nullableTimestamp(workspace.verified_at),
          })),
          capability: latestCapability
            ? capabilitySummary({
                capabilities: latestCapability.capabilities,
                capturedAt: latestCapability.captured_at,
                expiresAt: latestCapability.expires_at,
              })
            : null,
        };
      }),
    );
  }

  async createPairing(input: {
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
  }> {
    return this.db.transaction().execute(async (transaction) => {
      const mutation = await claimMutation(transaction, input.mutation);
      if (mutation.status !== 'NEW') {
        const existing = mutation.resultReference
          ? await transaction
              .selectFrom('bridge_pairings')
              .select(['id', 'expires_at'])
              .where('id', '=', mutation.resultReference)
              .executeTakeFirst()
          : null;
        return {
          status: mutation.status,
          pairingId: existing?.id ?? null,
          expiresAt: existing ? timestamp(existing.expires_at) : null,
        };
      }
      const pairing = await transaction
        .insertInto('bridge_pairings')
        .values({
          id: input.id,
          team_id: input.teamId,
          code_digest: input.pairingCodeDigest,
          expires_at: input.expiresAt,
          consumed_at: null,
          created_by: input.createdBy,
          created_at: input.createdAt,
        })
        .returning(['id', 'expires_at'])
        .executeTakeFirstOrThrow();
      await appendMutationEvidence(transaction, input.mutation);
      return {
        status: 'CREATED',
        pairingId: pairing.id,
        expiresAt: timestamp(pairing.expires_at),
      };
    });
  }

  async exchangePairing(input: {
    pairingCodeDigest: string;
    bridgeId: string;
    credentialDigest: string;
    protocolVersion: 'pfc-bridge/1';
    bridgeVersion: string;
    nodeVersion: string;
    codexVersion: string | null;
    zedVersion: string | null;
    workspaces: readonly {
      workspaceId: string;
      repositoryFingerprint: string;
      allowedRelativePath: string;
    }[];
    exchangedAt: string;
  }): Promise<
    | { status: 'EXCHANGED'; bridgeId: string; teamId: string }
    | { status: 'INVALID' }
  > {
    return this.db.transaction().execute(async (transaction) => {
      const pairing = await transaction
        .selectFrom('bridge_pairings')
        .select(['id', 'team_id'])
        .where('code_digest', '=', input.pairingCodeDigest)
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', new Date(input.exchangedAt))
        .forUpdate()
        .executeTakeFirst();
      if (!pairing) return { status: 'INVALID' };

      for (const binding of input.workspaces) {
        const workspace = await transaction
          .selectFrom('workspaces')
          .innerJoin(
            'requirement_workspaces',
            'requirement_workspaces.workspace_id',
            'workspaces.id',
          )
          .select('workspaces.id')
          .where('workspaces.id', '=', binding.workspaceId)
          .where('workspaces.team_id', '=', pairing.team_id)
          .where('workspaces.status', '=', 'ACTIVE')
          .where('workspaces.verification_status', 'in', [
            'UNVERIFIED',
            'VERIFIED',
          ])
          .where(
            'workspaces.repository_fingerprint',
            '=',
            binding.repositoryFingerprint,
          )
          .where('requirement_workspaces.team_id', '=', pairing.team_id)
          .where(
            'requirement_workspaces.allowed_relative_path',
            '=',
            binding.allowedRelativePath,
          )
          .executeTakeFirst();
        if (!workspace) return { status: 'INVALID' };
      }

      await transaction
        .updateTable('workspaces')
        .set((expression) => ({
          verification_status: 'VERIFIED',
          row_version: expression('row_version', '+', 1),
          updated_at: input.exchangedAt,
        }))
        .where(
          'id',
          'in',
          input.workspaces.map((workspace) => workspace.workspaceId),
        )
        .where('team_id', '=', pairing.team_id)
        .where('status', '=', 'ACTIVE')
        .where('verification_status', '=', 'UNVERIFIED')
        .execute();

      await transaction
        .updateTable('bridge_pairings')
        .set({ consumed_at: input.exchangedAt })
        .where('id', '=', pairing.id)
        .where('consumed_at', 'is', null)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('bridge_registrations')
        .values({
          id: input.bridgeId,
          team_id: pairing.team_id,
          credential_digest: input.credentialDigest,
          protocol_version: input.protocolVersion,
          bridge_version: input.bridgeVersion,
          node_version: input.nodeVersion,
          codex_version: input.codexVersion,
          zed_version: input.zedVersion,
          status: 'ONLINE',
          last_heartbeat_at: input.exchangedAt,
          revoked_at: null,
          created_at: input.exchangedAt,
          updated_at: input.exchangedAt,
        })
        .execute();
      await transaction
        .insertInto('bridge_workspace_bindings')
        .values(
          input.workspaces.map((binding) => ({
            bridge_id: input.bridgeId,
            workspace_id: binding.workspaceId,
            repository_fingerprint: binding.repositoryFingerprint,
            allowed_relative_path: binding.allowedRelativePath,
            verification_status: 'VERIFIED' as const,
            current_git_baseline: null,
            verified_at: input.exchangedAt,
            created_at: input.exchangedAt,
          })),
        )
        .execute();
      await transaction
        .insertInto('outbox_events')
        .values({
          id: `${input.bridgeId}-outbox`,
          event_type: 'bridge.paired',
          aggregate_type: 'bridge',
          aggregate_id: input.bridgeId,
          aggregate_version: 0,
          payload_summary: { teamId: pairing.team_id },
          status: 'PENDING',
          occurred_at: input.exchangedAt,
          published_at: null,
        })
        .execute();
      await transaction
        .insertInto('audit_events')
        .values({
          id: `${input.bridgeId}-audit`,
          actor_id: `bridge-pairing:${pairing.id}`,
          action: 'bridge.paired',
          target_type: 'bridge',
          target_id: input.bridgeId,
          decision: 'ALLOW',
          reason: null,
          scope_summary: {
            teamId: pairing.team_id,
            workspaceCount: input.workspaces.length,
          },
          request_id: pairing.id,
          occurred_at: input.exchangedAt,
        })
        .execute();
      return {
        status: 'EXCHANGED',
        bridgeId: input.bridgeId,
        teamId: pairing.team_id,
      };
    });
  }
}
