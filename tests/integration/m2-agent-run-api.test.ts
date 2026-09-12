import { afterAll, describe, expect, it } from 'vitest';

import type {
  AgentRunDto,
  AgentRunEventDto,
  AuthorizationPort,
  SkillReleaseDto,
} from '@pfc/contracts';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { AgentRunApplicationService } from '../../apps/server/src/agent-runs/index.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { SkillApplicationService } from '../../apps/server/src/skills/index.ts';

const now = '2026-09-06T05:00:00.000Z';
const actor = {
  actorId: 'CODEx_TEST_M2_API_ACTOR',
  roles: ['PRODUCT_OWNER'] as const,
  teamIds: ['CODEx_TEST_M2_API_TEAM'],
  authenticationStatus: 'AUTHENTICATED' as const,
};
const authorization: AuthorizationPort = {
  async lookupRequirementAuthorization(request) {
    return {
      status: 'AVAILABLE',
      source: 'POSTGRESQL',
      capabilityVersion: 'test/v1',
      checkedAt: now,
      data: {
        actorId: request.actor.actorId,
        requirementId: request.requirementId,
        membership: { team: 'YES', requirement: 'YES', restricted: 'YES' },
        allowedActions: ['RUN_AGENT', 'VIEW_AGENT_RUN'],
        approvedTransmissionTargets: [],
        actionAuthorizations: [],
      },
    };
  },
};
const release: SkillReleaseDto = {
  id: 'CODEx_TEST_M2_API_SKILL_RELEASE',
  skillKey: 'pfc-readonly-artifact-check',
  displayName: '只读产物检查',
  description: '检查已登记产物的结构和证据链。',
  sourceType: 'LOCAL_ALLOWLIST',
  logicalSource: 'project-skill:pfc-readonly-artifact-check',
  version: '2026.09.06-r1',
  contentHash: `sha256:${'a'.repeat(64)}`,
  license: null,
  compatibleHarnesses: ['codex-app-server/0.148'],
  requiredCapabilities: ['READ_WORKSPACE'],
  riskLevel: 'LOW',
  owner: '产品平台组',
  evaluationStatus: 'PASSED',
  enabledScopes: ['ARTIFACT_CHECK'],
  contextCost: null,
  status: 'ACTIVE',
  createdAt: now,
};

describe('M2 AgentRun and Skill HTTP API', () => {
  let current: AgentRunDto | null = null;
  let events: readonly AgentRunEventDto[] = [];
  const agentRuns = new AgentRunApplicationService({
    authorization: new RequirementAuthorizationService(authorization),
    now: () => now,
    idFactory: (prefix) => `CODEx_TEST_M2_API_${prefix}`,
    repository: {
      async resolveCreationContext() {
        return {
          requirementId: 'CODEx_TEST_M2_API_REQUIREMENT',
          currentBaselineId: 'CODEx_TEST_M2_API_BASELINE',
          sensitivity: 'INTERNAL',
          workspaceId: 'CODEx_TEST_M2_API_WORKSPACE',
          workspaceVerificationStatus: 'VERIFIED',
          workspaceAccessLevel: 'READ',
          skillReleaseId: release.id,
          skillContentHash: release.contentHash,
          skillEvaluationStatus: 'PASSED',
          skillEnabled: true,
          currentGitBaseline: '0123456789abcdef0123456789abcdef01234567',
          artifactVersionId: 'CODEx_TEST_M2_API_ARTIFACT_VERSION',
          artifactSourceRef: 'standards/requirement.md',
          artifactContentHash: `sha256:${'b'.repeat(64)}`,
        };
      },
      async resolveLaunchOptions() {
        return {
          requirementId: 'CODEx_TEST_M2_API_REQUIREMENT',
          baselineId: 'CODEx_TEST_M2_API_BASELINE',
          artifactSourceRef: 'standards/requirement.md',
          sensitivity: 'INTERNAL',
          workspaces: [
            {
              id: 'CODEx_TEST_M2_API_WORKSPACE',
              name: '只读测试工作区',
              repositoryLabel: 'product-full-chain-platform',
              gitBaseline: '0123456789abcdef0123456789abcdef01234567',
              bridgeId: 'CODEx_TEST_M2_API_BRIDGE',
              lastVerifiedAt: now,
              accessLevel: 'READ',
              skillReleaseIds: [release.id],
            },
          ],
          skills: [release],
        };
      },
      async createRun(input) {
        if (current) return { status: 'REPLAYED', run: current };
        current = input.run;
        events = [
          {
            ...input.event,
            runId: input.run.id,
            sequence: 1,
          },
        ];
        return { status: 'CREATED', run: current };
      },
      async findRun() {
        return current;
      },
      async findRunSensitivity() {
        return current ? 'INTERNAL' : null;
      },
      async listRunsForActor() {
        return current ? [current] : [];
      },
      async listEvents(_runId, afterSequence, limit) {
        return events
          .filter((event) => event.sequence > afterSequence)
          .slice(0, limit);
      },
    },
  });
  const skills = new SkillApplicationService({
    async listActive() {
      return [release];
    },
    async findRelease(skillKey, version) {
      return skillKey === release.skillKey && version === release.version
        ? release
        : null;
    },
  });
  const server = buildServer({
    agentRunService: agentRuns,
    skillService: skills,
    resolveActor: () => actor,
  });

  afterAll(async () => server.close());

  it('creates, replays, reads, and paginates a read-only run', async () => {
    const payload = {
      baselineId: 'CODEx_TEST_M2_API_BASELINE',
      workspaceId: 'CODEx_TEST_M2_API_WORKSPACE',
      skillKey: release.skillKey,
      skillVersion: release.version,
      operation: 'ARTIFACT_CHECK',
      accessMode: 'READ_ONLY',
    };
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements/CODEx_TEST_M2_API_REQUIREMENT/agent-runs',
      headers: { 'idempotency-key': 'CODEx_TEST_M2_API_KEY' },
      payload,
    });
    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements/CODEx_TEST_M2_API_REQUIREMENT/agent-runs',
      headers: { 'idempotency-key': 'CODEx_TEST_M2_API_KEY' },
      payload,
    });
    const runId = create.json().run.id as string;
    const read = await server.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}`,
    });
    const timeline = await server.inject({
      method: 'GET',
      url: `/api/v1/agent-runs/${runId}/events?afterSequence=0&limit=20`,
    });

    expect(create.statusCode).toBe(201);
    expect(create.headers.location).toBe(`/api/v1/agent-runs/${runId}`);
    expect(create.headers.etag).toBe('"0"');
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(read.json()).toMatchObject({ id: runId, accessMode: 'READ_ONLY' });
    expect(timeline.json()).toMatchObject({
      runId,
      afterSequence: 0,
      nextSequence: 1,
      items: [{ sequence: 1, eventType: 'RUN_QUEUED' }],
    });
    const list = await server.inject({
      method: 'GET',
      url: '/api/v1/agent-runs?limit=25',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ id: runId }] });
  });

  it('reads launch options from the current server-side Bridge snapshot', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/requirements/CODEx_TEST_M2_API_REQUIREMENT/agent-run-options',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      baselineId: 'CODEx_TEST_M2_API_BASELINE',
      workspaces: [
        {
          id: 'CODEx_TEST_M2_API_WORKSPACE',
          gitBaseline: '0123456789abcdef0123456789abcdef01234567',
          skillReleaseIds: [release.id],
        },
      ],
      skills: [{ id: release.id }],
    });
  });

  it('rejects missing idempotency and write mode without write permission', async () => {
    const payload = {
      baselineId: 'CODEx_TEST_M2_API_BASELINE',
      workspaceId: 'CODEx_TEST_M2_API_WORKSPACE',
      skillKey: release.skillKey,
      skillVersion: release.version,
      operation: 'ARTIFACT_CHECK',
      accessMode: 'WORKSPACE_WRITE',
    };
    const missingKey = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements/CODEx_TEST_M2_API_REQUIREMENT/agent-runs',
      payload: { ...payload, accessMode: 'READ_ONLY' },
    });
    const write = await server.inject({
      method: 'POST',
      url: '/api/v1/requirements/CODEx_TEST_M2_API_REQUIREMENT/agent-runs',
      headers: { 'idempotency-key': 'CODEx_TEST_M2_API_WRITE_KEY' },
      payload,
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lists fixed SkillRelease metadata without local paths', async () => {
    const catalog = await server.inject({
      method: 'GET',
      url: '/api/v1/skills',
    });
    const detail = await server.inject({
      method: 'GET',
      url: `/api/v1/skills/${release.skillKey}/releases/${release.version}`,
    });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual({ items: [release] });
    expect(detail.json()).toEqual(release);
    expect(detail.body).not.toContain('absolutePath');
  });
});
