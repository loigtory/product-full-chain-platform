import { createHash } from 'node:crypto';

import type {
  ActionProposalDto,
  ContextBindingDto,
  ProductWorkSessionDto,
  ProductWorkSessionEventDto,
  ProductWorkTurnDto,
  ProductWorkWorkspaceEvidenceDto,
} from '@pfc/contracts';
import { assertSafeEventSummary, transitionProductWorkTurn } from '@pfc/domain';
import {
  PRODUCT_WORK_TURN_COMMAND_VERSION,
  PRODUCT_WORK_TURN_CONTEXT_VERSION,
  PRODUCT_WORK_TURN_PROTOCOL_VERSION,
  parseBridgeCapabilitySnapshot,
  type BridgeCapabilitySnapshot,
  type ProductWorkTurnCommand,
  type ProductWorkTurnContext,
  type ProductWorkTurnEvent,
} from '@pfc/protocol';
import type { Selectable } from 'kysely';

import type {
  ProductWorkSessionTable,
  ProductWorkTurnTable,
} from './aiux-database.ts';
import type { LifecycleKysely } from './database.ts';

type ProductWorkTurnCommandInput = Readonly<{
  id: string;
  turnId: string;
  commandType:
    | 'START_PRODUCT_WORK_TURN'
    | 'INTERRUPT_PRODUCT_WORK_TURN'
    | 'VERIFY_PRODUCT_WORK_TURN';
  payloadSummary: Readonly<Record<string, unknown>>;
  requiredCapability: string;
  idempotencyKey: string;
  createdAt: string;
}>;

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function stringArray(value: unknown): readonly string[] {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseCapability(value: unknown): BridgeCapabilitySnapshot | null {
  try {
    return parseBridgeCapabilitySnapshot(
      typeof value === 'string' ? (JSON.parse(value) as unknown) : value,
    );
  } catch {
    return null;
  }
}

function codexHarness(version: string | null): string | null {
  const match = version ? /^(\d+\.\d+)/.exec(version) : null;
  return match ? `codex-app-server/${match[1]}` : null;
}

function missingWorkspaceEvidence(
  bridgeId: string | null,
): ProductWorkWorkspaceEvidenceDto {
  return {
    schemaVersion: 'product-workspace-evidence/1',
    evidenceStatus: 'MISSING',
    bridgeId,
    bridgeStatus: null,
    workspaceId: null,
    verificationStatus: null,
    repositoryFingerprint: null,
    bindingGitBaseline: null,
    capabilityGitBaseline: null,
    capabilityCapturedAt: null,
    capabilityExpiresAt: null,
    capabilityFreshness: 'MISSING',
    codexAppServer: 'UNVERIFIED',
    zedCli: 'UNVERIFIED',
    productWorkTurn: 'UNVERIFIED',
    mcp: {
      state: 'UNVERIFIED',
      status: 'UNVERIFIED',
      configFingerprint: null,
      registeredReadCapabilityCount: 0,
    },
  };
}

function sessionDto(
  row: Selectable<ProductWorkSessionTable>,
): ProductWorkSessionDto {
  return {
    schemaVersion: 'product-work-session/1',
    id: row.id,
    teamId: row.team_id,
    requirementId: row.requirement_id,
    openedRequirementVersion: row.opened_requirement_version,
    currentRequirementVersion: row.current_requirement_version,
    openedBaselineId: row.opened_baseline_id,
    openedStage: row.opened_stage,
    status: row.status,
    controlSurface: row.control_surface,
    activeTurnId: row.active_turn_id,
    lastSequence: row.last_sequence,
    ownerId: row.owner_id,
    title: row.title,
    blockReason: row.block_reason,
    rowVersion: row.row_version,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    archivedAt: row.archived_at ? timestamp(row.archived_at) : null,
  };
}

function turnDto(row: Selectable<ProductWorkTurnTable>): ProductWorkTurnDto {
  return {
    schemaVersion: 'product-work-turn/1',
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    intentKind: row.intent_kind,
    inputText: row.input_text,
    visibleResponse: row.visible_response,
    status: row.status,
    skillReleaseId: row.skill_release_id,
    bridgeId: row.bridge_id,
    externalIds: {
      threadId: row.external_thread_id,
      turnId: row.external_turn_id,
    },
    usageSummary: row.usage_summary as ProductWorkTurnDto['usageSummary'],
    failureReason: row.failure_reason,
    recoveryAction: row.recovery_action,
    contentRetentionUntil: row.content_retention_until
      ? timestamp(row.content_retention_until)
      : null,
    redactedAt: row.redacted_at ? timestamp(row.redacted_at) : null,
    rowVersion: row.row_version,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    terminalAt: row.terminal_at ? timestamp(row.terminal_at) : null,
  };
}

function eventValues(event: ProductWorkSessionEventDto) {
  assertSafeEventSummary(event.safeSummary);
  return {
    id: event.eventId,
    session_id: event.sessionId,
    sequence: event.sequence,
    event_type: event.type,
    aggregate_type: event.aggregateRef.type,
    aggregate_id: event.aggregateRef.id,
    safe_summary: event.safeSummary,
    source_event_id: null,
    occurred_at: event.occurredAt,
    received_at: event.receivedAt,
  } as const;
}

export class PostgresWorkSessionRepository {
  private readonly db: ReturnType<LifecycleKysely['withSchema']>;

  constructor(database: LifecycleKysely, schemaName = 'pfc') {
    this.db = database.withSchema(schemaName);
  }

  private async listMcpRegistrationsIfAvailable() {
    try {
      return await this.db
        .selectFrom('mcp_capability_registrations')
        .select([
          'server_name',
          'tool_name',
          'input_schema_hash',
          'config_fingerprint',
          'allowed_team_ids',
          'allowed_requirement_ids',
        ])
        .where('status', '=', 'ACTIVE')
        .execute();
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '42P01'
      ) {
        return [];
      }
      throw error;
    }
  }

  async resolveSessionAnchor(input: {
    actorId: string;
    requirementId: string;
    teamId?: string;
  }) {
    const requirement = await this.db
      .selectFrom('requirements')
      .select([
        'id',
        'name',
        'row_version',
        'current_baseline_id',
        'current_stage',
        'business_owner_id',
        'draft_sensitivity',
      ])
      .where('id', '=', input.requirementId)
      .executeTakeFirst();
    if (!requirement) return null;
    let assignmentQuery = this.db
      .selectFrom('requirement_assignments')
      .innerJoin('team_memberships', (join) =>
        join
          .onRef(
            'team_memberships.team_id',
            '=',
            'requirement_assignments.team_id',
          )
          .onRef(
            'team_memberships.account_id',
            '=',
            'requirement_assignments.account_id',
          ),
      )
      .select('requirement_assignments.team_id')
      .where('requirement_assignments.requirement_id', '=', input.requirementId)
      .where('requirement_assignments.account_id', '=', input.actorId)
      .where('requirement_assignments.status', '=', 'ACTIVE')
      .where('team_memberships.status', '=', 'ACTIVE');
    if (input.teamId) {
      assignmentQuery = assignmentQuery.where(
        'requirement_assignments.team_id',
        '=',
        input.teamId,
      );
    }
    const assignments = await assignmentQuery.limit(2).execute();
    if (assignments.length !== 1) return null;
    const baseline = requirement.current_baseline_id
      ? await this.db
          .selectFrom('material_baselines')
          .select('sensitivity')
          .where('id', '=', requirement.current_baseline_id)
          .executeTakeFirst()
      : null;
    return {
      teamId: assignments[0].team_id,
      requirementId: requirement.id,
      requirementName: requirement.name,
      requirementVersion: requirement.row_version,
      baselineId: requirement.current_baseline_id,
      stage: requirement.current_stage,
      businessOwnerId: requirement.business_owner_id,
      sensitivity:
        baseline?.sensitivity ?? requirement.draft_sensitivity ?? 'INTERNAL',
    } as const;
  }

  async resolveContextCandidates(input: {
    requirementId: string;
    baselineId: string | null;
    targetIds: readonly string[];
  }) {
    if (!input.baselineId || input.targetIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('material_refs')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'material_refs.baseline_id',
      )
      .select([
        'material_refs.id',
        'material_refs.version',
        'material_refs.content_hash',
        'material_refs.sensitivity',
      ])
      .where('material_baselines.requirement_id', '=', input.requirementId)
      .where('material_baselines.id', '=', input.baselineId)
      .where('material_refs.id', 'in', [...input.targetIds])
      .where('material_refs.validity', '=', 'VALID')
      .execute();
    return rows
      .filter((row) => row.content_hash !== null)
      .map((row) => ({
        contextType: 'MATERIAL_REF' as const,
        targetId: row.id,
        targetVersion:
          row.version && /^\d+$/.test(row.version) ? Number(row.version) : null,
        contentHash: row.content_hash!,
        sensitivity: row.sensitivity,
      }));
  }

  async listReadinessContextCandidates(input: {
    requirementId: string;
    baselineId: string | null;
    limit: number;
  }) {
    if (!input.baselineId) return [];
    const rows = await this.db
      .selectFrom('material_refs')
      .innerJoin(
        'material_baselines',
        'material_baselines.id',
        'material_refs.baseline_id',
      )
      .select([
        'material_refs.id',
        'material_refs.reference_type',
        'material_refs.version',
        'material_refs.content_hash',
        'material_refs.sensitivity',
      ])
      .where('material_baselines.requirement_id', '=', input.requirementId)
      .where('material_baselines.id', '=', input.baselineId)
      .where('material_refs.validity', '=', 'VALID')
      .where('material_refs.content_hash', 'is not', null)
      .orderBy('material_refs.reference_type')
      .orderBy('material_refs.id')
      .limit(input.limit)
      .execute();
    return rows.map((row) => ({
      materialRefId: row.id,
      referenceType: row.reference_type,
      version: row.version,
      sensitivity: row.sensitivity,
    }));
  }

  private async productWorkCapabilityFacts(input: {
    teamId: string;
    at: string;
  }) {
    const [bridges, snapshots, skills] = await Promise.all([
      this.db
        .selectFrom('bridge_registrations')
        .select(['id', 'codex_version'])
        .where('team_id', '=', input.teamId)
        .where('status', '=', 'ONLINE')
        .execute(),
      this.db
        .selectFrom('bridge_capability_snapshots')
        .innerJoin(
          'bridge_registrations',
          'bridge_registrations.id',
          'bridge_capability_snapshots.bridge_id',
        )
        .select([
          'bridge_capability_snapshots.bridge_id',
          'bridge_capability_snapshots.capabilities',
          'bridge_capability_snapshots.captured_at',
          'bridge_capability_snapshots.expires_at',
          'bridge_registrations.codex_version',
        ])
        .where('bridge_registrations.team_id', '=', input.teamId)
        .where('bridge_registrations.status', '=', 'ONLINE')
        .where(
          'bridge_capability_snapshots.captured_at',
          '<=',
          new Date(input.at),
        )
        .orderBy('bridge_capability_snapshots.captured_at', 'desc')
        .execute(),
      this.db
        .selectFrom('skill_releases')
        .select([
          'id',
          'display_name',
          'version',
          'content_hash',
          'compatible_harnesses',
          'required_capabilities',
          'enabled_scopes',
          'risk_level',
          'context_cost',
        ])
        .where('status', '=', 'ACTIVE')
        .where('evaluation_status', '=', 'PASSED')
        .orderBy('display_name')
        .orderBy('version')
        .orderBy('id')
        .limit(100)
        .execute(),
    ]);
    const latestSnapshots = new Map<
      string,
      Readonly<{
        bridgeId: string;
        codexVersion: string | null;
        expiresAt: string;
        snapshot: BridgeCapabilitySnapshot;
      }>
    >();
    const seenBridgeIds = new Set<string>();
    for (const row of snapshots) {
      if (seenBridgeIds.has(row.bridge_id)) continue;
      seenBridgeIds.add(row.bridge_id);
      const snapshot = parseCapability(row.capabilities);
      if (!snapshot) continue;
      latestSnapshots.set(row.bridge_id, {
        bridgeId: row.bridge_id,
        codexVersion: row.codex_version,
        expiresAt: timestamp(row.expires_at),
        snapshot,
      });
    }
    const availableSnapshots = [...latestSnapshots.values()].filter(
      ({ expiresAt, snapshot }) =>
        Date.parse(expiresAt) > Date.parse(input.at) &&
        snapshot.runtime.codexAppServer === 'AVAILABLE' &&
        snapshot.productWorkTurn?.state === 'AVAILABLE' &&
        snapshot.productWorkTurn.protocolVersion ===
          PRODUCT_WORK_TURN_PROTOCOL_VERSION,
    );
    const eligibleSkills = skills.filter(
      (skill) =>
        stringArray(skill.required_capabilities).includes(
          'PRODUCT_WORK_TURN',
        ) && stringArray(skill.enabled_scopes).includes('PRODUCT_WORK_TURN'),
    );
    return { availableSnapshots, bridges, eligibleSkills };
  }

  async resolveProductWorkReadinessCapability(input: {
    teamId: string;
    at: string;
  }) {
    const facts = await this.productWorkCapabilityFacts(input);
    const bridgeStatus =
      facts.bridges.length === 0
        ? ('UNAVAILABLE' as const)
        : facts.availableSnapshots.length === 0
          ? ('UNVERIFIED' as const)
          : ('AVAILABLE' as const);
    return {
      bridgeStatus,
      skills: facts.eligibleSkills.map((skill) => {
        const match = facts.availableSnapshots.find(
          ({ codexVersion, snapshot }) => {
            const harness = codexHarness(codexVersion);
            return (
              harness !== null &&
              stringArray(skill.compatible_harnesses).includes(harness) &&
              snapshot.skills.some(
                (item) =>
                  item.releaseId === skill.id &&
                  item.contentHash === skill.content_hash,
              )
            );
          },
        );
        return {
          releaseId: skill.id,
          displayName: skill.display_name,
          version: skill.version,
          riskLevel: skill.risk_level,
          contextCost: skill.context_cost,
          availability: match
            ? ('AVAILABLE' as const)
            : ('UNAVAILABLE' as const),
          disabledReason: match ? null : 'BRIDGE_SKILL_SNAPSHOT_MISMATCH',
        };
      }),
    };
  }

  async resolveProductWorkCapability(input: {
    teamId: string;
    skillReleaseId: string;
    at: string;
  }) {
    const facts = await this.productWorkCapabilityFacts(input);
    const skill = facts.eligibleSkills.find(
      (item) => item.id === input.skillReleaseId,
    );
    if (!skill) return null;
    const compatible = facts.availableSnapshots.find(
      ({ codexVersion, snapshot }) => {
        const harness = codexHarness(codexVersion);
        return (
          harness !== null &&
          stringArray(skill.compatible_harnesses).includes(harness) &&
          snapshot.skills.some(
            (item) =>
              item.releaseId === skill.id &&
              item.contentHash === skill.content_hash,
          )
        );
      },
    );
    return compatible
      ? { bridgeId: compatible.bridgeId, skillReleaseId: skill.id }
      : null;
  }

  async resolveWorkspaceEvidence(input: {
    teamId: string;
    requirementId: string;
    bridgeId: string | null;
    at: string;
  }): Promise<ProductWorkWorkspaceEvidenceDto> {
    if (!input.bridgeId) return missingWorkspaceEvidence(null);
    const bridge = await this.db
      .selectFrom('bridge_registrations')
      .select(['id', 'status'])
      .where('id', '=', input.bridgeId)
      .where('team_id', '=', input.teamId)
      .executeTakeFirst();
    if (!bridge) return missingWorkspaceEvidence(input.bridgeId);

    const [bindings, capabilityRow, mcpRegistrations] = await Promise.all([
      this.db
        .selectFrom('bridge_workspace_bindings')
        .select([
          'workspace_id',
          'repository_fingerprint',
          'verification_status',
          'current_git_baseline',
          'verified_at',
        ])
        .where('bridge_id', '=', input.bridgeId)
        .orderBy('verified_at', 'desc')
        .orderBy('workspace_id')
        .execute(),
      this.db
        .selectFrom('bridge_capability_snapshots')
        .select(['capabilities', 'captured_at', 'expires_at'])
        .where('bridge_id', '=', input.bridgeId)
        .where('captured_at', '<=', new Date(input.at))
        .orderBy('captured_at', 'desc')
        .executeTakeFirst(),
      this.listMcpRegistrationsIfAvailable(),
    ]);
    const snapshot = capabilityRow
      ? parseCapability(capabilityRow.capabilities)
      : null;
    const advertisedWorkspace = snapshot?.workspaces.find((workspace) =>
      bindings.some(
        (binding) => binding.workspace_id === workspace.workspaceId,
      ),
    );
    const binding = advertisedWorkspace
      ? bindings.find(
          (candidate) =>
            candidate.workspace_id === advertisedWorkspace.workspaceId,
        )
      : bindings[0];
    const capturedAt = capabilityRow
      ? timestamp(capabilityRow.captured_at)
      : null;
    const expiresAt = capabilityRow
      ? timestamp(capabilityRow.expires_at)
      : null;
    const capabilityFreshness =
      !snapshot || !expiresAt
        ? ('MISSING' as const)
        : Date.parse(expiresAt) <= Date.parse(input.at)
          ? ('EXPIRED' as const)
          : ('CURRENT' as const);
    const gitMatches = Boolean(
      binding?.current_git_baseline &&
      advertisedWorkspace?.gitBaseline &&
      binding.current_git_baseline === advertisedWorkspace.gitBaseline,
    );
    const evidenceStatus =
      capabilityFreshness === 'MISSING'
        ? ('MISSING' as const)
        : capabilityFreshness === 'EXPIRED'
          ? ('EXPIRED' as const)
          : binding?.verification_status === 'VERIFIED' && gitMatches
            ? ('VERIFIED' as const)
            : ('MISMATCHED' as const);
    const scopedRegistrations = mcpRegistrations.filter(
      (registration) =>
        stringArray(registration.allowed_team_ids).includes(input.teamId) &&
        stringArray(registration.allowed_requirement_ids).includes(
          input.requirementId,
        ),
    );
    const matchingMcpRegistrations =
      snapshot?.snapshotVersion === 'pfc-bridge-capabilities/2'
        ? scopedRegistrations.filter((registration) => {
            const server = snapshot.mcp.servers.find(
              (candidate) => candidate.name === registration.server_name,
            );
            const tool = server?.tools.find(
              (candidate) => candidate.name === registration.tool_name,
            );
            return Boolean(
              server?.runtimeStatus === 'CONNECTED' &&
              tool &&
              tool.readOnlyHint === true &&
              tool.inputSchemaHash.toLowerCase() ===
                registration.input_schema_hash.toLowerCase() &&
              snapshot.mcp.configFingerprint.toLowerCase() ===
                registration.config_fingerprint.toLowerCase(),
            );
          })
        : [];
    const mcpStatus =
      snapshot?.snapshotVersion !== 'pfc-bridge-capabilities/2' ||
      snapshot.mcp.state === 'UNVERIFIED' ||
      capabilityFreshness !== 'CURRENT'
        ? ('UNVERIFIED' as const)
        : snapshot.mcp.state === 'UNAVAILABLE' ||
            bridge.status !== 'ONLINE' ||
            scopedRegistrations.length === 0
          ? ('UNAVAILABLE' as const)
          : matchingMcpRegistrations.length > 0
            ? ('AVAILABLE' as const)
            : ('DRIFTED' as const);

    return {
      schemaVersion: 'product-workspace-evidence/1',
      evidenceStatus,
      bridgeId: bridge.id,
      bridgeStatus: bridge.status,
      workspaceId: binding?.workspace_id ?? null,
      verificationStatus: binding?.verification_status ?? null,
      repositoryFingerprint: binding?.repository_fingerprint ?? null,
      bindingGitBaseline: binding?.current_git_baseline ?? null,
      capabilityGitBaseline: advertisedWorkspace?.gitBaseline ?? null,
      capabilityCapturedAt: capturedAt,
      capabilityExpiresAt: expiresAt,
      capabilityFreshness,
      codexAppServer: snapshot?.runtime.codexAppServer ?? 'UNVERIFIED',
      zedCli: snapshot?.runtime.zedCli ?? 'UNVERIFIED',
      productWorkTurn: snapshot?.productWorkTurn?.state ?? 'UNVERIFIED',
      mcp: {
        state:
          snapshot?.snapshotVersion === 'pfc-bridge-capabilities/2'
            ? snapshot.mcp.state
            : 'UNVERIFIED',
        status: mcpStatus,
        configFingerprint:
          snapshot?.snapshotVersion === 'pfc-bridge-capabilities/2'
            ? snapshot.mcp.configFingerprint
            : null,
        registeredReadCapabilityCount: matchingMcpRegistrations.length,
      },
    };
  }

  async resolveTargetVersion(target: ActionProposalDto['target']) {
    if (target.aggregateType === 'REQUIREMENT') {
      const row = await this.db
        .selectFrom('requirements')
        .select('row_version')
        .where('id', '=', target.aggregateId)
        .executeTakeFirst();
      return row?.row_version ?? null;
    }
    if (target.aggregateType === 'QUESTION') {
      const row = await this.db
        .selectFrom('questions')
        .select('row_version')
        .where('id', '=', target.aggregateId)
        .executeTakeFirst();
      return row?.row_version ?? null;
    }
    if (target.aggregateType === 'ARTIFACT') {
      const row = await this.db
        .selectFrom('artifacts')
        .select('row_version')
        .where('id', '=', target.aggregateId)
        .executeTakeFirst();
      return row?.row_version ?? null;
    }
    const row = await this.db
      .selectFrom('agent_runs')
      .select('row_version')
      .where('id', '=', target.aggregateId)
      .executeTakeFirst();
    return row?.row_version ?? null;
  }

  async createSession(input: {
    session: ProductWorkSessionDto;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkSessionDto> {
    if (
      input.event.sessionId !== input.session.id ||
      input.event.sequence !== 1
    ) {
      throw new Error('WORK_SESSION_INITIAL_EVENT_INVALID');
    }
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('product_work_sessions')
        .values({
          id: input.session.id,
          team_id: input.session.teamId,
          requirement_id: input.session.requirementId,
          opened_requirement_version: input.session.openedRequirementVersion,
          current_requirement_version: input.session.currentRequirementVersion,
          opened_baseline_id: input.session.openedBaselineId,
          opened_stage: input.session.openedStage,
          status: input.session.status,
          control_surface: input.session.controlSurface,
          active_turn_id: input.session.activeTurnId,
          last_sequence: 1,
          owner_id: input.session.ownerId,
          title: input.session.title,
          block_reason: input.session.blockReason,
          row_version: input.session.rowVersion,
          created_by: input.session.createdBy,
          created_at: input.session.createdAt,
          updated_at: input.session.updatedAt,
          archived_at: input.session.archivedAt,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
    });
    return { ...input.session, lastSequence: 1 };
  }

  async findSession(sessionId: string): Promise<ProductWorkSessionDto | null> {
    const row = await this.db
      .selectFrom('product_work_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    return row ? sessionDto(row) : null;
  }

  async listSessions(
    requirementId: string,
    ownerId: string,
    limit: number,
  ): Promise<readonly ProductWorkSessionDto[]> {
    const rows = await this.db
      .selectFrom('product_work_sessions')
      .selectAll()
      .where('requirement_id', '=', requirementId)
      .where('owner_id', '=', ownerId)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(sessionDto);
  }

  async createTurn(input: {
    turn: ProductWorkTurnDto;
    expectedSessionVersion: number;
    contexts: readonly ContextBindingDto[];
    command: ProductWorkTurnCommandInput;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkTurnDto> {
    if (
      input.turn.sessionId !== input.event.sessionId ||
      input.turn.id !== input.command.turnId
    ) {
      throw new Error('WORK_TURN_CONTEXT_MISMATCH');
    }
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('product_work_turns')
        .values({
          id: input.turn.id,
          session_id: input.turn.sessionId,
          sequence: input.turn.sequence,
          intent_kind: input.turn.intentKind,
          input_text: input.turn.inputText,
          visible_response: input.turn.visibleResponse,
          status: input.turn.status,
          skill_release_id: input.turn.skillReleaseId,
          bridge_id: input.turn.bridgeId,
          external_thread_id: input.turn.externalIds.threadId,
          external_turn_id: input.turn.externalIds.turnId,
          usage_summary: input.turn.usageSummary,
          failure_reason: input.turn.failureReason,
          recovery_action: input.turn.recoveryAction,
          content_retention_until: input.turn.contentRetentionUntil,
          redacted_at: input.turn.redactedAt,
          row_version: input.turn.rowVersion,
          created_by: input.turn.createdBy,
          created_at: input.turn.createdAt,
          updated_at: input.turn.updatedAt,
          terminal_at: input.turn.terminalAt,
        })
        .executeTakeFirstOrThrow();
      if (input.contexts.length > 0) {
        await transaction
          .insertInto('product_work_context_bindings')
          .values(
            input.contexts.map((context) => ({
              id: context.id,
              session_id: context.sessionId,
              turn_id: context.turnId,
              context_type: context.contextType,
              target_id: context.targetId,
              target_version: context.targetVersion,
              content_hash: context.contentHash,
              binding_role: context.bindingRole,
              sensitivity: context.sensitivity,
              invalidated_at: context.invalidatedAt,
              reason_code: context.reasonCode,
              created_at: context.createdAt,
            })),
          )
          .execute();
      }
      await transaction
        .insertInto('product_work_turn_commands')
        .values({
          id: input.command.id,
          turn_id: input.command.turnId,
          command_type: input.command.commandType,
          payload_summary: input.command.payloadSummary,
          status: 'PENDING',
          required_capability: input.command.requiredCapability,
          lease_owner: null,
          lease_until: null,
          attempt: 0,
          idempotency_key: input.command.idempotencyKey,
          result_summary: null,
          created_at: input.command.createdAt,
          updated_at: input.command.createdAt,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
      const updated = await transaction
        .updateTable('product_work_sessions')
        .set({
          active_turn_id: input.turn.id,
          last_sequence: input.event.sequence,
          row_version: input.expectedSessionVersion + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.turn.sessionId)
        .where('row_version', '=', input.expectedSessionVersion)
        .where('active_turn_id', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw new Error('WORK_SESSION_VERSION_CONFLICT');
      }
    });
    return input.turn;
  }

  async findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<ProductWorkTurnDto | null> {
    const row = await this.db
      .selectFrom('product_work_turn_commands')
      .innerJoin(
        'product_work_turns',
        'product_work_turns.id',
        'product_work_turn_commands.turn_id',
      )
      .selectAll('product_work_turns')
      .where('product_work_turns.session_id', '=', sessionId)
      .where('product_work_turn_commands.idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return row ? turnDto(row) : null;
  }

  async listTurns(
    sessionId: string,
    limit: number,
  ): Promise<readonly ProductWorkTurnDto[]> {
    const rows = await this.db
      .selectFrom('product_work_turns')
      .selectAll()
      .where('session_id', '=', sessionId)
      .orderBy('sequence')
      .limit(limit)
      .execute();
    return rows.map(turnDto);
  }

  async findTurn(turnId: string): Promise<ProductWorkTurnDto | null> {
    const row = await this.db
      .selectFrom('product_work_turns')
      .selectAll()
      .where('id', '=', turnId)
      .executeTakeFirst();
    return row ? turnDto(row) : null;
  }

  async listContexts(sessionId: string): Promise<readonly ContextBindingDto[]> {
    const rows = await this.db
      .selectFrom('product_work_context_bindings')
      .selectAll()
      .where('session_id', '=', sessionId)
      .orderBy('created_at')
      .execute();
    return rows.map((row) => ({
      schemaVersion: 'product-work-context-binding/1',
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      contextType: row.context_type,
      targetId: row.target_id,
      targetVersion: row.target_version,
      contentHash: row.content_hash,
      bindingRole: row.binding_role,
      sensitivity: row.sensitivity,
      invalidatedAt: row.invalidated_at ? timestamp(row.invalidated_at) : null,
      reasonCode: row.reason_code,
      createdAt: timestamp(row.created_at),
    }));
  }

  async createProposal(input: {
    proposal: ActionProposalDto;
    expectedSessionVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ActionProposalDto> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('product_action_proposals')
        .values({
          id: input.proposal.id,
          session_id: input.proposal.sessionId,
          turn_id: input.proposal.turnId,
          kind: input.proposal.kind,
          schema_version: input.proposal.schemaVersion,
          target_type: input.proposal.target.aggregateType,
          target_id: input.proposal.target.aggregateId,
          target_version: input.proposal.target.rowVersion,
          change_set: input.proposal.changeSet,
          display_diff: JSON.stringify(input.proposal.displayDiff),
          scope_hash: input.proposal.scopeHash,
          confirmation_requirement: input.proposal.confirmationRequirement,
          status: input.proposal.status,
          confirmed_by: input.proposal.confirmedBy,
          confirmed_at: input.proposal.confirmedAt,
          reason_code: input.proposal.reasonCode,
          apply_lease_owner: null,
          apply_lease_until: null,
          apply_attempt: 0,
          result_type: input.proposal.resultRef?.aggregateType ?? null,
          result_id: input.proposal.resultRef?.aggregateId ?? null,
          result_version: input.proposal.resultRef?.rowVersion ?? null,
          failure_reason: input.proposal.failureReason,
          row_version: input.proposal.rowVersion,
          created_at: input.proposal.createdAt,
          updated_at: input.proposal.updatedAt,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
      const updated = await transaction
        .updateTable('product_work_sessions')
        .set({
          last_sequence: input.event.sequence,
          row_version: input.expectedSessionVersion + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.proposal.sessionId)
        .where('row_version', '=', input.expectedSessionVersion)
        .executeTakeFirstOrThrow();
      if (Number(updated.numUpdatedRows) !== 1) {
        throw new Error('WORK_SESSION_VERSION_CONFLICT');
      }
    });
    return input.proposal;
  }

  async findProposal(proposalId: string): Promise<ActionProposalDto | null> {
    const row = await this.db
      .selectFrom('product_action_proposals')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      schemaVersion: row.schema_version,
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      kind: row.kind,
      target: {
        aggregateType: row.target_type,
        aggregateId: row.target_id,
        rowVersion: row.target_version,
      },
      changeSet: row.change_set as ActionProposalDto['changeSet'],
      displayDiff: row.display_diff as ActionProposalDto['displayDiff'],
      scopeHash: row.scope_hash,
      confirmationRequirement: row.confirmation_requirement,
      status: row.status,
      confirmedBy: row.confirmed_by,
      confirmedAt: row.confirmed_at ? timestamp(row.confirmed_at) : null,
      reasonCode: row.reason_code,
      resultRef:
        row.result_type && row.result_id && row.result_version !== null
          ? {
              aggregateType: row.result_type as NonNullable<
                ActionProposalDto['resultRef']
              >['aggregateType'],
              aggregateId: row.result_id,
              rowVersion: row.result_version,
            }
          : null,
      failureReason: row.failure_reason,
      rowVersion: row.row_version,
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }

  async findPendingProposal(
    sessionId: string,
  ): Promise<ActionProposalDto | null> {
    const row = await this.db
      .selectFrom('product_action_proposals')
      .select('id')
      .where('session_id', '=', sessionId)
      .where('status', 'in', [
        'DRAFT',
        'PENDING_CONFIRMATION',
        'CONFIRMED',
        'APPLYING',
        'UNKNOWN',
      ])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return row ? this.findProposal(row.id) : null;
  }

  async listLinkedAgentRunIds(sessionId: string): Promise<readonly string[]> {
    const rows = await this.db
      .selectFrom('product_work_context_bindings')
      .select('target_id')
      .distinct()
      .where('session_id', '=', sessionId)
      .where('context_type', '=', 'AGENT_RUN')
      .execute();
    return rows.map((row) => row.target_id);
  }

  async updateSession(input: {
    session: ProductWorkSessionDto;
    expectedRowVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkSessionDto> {
    await this.db.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable('product_work_sessions')
        .set({
          current_requirement_version: input.session.currentRequirementVersion,
          status: input.session.status,
          active_turn_id: input.session.activeTurnId,
          last_sequence: input.event.sequence,
          block_reason: input.session.blockReason,
          row_version: input.session.rowVersion,
          updated_at: input.session.updatedAt,
          archived_at: input.session.archivedAt,
        })
        .where('id', '=', input.session.id)
        .where('row_version', '=', input.expectedRowVersion)
        .executeTakeFirstOrThrow();
      if (Number(result.numUpdatedRows) !== 1) {
        throw new Error('WORK_SESSION_VERSION_CONFLICT');
      }
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
    });
    return { ...input.session, lastSequence: input.event.sequence };
  }

  async updateTurn(input: {
    turn: ProductWorkTurnDto;
    expectedTurnVersion: number;
    expectedSessionVersion: number;
    command: ProductWorkTurnCommandInput;
    event: ProductWorkSessionEventDto;
  }): Promise<ProductWorkTurnDto> {
    await this.db.transaction().execute(async (transaction) => {
      const turnResult = await transaction
        .updateTable('product_work_turns')
        .set({
          status: input.turn.status,
          visible_response: input.turn.visibleResponse,
          bridge_id: input.turn.bridgeId,
          external_thread_id: input.turn.externalIds.threadId,
          external_turn_id: input.turn.externalIds.turnId,
          usage_summary: input.turn.usageSummary,
          failure_reason: input.turn.failureReason,
          recovery_action: input.turn.recoveryAction,
          row_version: input.turn.rowVersion,
          updated_at: input.turn.updatedAt,
          terminal_at: input.turn.terminalAt,
        })
        .where('id', '=', input.turn.id)
        .where('row_version', '=', input.expectedTurnVersion)
        .executeTakeFirstOrThrow();
      if (Number(turnResult.numUpdatedRows) !== 1) {
        throw new Error('WORK_TURN_VERSION_CONFLICT');
      }
      await transaction
        .insertInto('product_work_turn_commands')
        .values({
          id: input.command.id,
          turn_id: input.command.turnId,
          command_type: input.command.commandType,
          payload_summary: input.command.payloadSummary,
          status: 'PENDING',
          required_capability: input.command.requiredCapability,
          lease_owner: null,
          lease_until: null,
          attempt: 0,
          idempotency_key: input.command.idempotencyKey,
          result_summary: null,
          created_at: input.command.createdAt,
          updated_at: input.command.createdAt,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
      const sessionResult = await transaction
        .updateTable('product_work_sessions')
        .set({
          last_sequence: input.event.sequence,
          row_version: input.expectedSessionVersion + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.turn.sessionId)
        .where('row_version', '=', input.expectedSessionVersion)
        .executeTakeFirstOrThrow();
      if (Number(sessionResult.numUpdatedRows) !== 1) {
        throw new Error('WORK_SESSION_VERSION_CONFLICT');
      }
    });
    return input.turn;
  }

  async updateProposal(input: {
    proposal: ActionProposalDto;
    expectedProposalVersion: number;
    expectedSessionVersion: number;
    event: ProductWorkSessionEventDto;
  }): Promise<ActionProposalDto> {
    await this.db.transaction().execute(async (transaction) => {
      const proposalResult = await transaction
        .updateTable('product_action_proposals')
        .set({
          status: input.proposal.status,
          confirmed_by: input.proposal.confirmedBy,
          confirmed_at: input.proposal.confirmedAt,
          reason_code: input.proposal.reasonCode,
          result_type: input.proposal.resultRef?.aggregateType ?? null,
          result_id: input.proposal.resultRef?.aggregateId ?? null,
          result_version: input.proposal.resultRef?.rowVersion ?? null,
          failure_reason: input.proposal.failureReason,
          row_version: input.proposal.rowVersion,
          updated_at: input.proposal.updatedAt,
        })
        .where('id', '=', input.proposal.id)
        .where('row_version', '=', input.expectedProposalVersion)
        .executeTakeFirstOrThrow();
      if (Number(proposalResult.numUpdatedRows) !== 1) {
        throw new Error('ACTION_PROPOSAL_VERSION_CONFLICT');
      }
      await transaction
        .insertInto('product_work_session_events')
        .values(eventValues(input.event))
        .executeTakeFirstOrThrow();
      const sessionResult = await transaction
        .updateTable('product_work_sessions')
        .set({
          last_sequence: input.event.sequence,
          row_version: input.expectedSessionVersion + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.proposal.sessionId)
        .where('row_version', '=', input.expectedSessionVersion)
        .executeTakeFirstOrThrow();
      if (Number(sessionResult.numUpdatedRows) !== 1) {
        throw new Error('WORK_SESSION_VERSION_CONFLICT');
      }
    });
    return input.proposal;
  }

  async listEvents(sessionId: string, afterSequence: number, limit: number) {
    const rows = await this.db
      .selectFrom('product_work_session_events')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('sequence', '>', afterSequence)
      .orderBy('sequence')
      .limit(limit + 1)
      .execute();
    const selected = rows.slice(0, limit);
    const hasGap =
      selected.length > 0 && selected[0].sequence !== afterSequence + 1;
    return {
      reloadRequired: rows.length > limit || hasGap,
      items: selected.map((row): ProductWorkSessionEventDto => ({
        schemaVersion: 'product-work-session-event/1',
        eventId: row.id,
        sessionId: row.session_id,
        sequence: row.sequence,
        type: row.event_type,
        aggregateRef: {
          type: row.aggregate_type,
          id: row.aggregate_id,
        },
        safeSummary:
          row.safe_summary as ProductWorkSessionEventDto['safeSummary'],
        occurredAt: timestamp(row.occurred_at),
        receivedAt: timestamp(row.received_at),
      })),
    };
  }

  async leaseNextProductWorkTurnCommand(input: {
    bridgeId: string;
    leasedAt: string;
    leaseUntil: string;
  }): Promise<ProductWorkTurnCommand | null> {
    if (Date.parse(input.leaseUntil) <= Date.parse(input.leasedAt)) {
      throw new Error('PRODUCT_WORK_TURN_COMMAND_LEASE_INVALID');
    }
    return this.db.transaction().execute(async (transaction) => {
      const bridge = await transaction
        .selectFrom('bridge_registrations')
        .select('id')
        .where('id', '=', input.bridgeId)
        .where('status', '=', 'ONLINE')
        .where('revoked_at', 'is', null)
        .where(
          'last_heartbeat_at',
          '>=',
          new Date(Date.parse(input.leasedAt) - 90_000),
        )
        .executeTakeFirst();
      if (!bridge) return null;
      const snapshot = await transaction
        .selectFrom('bridge_capability_snapshots')
        .select('capabilities')
        .where('bridge_id', '=', input.bridgeId)
        .where('expires_at', '>', new Date(input.leasedAt))
        .orderBy('captured_at', 'desc')
        .executeTakeFirst();
      const capabilities =
        typeof snapshot?.capabilities === 'string'
          ? (JSON.parse(snapshot.capabilities) as unknown)
          : snapshot?.capabilities;
      const productWorkTurn =
        capabilities &&
        typeof capabilities === 'object' &&
        !Array.isArray(capabilities)
          ? (capabilities as Record<string, unknown>).productWorkTurn
          : null;
      if (
        !productWorkTurn ||
        typeof productWorkTurn !== 'object' ||
        Array.isArray(productWorkTurn) ||
        (productWorkTurn as Record<string, unknown>).state !== 'AVAILABLE' ||
        (productWorkTurn as Record<string, unknown>).protocolVersion !==
          PRODUCT_WORK_TURN_PROTOCOL_VERSION
      ) {
        return null;
      }

      const candidate = await transaction
        .selectFrom('product_work_turn_commands')
        .innerJoin(
          'product_work_turns',
          'product_work_turns.id',
          'product_work_turn_commands.turn_id',
        )
        .innerJoin(
          'product_work_sessions',
          'product_work_sessions.id',
          'product_work_turns.session_id',
        )
        .innerJoin(
          'requirements',
          'requirements.id',
          'product_work_sessions.requirement_id',
        )
        .innerJoin(
          'skill_releases',
          'skill_releases.id',
          'product_work_turns.skill_release_id',
        )
        .select([
          'product_work_turn_commands.id as command_id',
          'product_work_turn_commands.command_type',
          'product_work_turn_commands.payload_summary',
          'product_work_turn_commands.status as command_status',
          'product_work_turn_commands.attempt',
          'product_work_turn_commands.lease_owner',
          'product_work_turns.id as turn_id',
          'product_work_turns.row_version as turn_version',
          'product_work_turns.status as turn_status',
          'product_work_turns.bridge_id',
          'product_work_sessions.id as session_id',
          'product_work_sessions.requirement_id',
          'product_work_sessions.opened_requirement_version',
          'product_work_sessions.opened_baseline_id',
          'product_work_sessions.last_sequence',
          'requirements.row_version as current_requirement_version',
          'requirements.current_baseline_id',
          'skill_releases.id as skill_release_id',
          'skill_releases.content_hash as skill_content_hash',
          'skill_releases.status as skill_status',
          'skill_releases.evaluation_status as skill_evaluation_status',
        ])
        .where(
          'product_work_turn_commands.required_capability',
          '=',
          'product-work-turn/1',
        )
        .where('product_work_turn_commands.attempt', '<', 3)
        .where('product_work_turns.bridge_id', '=', input.bridgeId)
        .where((expression) =>
          expression.or([
            expression('product_work_turn_commands.status', '=', 'PENDING'),
            expression.and([
              expression('product_work_turn_commands.status', '=', 'LEASED'),
              expression(
                'product_work_turn_commands.lease_owner',
                '=',
                input.bridgeId,
              ),
              expression(
                'product_work_turn_commands.lease_until',
                '<=',
                new Date(input.leasedAt),
              ),
            ]),
          ]),
        )
        .where((expression) =>
          expression.or([
            expression.and([
              expression(
                'product_work_turn_commands.command_type',
                '=',
                'START_PRODUCT_WORK_TURN',
              ),
              expression('product_work_turns.status', '=', 'QUEUED'),
            ]),
            expression.and([
              expression(
                'product_work_turn_commands.command_type',
                '=',
                'INTERRUPT_PRODUCT_WORK_TURN',
              ),
              expression('product_work_turns.status', '=', 'CANCELLING'),
            ]),
            expression.and([
              expression(
                'product_work_turn_commands.command_type',
                '=',
                'VERIFY_PRODUCT_WORK_TURN',
              ),
              expression('product_work_turns.status', '=', 'UNKNOWN'),
            ]),
          ]),
        )
        .orderBy('product_work_turn_commands.created_at')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;
      if (
        candidate.skill_status !== 'ACTIVE' ||
        candidate.skill_evaluation_status !== 'PASSED'
      ) {
        return null;
      }
      const isStart = candidate.command_type === 'START_PRODUCT_WORK_TURN';
      if (
        isStart &&
        (candidate.current_requirement_version !==
          candidate.opened_requirement_version ||
          candidate.current_baseline_id !== candidate.opened_baseline_id)
      ) {
        return null;
      }
      const attempt = candidate.attempt + 1;
      await transaction
        .updateTable('product_work_turn_commands')
        .set({
          status: 'LEASED',
          lease_owner: input.bridgeId,
          lease_until: input.leaseUntil,
          attempt,
          updated_at: input.leasedAt,
        })
        .where('id', '=', candidate.command_id)
        .executeTakeFirstOrThrow();
      const stored =
        typeof candidate.payload_summary === 'string'
          ? (JSON.parse(candidate.payload_summary) as unknown)
          : candidate.payload_summary;
      const summary =
        stored && typeof stored === 'object' && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : {};
      const controlPayload = {
        sessionId: candidate.session_id,
        turnId: candidate.turn_id,
        turnVersion: candidate.turn_version,
      };
      return {
        schemaVersion: PRODUCT_WORK_TURN_COMMAND_VERSION,
        commandId: candidate.command_id,
        commandType: candidate.command_type,
        leaseUntil: input.leaseUntil,
        attempt,
        afterSequence: candidate.last_sequence,
        payload: isStart
          ? {
              ...controlPayload,
              requirementId: candidate.requirement_id,
              openedRequirementVersion: candidate.opened_requirement_version,
              baselineId: candidate.opened_baseline_id!,
              contextBindingIds: Array.isArray(summary.contextBindingIds)
                ? (summary.contextBindingIds as string[])
                : [],
              contextHash: String(summary.contextHash ?? ''),
              skillReleaseId: candidate.skill_release_id,
              skillContentHash: candidate.skill_content_hash,
            }
          : controlPayload,
      } as ProductWorkTurnCommand;
    });
  }

  async readLeasedProductWorkTurnContext(input: {
    bridgeId: string;
    commandId: string;
    readAt: string;
  }): Promise<ProductWorkTurnContext | null> {
    return this.db.transaction().execute(async (transaction) => {
      const command = await transaction
        .selectFrom('product_work_turn_commands')
        .innerJoin(
          'product_work_turns',
          'product_work_turns.id',
          'product_work_turn_commands.turn_id',
        )
        .innerJoin(
          'product_work_sessions',
          'product_work_sessions.id',
          'product_work_turns.session_id',
        )
        .innerJoin(
          'requirements',
          'requirements.id',
          'product_work_sessions.requirement_id',
        )
        .innerJoin(
          'skill_releases',
          'skill_releases.id',
          'product_work_turns.skill_release_id',
        )
        .select([
          'product_work_turn_commands.id as command_id',
          'product_work_turn_commands.payload_summary',
          'product_work_turns.id as turn_id',
          'product_work_turns.input_text',
          'product_work_turns.skill_release_id',
          'product_work_sessions.id as session_id',
          'product_work_sessions.opened_requirement_version',
          'product_work_sessions.opened_baseline_id',
          'requirements.row_version as current_requirement_version',
          'requirements.current_baseline_id',
          'skill_releases.content_hash as skill_content_hash',
          'skill_releases.status as skill_status',
          'skill_releases.evaluation_status as skill_evaluation_status',
        ])
        .where('product_work_turn_commands.id', '=', input.commandId)
        .where(
          'product_work_turn_commands.command_type',
          '=',
          'START_PRODUCT_WORK_TURN',
        )
        .where('product_work_turn_commands.status', '=', 'LEASED')
        .where('product_work_turn_commands.lease_owner', '=', input.bridgeId)
        .where(
          'product_work_turn_commands.lease_until',
          '>',
          new Date(input.readAt),
        )
        .executeTakeFirst();
      if (
        !command ||
        command.skill_status !== 'ACTIVE' ||
        command.skill_evaluation_status !== 'PASSED' ||
        command.current_requirement_version !==
          command.opened_requirement_version ||
        command.current_baseline_id !== command.opened_baseline_id
      ) {
        return null;
      }
      const rows = await transaction
        .selectFrom('product_work_context_bindings')
        .innerJoin(
          'material_refs',
          'material_refs.id',
          'product_work_context_bindings.target_id',
        )
        .select([
          'product_work_context_bindings.id as binding_id',
          'product_work_context_bindings.context_type',
          'product_work_context_bindings.target_id',
          'product_work_context_bindings.target_version',
          'product_work_context_bindings.content_hash',
          'product_work_context_bindings.sensitivity',
          'product_work_context_bindings.invalidated_at',
          'material_refs.version as material_version',
          'material_refs.content_hash as material_content_hash',
          'material_refs.source as content',
          'material_refs.validity',
        ])
        .where('product_work_context_bindings.turn_id', '=', command.turn_id)
        .orderBy('product_work_context_bindings.created_at')
        .execute();
      if (
        rows.length < 1 ||
        rows.some(
          (row) =>
            row.context_type !== 'MATERIAL_REF' ||
            row.invalidated_at !== null ||
            row.validity !== 'VALID' ||
            row.material_content_hash?.toLowerCase() !==
              row.content_hash.toLowerCase() ||
            `sha256:${createHash('sha256').update(row.content).digest('hex')}`.toLowerCase() !==
              row.content_hash.toLowerCase() ||
            (row.target_version !== null &&
              Number(row.material_version) !== row.target_version),
        )
      ) {
        return null;
      }
      const stored =
        typeof command.payload_summary === 'string'
          ? (JSON.parse(command.payload_summary) as unknown)
          : command.payload_summary;
      const summary =
        stored && typeof stored === 'object' && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : {};
      return {
        schemaVersion: PRODUCT_WORK_TURN_CONTEXT_VERSION,
        protocolVersion: PRODUCT_WORK_TURN_PROTOCOL_VERSION,
        commandId: command.command_id,
        sessionId: command.session_id,
        turnId: command.turn_id,
        contextHash: String(summary.contextHash ?? ''),
        userMessage: command.input_text,
        contextItems: rows.map((row) => ({
          bindingId: row.binding_id,
          contextType: row.context_type,
          targetId: row.target_id,
          targetVersion: row.target_version,
          contentHash: row.content_hash,
          sensitivity: row.sensitivity,
          content: row.content,
        })),
        skill: {
          releaseId: command.skill_release_id,
          contentHash: command.skill_content_hash,
        },
      };
    });
  }

  async appendProductWorkTurnBridgeEvent(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    event: ProductWorkTurnEvent;
    receivedAt: string;
    proposal?: ActionProposalDto;
  }): Promise<
    | { status: 'APPENDED' | 'DUPLICATE' | 'COMMAND_INVALID' }
    | { status: 'SEQUENCE_GAP'; nextExpectedSequence: number }
  > {
    return this.db.transaction().execute(async (transaction) => {
      const command = await transaction
        .selectFrom('product_work_turn_commands')
        .select('id')
        .where('id', '=', input.commandId)
        .where('turn_id', '=', input.turnId)
        .where('lease_owner', '=', input.bridgeId)
        .where('status', '=', 'LEASED')
        .executeTakeFirst();
      if (!command) return { status: 'COMMAND_INVALID' };
      const duplicate = await transaction
        .selectFrom('product_work_session_events')
        .select('id')
        .where('session_id', '=', input.sessionId)
        .where('source_event_id', '=', input.event.sourceEventId)
        .executeTakeFirst();
      if (duplicate) return { status: 'DUPLICATE' };
      const sessionRow = await transaction
        .selectFrom('product_work_sessions')
        .selectAll()
        .where('id', '=', input.sessionId)
        .forUpdate()
        .executeTakeFirst();
      const turnRow = await transaction
        .selectFrom('product_work_turns')
        .selectAll()
        .where('id', '=', input.turnId)
        .where('session_id', '=', input.sessionId)
        .forUpdate()
        .executeTakeFirst();
      if (!sessionRow || !turnRow) return { status: 'COMMAND_INVALID' };
      if (input.event.expectedSequence !== sessionRow.last_sequence + 1) {
        return {
          status: 'SEQUENCE_GAP',
          nextExpectedSequence: sessionRow.last_sequence + 1,
        };
      }
      const current = turnDto(turnRow);
      let next = current;
      switch (input.event.eventType) {
        case 'TURN_STARTED':
          next = transitionProductWorkTurn(current, 'RUNNING', {
            occurredAt: input.event.occurredAt,
            bridgeId: input.bridgeId,
            externalIds: {
              threadId: input.event.payload.threadId,
              turnId: input.event.payload.turnId,
            },
          });
          break;
        case 'TURN_MESSAGE_AVAILABLE':
          next = {
            ...current,
            visibleResponse: input.event.payload.message,
            rowVersion: current.rowVersion + 1,
            updatedAt: input.event.occurredAt,
          };
          break;
        case 'TURN_PROPOSAL_AVAILABLE':
          if (!input.proposal) return { status: 'COMMAND_INVALID' };
          next = transitionProductWorkTurn(current, 'PROPOSING', {
            occurredAt: input.event.occurredAt,
          });
          break;
        case 'TURN_COMPLETED':
          next = transitionProductWorkTurn(current, 'COMPLETED', {
            occurredAt: input.event.occurredAt,
          });
          break;
        case 'TURN_CANCELLED':
          next = transitionProductWorkTurn(current, 'CANCELLED', {
            occurredAt: input.event.occurredAt,
          });
          break;
        case 'TURN_FAILED':
          next = transitionProductWorkTurn(current, 'FAILED', {
            occurredAt: input.event.occurredAt,
            failureReason: input.event.payload.reasonCode,
            recoveryAction: 'RETURN_TO_STRUCTURED_WORKFLOW',
          });
          break;
        case 'TURN_UNKNOWN':
          next = transitionProductWorkTurn(current, 'UNKNOWN', {
            occurredAt: input.event.occurredAt,
            failureReason: input.event.payload.reasonCode,
            recoveryAction: 'VERIFY_TURN',
          });
          break;
      }
      await transaction
        .updateTable('product_work_turns')
        .set({
          status: next.status,
          visible_response: next.visibleResponse,
          bridge_id: next.bridgeId,
          external_thread_id: next.externalIds.threadId,
          external_turn_id: next.externalIds.turnId,
          failure_reason: next.failureReason,
          recovery_action: next.recoveryAction,
          row_version: next.rowVersion,
          updated_at: next.updatedAt,
          terminal_at: next.terminalAt,
        })
        .where('id', '=', input.turnId)
        .where('row_version', '=', current.rowVersion)
        .executeTakeFirstOrThrow();
      if (input.proposal) {
        await transaction
          .insertInto('product_action_proposals')
          .values({
            id: input.proposal.id,
            session_id: input.proposal.sessionId,
            turn_id: input.proposal.turnId,
            kind: input.proposal.kind,
            schema_version: input.proposal.schemaVersion,
            target_type: input.proposal.target.aggregateType,
            target_id: input.proposal.target.aggregateId,
            target_version: input.proposal.target.rowVersion,
            change_set: input.proposal.changeSet,
            display_diff: JSON.stringify(input.proposal.displayDiff),
            scope_hash: input.proposal.scopeHash,
            confirmation_requirement: input.proposal.confirmationRequirement,
            status: input.proposal.status,
            confirmed_by: null,
            confirmed_at: null,
            reason_code: null,
            apply_lease_owner: null,
            apply_lease_until: null,
            apply_attempt: 0,
            result_type: null,
            result_id: null,
            result_version: null,
            failure_reason: null,
            row_version: input.proposal.rowVersion,
            created_at: input.proposal.createdAt,
            updated_at: input.proposal.updatedAt,
          })
          .executeTakeFirstOrThrow();
      }
      const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(
        next.status,
      );
      await transaction
        .updateTable('product_work_sessions')
        .set({
          active_turn_id: terminal ? null : sessionRow.active_turn_id,
          status: next.status === 'UNKNOWN' ? 'BLOCKED' : sessionRow.status,
          block_reason:
            next.status === 'UNKNOWN'
              ? next.failureReason
              : sessionRow.block_reason,
          last_sequence: input.event.expectedSequence,
          row_version: sessionRow.row_version + 1,
          updated_at: input.event.occurredAt,
        })
        .where('id', '=', input.sessionId)
        .where('row_version', '=', sessionRow.row_version)
        .executeTakeFirstOrThrow();
      const safeSummary: Record<string, string | number | boolean | null> = {
        turnId: input.turnId,
        status: next.status,
      };
      if (input.event.eventType === 'TURN_MESSAGE_AVAILABLE') {
        safeSummary.messageLength = input.event.payload.message.length;
      }
      if (input.proposal) safeSummary.proposalKind = input.proposal.kind;
      assertSafeEventSummary(safeSummary);
      await transaction
        .insertInto('product_work_session_events')
        .values({
          id: input.event.sourceEventId,
          session_id: input.sessionId,
          sequence: input.event.expectedSequence,
          event_type: input.event.eventType,
          aggregate_type: 'product-work-turn',
          aggregate_id: input.turnId,
          safe_summary: safeSummary,
          source_event_id: input.event.sourceEventId,
          occurred_at: input.event.occurredAt,
          received_at: input.receivedAt,
        })
        .executeTakeFirstOrThrow();
      return { status: 'APPENDED' };
    });
  }

  async acknowledgeProductWorkTurnCommand(input: {
    bridgeId: string;
    commandId: string;
    sessionId: string;
    turnId: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | 'REJECTED';
    reasonCode?: string;
    threadId?: string;
    externalTurnId?: string;
    acknowledgedAt: string;
  }): Promise<'ACKNOWLEDGED' | 'IGNORED'> {
    const result = await this.db
      .updateTable('product_work_turn_commands')
      .set({
        status:
          input.status === 'UNKNOWN'
            ? 'UNKNOWN'
            : input.status === 'FAILED' || input.status === 'REJECTED'
              ? 'FAILED'
              : 'ACKNOWLEDGED',
        lease_until: null,
        result_summary: {
          status: input.status,
          reasonCode: input.reasonCode ?? null,
          threadId: input.threadId ?? null,
          externalTurnId: input.externalTurnId ?? null,
        },
        updated_at: input.acknowledgedAt,
      })
      .where('id', '=', input.commandId)
      .where('turn_id', '=', input.turnId)
      .where('lease_owner', '=', input.bridgeId)
      .where('status', '=', 'LEASED')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1 ? 'ACKNOWLEDGED' : 'IGNORED';
  }
}
