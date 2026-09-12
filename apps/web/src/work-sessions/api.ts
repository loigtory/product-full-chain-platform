import {
  PRODUCT_WORK_SESSION_EVENT_TYPES,
  type ActionProposalMutationResponse,
  type ExecutionEvidenceListResponse,
  type McpReadRequestListResponse,
  type ProductWorkSessionEventDto,
  type ProductWorkSessionListResponse,
  type ProductWorkSessionMutationResponse,
  type ProductWorkSessionReadinessDto,
  type ProductWorkSessionSnapshotDto,
  type ProductWorkTransmissionAuthorizationMutationResponse,
  type ProductWorkTurnMutationResponse,
  type WorkTurnControlAction,
} from '@pfc/contracts';

import { createUiIdempotencyKey } from '../idempotency.ts';
import { platformRequest } from '../platform/api-client.ts';

export interface WorkSessionStreamSignal {
  sequence: number | null;
  type: string;
}

export type WorkSessionStreamState =
  'CONNECTING' | 'SYNCED' | 'RETRYING' | 'OFFLINE';

export interface WorkSessionsApi {
  listSessions(requirementId: string): Promise<ProductWorkSessionListResponse>;
  createSession(input: {
    requirementId: string;
    teamId?: string;
    title?: string;
  }): Promise<ProductWorkSessionMutationResponse>;
  getSnapshot(sessionId: string): Promise<ProductWorkSessionSnapshotDto>;
  getReadiness(sessionId: string): Promise<ProductWorkSessionReadinessDto>;
  listMcpReadRequests(input: {
    requirementId: string;
    sessionId: string;
  }): Promise<McpReadRequestListResponse>;
  listExecutionEvidence(
    requirementId: string,
  ): Promise<ExecutionEvidenceListResponse>;
  grantTransmissionAuthorization(input: {
    beneficiaryActorId: string;
    materialRefIds: readonly string[];
    sessionId: string;
    validForMinutes: number;
  }): Promise<ProductWorkTransmissionAuthorizationMutationResponse>;
  revokeTransmissionAuthorization(input: {
    authorizationId: string;
    rowVersion: number;
  }): Promise<ProductWorkTransmissionAuthorizationMutationResponse>;
  submitTurn(input: {
    contextTargetIds: readonly string[];
    intentKind: string;
    message: string;
    rowVersion: number;
    sessionId: string;
    skillReleaseId: string;
  }): Promise<ProductWorkTurnMutationResponse>;
  controlTurn(input: {
    action: WorkTurnControlAction;
    rowVersion: number;
    turnId: string;
  }): Promise<ProductWorkTurnMutationResponse>;
  decideProposal(input: {
    decision: 'CONFIRM' | 'REJECT';
    proposalId: string;
    reasonCode: string;
    rowVersion: number;
    scopeHash: string;
  }): Promise<ActionProposalMutationResponse>;
  subscribe(
    sessionId: string,
    afterSequence: number,
    onSignal: (signal: WorkSessionStreamSignal) => void,
    onError?: () => void,
    onState?: (state: WorkSessionStreamState) => void,
  ): () => void;
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return { 'Content-Type': 'application/json', ...extra };
}

export const workSessionsApi: WorkSessionsApi = {
  listSessions: (requirementId) =>
    platformRequest(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/work-sessions`,
    ),

  createSession: ({ requirementId, teamId, title }) =>
    platformRequest(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/work-sessions`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            'CREATE_PRODUCT_WORK_SESSION',
            'PFC_AIUX',
          ),
        }),
        body: JSON.stringify({
          schemaVersion: 'create-product-work-session/1',
          controlSurface: 'WEB',
          ...(teamId ? { teamId } : {}),
          ...(title ? { title } : {}),
        }),
      },
    ),

  getSnapshot: (sessionId) =>
    platformRequest(`/api/v1/work-sessions/${encodeURIComponent(sessionId)}`),

  getReadiness: (sessionId) =>
    platformRequest(
      `/api/v1/work-sessions/${encodeURIComponent(sessionId)}/readiness`,
    ),

  listMcpReadRequests: ({ requirementId, sessionId }) =>
    platformRequest(
      `/api/v1/work-sessions/${encodeURIComponent(sessionId)}/mcp-read-requests?requirementId=${encodeURIComponent(requirementId)}`,
    ),

  listExecutionEvidence: (requirementId) =>
    platformRequest(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/evidence?sourceType=MCP_READ_RESULT&limit=100`,
    ),

  grantTransmissionAuthorization: (input) =>
    platformRequest(
      `/api/v1/work-sessions/${encodeURIComponent(input.sessionId)}/transmission-authorizations`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            'GRANT_PRODUCT_WORK_TRANSMISSION',
            'PFC_AIUX',
          ),
        }),
        body: JSON.stringify({
          schemaVersion: 'create-product-work-transmission-authorization/1',
          beneficiaryActorId: input.beneficiaryActorId,
          materialRefIds: input.materialRefIds,
          validForMinutes: input.validForMinutes,
        }),
      },
    ),

  revokeTransmissionAuthorization: (input) =>
    platformRequest(
      `/api/v1/transmission-authorizations/${encodeURIComponent(input.authorizationId)}/revocations`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            'REVOKE_PRODUCT_WORK_TRANSMISSION',
            'PFC_AIUX',
          ),
          'If-Match': `"${input.rowVersion}"`,
        }),
        body: JSON.stringify({
          schemaVersion: 'revoke-product-work-transmission-authorization/1',
        }),
      },
    ),

  submitTurn: (input) =>
    platformRequest(
      `/api/v1/work-sessions/${encodeURIComponent(input.sessionId)}/turns`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            'SUBMIT_PRODUCT_WORK_TURN',
            'PFC_AIUX',
          ),
          'If-Match': `"${input.rowVersion}"`,
        }),
        body: JSON.stringify({
          schemaVersion: 'create-product-work-turn/1',
          intentKind: input.intentKind,
          message: input.message,
          contextBindingIds: input.contextTargetIds,
          skillReleaseId: input.skillReleaseId,
        }),
      },
    ),

  controlTurn: (input) =>
    platformRequest(
      `/api/v1/work-turns/${encodeURIComponent(input.turnId)}/controls`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            `${input.action}_PRODUCT_WORK_TURN`,
            'PFC_AIUX',
          ),
          'If-Match': `"${input.rowVersion}"`,
        }),
        body: JSON.stringify({
          schemaVersion: 'product-work-turn-control/1',
          action: input.action,
        }),
      },
    ),

  decideProposal: (input) =>
    platformRequest(
      `/api/v1/action-proposals/${encodeURIComponent(input.proposalId)}/decisions`,
      {
        method: 'POST',
        headers: jsonHeaders({
          'Idempotency-Key': createUiIdempotencyKey(
            'DECIDE_ACTION_PROPOSAL',
            'PFC_AIUX',
          ),
          'If-Match': `"${input.rowVersion}"`,
        }),
        body: JSON.stringify({
          schemaVersion: 'action-proposal-decision/1',
          decision: input.decision,
          scopeHash: input.scopeHash,
          reasonCode: input.reasonCode,
        }),
      },
    ),

  subscribe: (sessionId, afterSequence, onSignal, onError, onState) => {
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    const clearOfflineTimer = () => {
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = undefined;
    };
    const markSynchronized = () => {
      clearOfflineTimer();
      onState?.('SYNCED');
    };
    onState?.('CONNECTING');
    const source = new EventSource(
      `/api/v1/work-sessions/${encodeURIComponent(sessionId)}/events?after=${afterSequence}`,
    );
    source.onopen = markSynchronized;
    const listeners = [
      ...PRODUCT_WORK_SESSION_EVENT_TYPES,
      'RELOAD_REQUIRED',
    ].map((type) => {
      const listener = (event: Event) => {
        markSynchronized();
        if (type === 'RELOAD_REQUIRED') {
          onSignal({ sequence: null, type });
          return;
        }
        const parsed = JSON.parse((event as MessageEvent<string>).data) as
          ProductWorkSessionEventDto | undefined;
        onSignal({ sequence: parsed?.sequence ?? null, type });
      };
      source.addEventListener(type, listener);
      return { listener, type };
    });
    source.onerror = () => {
      onState?.('RETRYING');
      onError?.();
      offlineTimer ??= setTimeout(() => onState?.('OFFLINE'), 45_000);
    };
    return () => {
      clearOfflineTimer();
      listeners.forEach(({ listener, type }) =>
        source.removeEventListener(type, listener),
      );
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  },
};
