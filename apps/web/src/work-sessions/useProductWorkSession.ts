import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ExecutionEvidenceDto,
  McpReadRequestDto,
  ProductWorkSessionReadinessDto,
  ProductWorkSessionSnapshotDto,
  ProductWorkTurnDto,
} from '@pfc/contracts';

import { PlatformApiError } from '../platform/api-client.ts';
import type { WorkSessionStreamState, WorkSessionsApi } from './api.ts';

const hardReadinessBlockerCodes = new Set([
  'NO_CURRENT_BASELINE',
  'NO_VALID_CONTEXT',
  'BRIDGE_UNAVAILABLE',
  'BRIDGE_UNVERIFIED',
  'NO_COMPATIBLE_SKILL',
  'TRANSMISSION_AUTHORIZATION_REQUIRED',
  'TRANSMISSION_DENIED',
  'TRANSMISSION_STATUS_UNKNOWN',
]);

function messageFor(error: unknown): string {
  if (error instanceof PlatformApiError) {
    if (error.code === 'CONTEXT_STALE')
      return '需求上下文已变化，请刷新后核对。';
    if (error.code === 'BRIDGE_CAPABILITY_UNAVAILABLE') {
      return '当前没有可用的 Bridge 或 Skill 能力。';
    }
    if (error.code === 'TRANSMISSION_AUTH_REQUIRED') {
      return '当前材料还需要产品负责人授权后才能传输。';
    }
    if (error.code === 'FORBIDDEN') return '当前账号无权执行此操作。';
    if (error.code === 'RESULT_UNKNOWN')
      return '结果状态未知，请先执行只读核验。';
  }
  return error instanceof Error ? error.message : '工作空间暂时不可用。';
}

function selectLatestTurn(
  snapshot: ProductWorkSessionSnapshotDto | null,
): ProductWorkTurnDto | null {
  if (!snapshot?.turns.items.length) return null;
  return snapshot.turns.items.reduce((latest, item) =>
    item.sequence > latest.sequence ? item : latest,
  );
}

function replaceSessionParam(sessionId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('session', sessionId);
  window.history.replaceState(
    null,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function useProductWorkSession(input: {
  actorId: string;
  api: WorkSessionsApi;
  requirementId: string;
  teamId: string | null;
}) {
  const [snapshot, setSnapshot] =
    useState<ProductWorkSessionSnapshotDto | null>(null);
  const [readiness, setReadiness] =
    useState<ProductWorkSessionReadinessDto | null>(null);
  const [mcpRequests, setMcpRequests] = useState<readonly McpReadRequestDto[]>(
    [],
  );
  const [executionEvidence, setExecutionEvidence] = useState<
    readonly ExecutionEvidenceDto[]
  >([]);
  const [selectedContextIds, setSelectedContextIds] = useState<
    readonly string[]
  >([]);
  const [selectedSkillReleaseId, setSelectedSkillReleaseId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [streamState, setStreamState] =
    useState<WorkSessionStreamState>('CONNECTING');

  const loadSnapshot = useCallback(
    async (sessionId: string) => {
      const [
        nextSnapshot,
        nextReadiness,
        nextMcpRequests,
        nextExecutionEvidence,
      ] = await Promise.all([
        input.api.getSnapshot(sessionId),
        input.api.getReadiness(sessionId),
        input.api.listMcpReadRequests({
          requirementId: input.requirementId,
          sessionId,
        }),
        input.api.listExecutionEvidence(input.requirementId),
      ]);
      setSnapshot(nextSnapshot);
      setReadiness(nextReadiness);
      setMcpRequests(nextMcpRequests.items);
      setExecutionEvidence(nextExecutionEvidence.items);
      setSelectedContextIds(nextReadiness.recommendedContextIds);
      setSelectedSkillReleaseId(nextReadiness.recommendedSkillReleaseId);
      setEmpty(false);
      replaceSessionParam(sessionId);
      return nextSnapshot;
    },
    [input.api, input.requirementId],
  );

  useEffect(() => {
    let active = true;
    void input.api
      .listSessions(input.requirementId)
      .then(async (result) => {
        if (!active) return;
        const requestedId = new URL(window.location.href).searchParams.get(
          'session',
        );
        const selected =
          result.items.find((item) => item.id === requestedId) ??
          result.items[0];
        if (!selected) {
          setEmpty(true);
          setSnapshot(null);
          return;
        }
        await loadSnapshot(selected.id);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [input.api, input.requirementId, loadSnapshot]);

  const sessionId = snapshot?.session.id;
  const lastSequence = snapshot?.session.lastSequence;
  useEffect(() => {
    if (!sessionId || lastSequence === undefined) return;
    return input.api.subscribe(
      sessionId,
      lastSequence,
      () => {
        void loadSnapshot(sessionId).catch(() => undefined);
      },
      undefined,
      setStreamState,
    );
  }, [input.api, lastSequence, loadSnapshot, sessionId]);

  const latestTurn = useMemo(() => selectLatestTurn(snapshot), [snapshot]);
  const selectionRequiresRestrictedTransmission = Boolean(
    readiness &&
    selectedContextIds.some(
      (contextId) =>
        readiness.contextOptions.find(
          (context) => context.materialRefId === contextId,
        )?.sensitivity === 'RESTRICTED',
    ),
  );
  const activeAuthorizationCoversSelection = Boolean(
    readiness?.activeTransmissionAuthorization &&
    selectedContextIds.length > 0 &&
    selectedContextIds.every((contextId) =>
      readiness.activeTransmissionAuthorization?.materialRefIds.includes(
        contextId,
      ),
    ),
  );
  const readinessForSelection = useMemo(() => {
    if (
      !readiness ||
      readiness.transmissionStatus !== 'AUTHORIZATION_REQUIRED' ||
      (selectionRequiresRestrictedTransmission &&
        !activeAuthorizationCoversSelection)
    ) {
      return readiness;
    }
    return {
      ...readiness,
      transmissionStatus: 'READY' as const,
      blockers: readiness.blockers.filter(
        (blocker) => blocker.code !== 'TRANSMISSION_AUTHORIZATION_REQUIRED',
      ),
    };
  }, [
    activeAuthorizationCoversSelection,
    readiness,
    selectionRequiresRestrictedTransmission,
  ]);
  const availableSkillReleaseIds = useMemo(
    () =>
      readinessForSelection?.skillOptions
        .filter((skill) => skill.availability === 'AVAILABLE')
        .map((skill) => skill.releaseId) ?? [],
    [readinessForSelection],
  );
  const authorizationCoversSelection = Boolean(
    readinessForSelection &&
    (!selectionRequiresRestrictedTransmission ||
      activeAuthorizationCoversSelection),
  );
  const canSubmit = Boolean(
    snapshot &&
    readinessForSelection &&
    snapshot.session.ownerId === input.actorId &&
    snapshot.session.status === 'ACTIVE' &&
    !snapshot.session.activeTurnId &&
    selectedContextIds.length > 0 &&
    selectedContextIds.length <= 50 &&
    selectedContextIds.every((contextId) =>
      readinessForSelection.contextOptions.some(
        (context) => context.materialRefId === contextId,
      ),
    ) &&
    selectedSkillReleaseId &&
    availableSkillReleaseIds.includes(selectedSkillReleaseId) &&
    readinessForSelection.transmissionStatus === 'READY' &&
    authorizationCoversSelection &&
    !readinessForSelection.blockers.some((blocker) =>
      hardReadinessBlockerCodes.has(blocker.code),
    ),
  );

  async function perform<T>(name: string, action: () => Promise<T>) {
    setBusyAction(name);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(messageFor(cause));
      return undefined;
    } finally {
      setBusyAction(null);
    }
  }

  async function createSession() {
    await perform('create-session', async () => {
      const result = await input.api.createSession({
        requirementId: input.requirementId,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        title: '产品 Agent 协作',
      });
      await loadSnapshot(result.session.id);
    });
  }

  async function submitTurn(message: string) {
    if (!snapshot || !selectedSkillReleaseId || !canSubmit) return;
    await perform('submit-turn', async () => {
      await input.api.submitTurn({
        contextTargetIds: selectedContextIds,
        intentKind: 'PRODUCT_DISCOVERY',
        message,
        rowVersion: snapshot.session.rowVersion,
        sessionId: snapshot.session.id,
        skillReleaseId: selectedSkillReleaseId,
      });
      await loadSnapshot(snapshot.session.id);
    });
  }

  function toggleContext(materialRefId: string) {
    setSelectedContextIds((current) =>
      current.includes(materialRefId)
        ? current.filter((item) => item !== materialRefId)
        : current.length < 50
          ? [...current, materialRefId]
          : current,
    );
  }

  function selectSkill(releaseId: string) {
    setSelectedSkillReleaseId(releaseId || null);
  }

  async function grantTransmissionAuthorization() {
    if (
      !snapshot ||
      !readiness ||
      selectedContextIds.length === 0 ||
      selectedContextIds.length > 50
    ) {
      return;
    }
    await perform('grant-transmission', async () => {
      const result = await input.api.grantTransmissionAuthorization({
        beneficiaryActorId: snapshot.session.ownerId,
        materialRefIds: selectedContextIds,
        sessionId: snapshot.session.id,
        validForMinutes: 15,
      });
      setReadiness((current) =>
        current
          ? {
              ...current,
              transmissionStatus: 'READY',
              activeTransmissionAuthorization: {
                authorizationId: result.authorization.authorizationId,
                materialRefIds: result.authorization.materialRefIds,
                validUntil: result.authorization.validUntil,
                rowVersion: result.authorization.rowVersion,
              },
              blockers: current.blockers.filter(
                (blocker) =>
                  blocker.code !== 'TRANSMISSION_AUTHORIZATION_REQUIRED',
              ),
            }
          : current,
      );
    });
  }

  async function revokeTransmissionAuthorization() {
    const authorization = readiness?.activeTransmissionAuthorization;
    if (!authorization) return;
    await perform('revoke-transmission', async () => {
      await input.api.revokeTransmissionAuthorization({
        authorizationId: authorization.authorizationId,
        rowVersion: authorization.rowVersion,
      });
      setReadiness((current) =>
        current
          ? {
              ...current,
              transmissionStatus: 'AUTHORIZATION_REQUIRED',
              activeTransmissionAuthorization: null,
              blockers: current.blockers.some(
                (blocker) =>
                  blocker.code === 'TRANSMISSION_AUTHORIZATION_REQUIRED',
              )
                ? current.blockers
                : [
                    ...current.blockers,
                    {
                      code: 'TRANSMISSION_AUTHORIZATION_REQUIRED',
                      message: '所选受限材料需要产品负责人授权后才能传输。',
                      recoveryAction: 'REQUEST_TRANSMISSION_AUTHORIZATION',
                    },
                  ],
            }
          : current,
      );
    });
  }

  async function controlTurn(action: 'CANCEL' | 'VERIFY') {
    if (!latestTurn) return;
    await perform(`${action.toLowerCase()}-turn`, async () => {
      await input.api.controlTurn({
        action,
        rowVersion: latestTurn.rowVersion,
        turnId: latestTurn.id,
      });
      if (snapshot) await loadSnapshot(snapshot.session.id);
    });
  }

  async function decideProposal(decision: 'CONFIRM' | 'REJECT') {
    const current = snapshot?.pendingProposal;
    if (!current || !snapshot) return;
    await perform(`${decision.toLowerCase()}-proposal`, async () => {
      await input.api.decideProposal({
        decision,
        proposalId: current.id,
        reasonCode:
          decision === 'CONFIRM'
            ? 'PRODUCT_OWNER_CONFIRMED'
            : 'PRODUCT_OWNER_REJECTED',
        rowVersion: current.rowVersion,
        scopeHash: current.scopeHash,
      });
      await loadSnapshot(snapshot.session.id);
    });
  }

  return {
    busyAction,
    canSubmit,
    createSession,
    decideProposal,
    empty,
    error,
    executionEvidence,
    grantTransmissionAuthorization,
    latestTurn,
    loading,
    mcpRequests,
    readiness: readinessForSelection,
    refresh: snapshot
      ? () => perform('refresh', () => loadSnapshot(snapshot.session.id))
      : undefined,
    revokeTransmissionAuthorization,
    selectedContextIds,
    selectedSkillReleaseId,
    selectSkill,
    snapshot,
    streamState,
    submitTurn,
    toggleContext,
    controlTurn,
  };
}
