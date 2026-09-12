import type {
  AgentApprovalDecisionRequest,
  AgentApprovalDto,
  AgentApprovalListResponse,
  AgentAuditEntryDto,
  AgentControlRequest,
  AgentRunDto,
  AgentRunEventsResponse,
  AgentRunLaunchOptionsDto,
  AgentRunListResponse,
  AgentRunMutationResponse,
  BridgeListResponse,
  CreateBridgePairingResponse,
  CreateAgentRunRequest,
  SkillCatalogResponse,
} from '@pfc/contracts';

import { PlatformApiError, platformRequest } from '../platform/api-client.ts';
import { createUiIdempotencyKey } from '../idempotency.ts';
import type { BridgeCenterApi } from './BridgeCenter.tsx';

export interface AgentRunsApi extends BridgeCenterApi {
  listRuns(limit?: number): Promise<AgentRunListResponse>;
  getRun(runId: string): Promise<AgentRunDto>;
  listEvents(
    runId: string,
    afterSequence?: number,
    limit?: number,
  ): Promise<AgentRunEventsResponse>;
  listSkills(): Promise<SkillCatalogResponse>;
  listApprovals(limit?: number): Promise<AgentApprovalListResponse>;
  getApproval(runId: string, approvalId: string): Promise<AgentApprovalDto>;
  decideApproval(
    approvalId: string,
    rowVersion: number,
    request: AgentApprovalDecisionRequest,
  ): Promise<AgentApprovalDto>;
  controlRun(
    runId: string,
    rowVersion: number,
    request: AgentControlRequest,
  ): Promise<{
    replayed: boolean;
    run: AgentRunDto;
    childRun: AgentRunDto | null;
  }>;
  listAudit(
    runId: string,
    limit?: number,
  ): Promise<{ runId: string; items: readonly AgentAuditEntryDto[] }>;
}

export interface AgentRunLaunchApi {
  getLaunchOptions(requirementId: string): Promise<AgentRunLaunchOptionsDto>;
  createRun(
    requirementId: string,
    input: CreateAgentRunRequest,
    idempotencyKey: string,
  ): Promise<AgentRunMutationResponse>;
}

export const agentRunsApi: AgentRunsApi &
  AgentRunLaunchApi & {
    isAvailable(): Promise<boolean>;
  } = {
  listRuns(limit = 50) {
    return platformRequest(`/api/v1/agent-runs?limit=${limit}`);
  },
  getRun(runId) {
    return platformRequest(`/api/v1/agent-runs/${encodeURIComponent(runId)}`);
  },
  listEvents(runId, afterSequence = 0, limit = 200) {
    const query = new URLSearchParams({
      afterSequence: String(afterSequence),
      limit: String(limit),
    });
    return platformRequest(
      `/api/v1/agent-runs/${encodeURIComponent(runId)}/events?${query}`,
    );
  },
  listSkills() {
    return platformRequest('/api/v1/skills');
  },
  listApprovals(limit = 50) {
    return platformRequest(`/api/v1/agent-approvals?limit=${limit}`);
  },
  getApproval(runId, approvalId) {
    return platformRequest(
      `/api/v1/agent-runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    );
  },
  decideApproval(approvalId, rowVersion, request) {
    return platformRequest(
      `/api/v1/agent-approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('DECIDE_AGENT_APPROVAL'),
          'If-Match': `"${rowVersion}"`,
        },
        body: JSON.stringify(request),
      },
    );
  },
  controlRun(runId, rowVersion, request) {
    return platformRequest(
      `/api/v1/agent-runs/${encodeURIComponent(runId)}/controls`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey(
            `CONTROL_AGENT_RUN_${request.action}`,
          ),
          'If-Match': `"${rowVersion}"`,
        },
        body: JSON.stringify(request),
      },
    );
  },
  listAudit(runId, limit = 50) {
    return platformRequest(
      `/api/v1/agent-runs/${encodeURIComponent(runId)}/audit?limit=${limit}`,
    );
  },
  listBridges(teamId): Promise<BridgeListResponse> {
    return platformRequest(
      `/api/v1/teams/${encodeURIComponent(teamId)}/bridges`,
    );
  },
  createBridgePairing(teamId): Promise<CreateBridgePairingResponse> {
    return platformRequest(
      `/api/v1/teams/${encodeURIComponent(teamId)}/bridge-pairings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('CREATE_BRIDGE_PAIRING'),
        },
      },
    );
  },
  revokeBridge(bridgeId, reasonCode, expectedActiveRunCount) {
    return platformRequest(
      `/api/v1/bridges/${encodeURIComponent(bridgeId)}/revocations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createUiIdempotencyKey('REVOKE_BRIDGE'),
        },
        body: JSON.stringify({ reasonCode, expectedActiveRunCount }),
      },
    );
  },
  getLaunchOptions(requirementId) {
    return platformRequest(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/agent-run-options`,
    );
  },
  createRun(requirementId, input, idempotencyKey) {
    return platformRequest(
      `/api/v1/requirements/${encodeURIComponent(requirementId)}/agent-runs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(input),
      },
    );
  },
  async isAvailable() {
    try {
      await this.listSkills();
      return true;
    } catch (error) {
      if (error instanceof PlatformApiError && error.status === 404) {
        return false;
      }
      throw error;
    }
  },
};
