import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequirementAuthorizationService } from '../../apps/server/src/access/authorization-service.ts';
import { buildServer } from '../../apps/server/src/app.ts';
import { ArtifactApplicationService } from '../../apps/server/src/artifacts/index.ts';
import { IdentityApplicationService } from '../../apps/server/src/identity/index.ts';
import { hashPassword } from '../../apps/server/src/identity/security.ts';
import { TeamApplicationService } from '../../apps/server/src/teams/index.ts';
import { WorkspaceApplicationService } from '../../apps/server/src/workspaces/index.ts';
import {
  PostgresArtifactRepository,
  PostgresAuthorizationPort,
  PostgresCollaborationRepository,
  PostgresIdentityRepository,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM1R1Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'COLLAB_API';
const schemaName = `codex_test_m1_r1_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM1R1Fixture(runId);
const password = 'CODEx local password 42';

function cookies(headers: string | string[] | undefined): string {
  const values = Array.isArray(headers) ? headers : headers ? [headers] : [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

if (connectionString) {
  describe('M1 collaboration and artifact HTTP API', () => {
    const database = createDatabase({ connectionString });
    const identityRepository = new PostgresIdentityRepository(
      database,
      schemaName,
    );
    const collaborationRepository = new PostgresCollaborationRepository(
      database,
      schemaName,
    );
    const artifactRepository = new PostgresArtifactRepository(
      database,
      schemaName,
    );
    const authorizationPort = new PostgresAuthorizationPort(
      database,
      schemaName,
    );
    const now = '2026-09-06T05:00:00.000Z';
    let sequence = 0;
    const ids = (prefix: string) =>
      `${fixture.account.id}_${prefix}_${++sequence}`;
    const identityService = new IdentityApplicationService(identityRepository, {
      now: () => now,
      idFactory: ids,
    });
    const teamService = new TeamApplicationService(
      collaborationRepository,
      identityService,
      () => now,
      ids,
    );
    const workspaceService = new WorkspaceApplicationService(
      collaborationRepository,
      () => now,
      ids,
    );
    const artifactService = new ArtifactApplicationService(
      artifactRepository,
      new RequirementAuthorizationService(authorizationPort),
      () => now,
      ids,
    );
    const server = buildServer({
      identityService,
      teamService,
      workspaceService,
      artifactService,
      resolveActor: (request) =>
        identityService.resolveActor(request.headers.cookie),
    });

    beforeAll(async () => {
      await dropLifecycleSchema(database, schemaName);
      await createLifecycleSchema(database, schemaName);
      await createM1CollaborationTables(database, schemaName);
      const derivation = await hashPassword(password);
      await identityRepository.createAccount({
        ...fixture.account,
        passwordHash: derivation.hash,
        passwordSalt: derivation.salt,
        now,
      });
      await collaborationRepository.createTeamWithOwner({
        ...fixture.team,
        ownerAccountId: fixture.account.id,
        now,
      });
      await database
        .withSchema(schemaName)
        .insertInto('requirements')
        .values({
          id: fixture.requirement.id,
          name: fixture.requirement.name,
          original_idea: fixture.requirement.originalIdea,
          initiator_id: fixture.account.id,
          business_owner_id: fixture.account.id,
          current_stage: 'G0',
          current_baseline_id: null,
          row_version: 0,
          draft_source_type: null,
          draft_source_description: null,
          draft_material_purpose: null,
          draft_sensitivity: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });

    afterAll(async () => {
      await server.close();
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('persists assignment, workspace binding, and an idempotent artifact catalog', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const cookie = cookies(login.headers['set-cookie']);
      const csrf = login.json().actor.csrfToken as string;
      const mutationHeaders = {
        cookie,
        'x-csrf-token': csrf,
        'idempotency-key': `${fixture.requestIds.createArtifact}_KEY`,
      };

      const assignment = await server.inject({
        method: 'PUT',
        url: `/api/v1/requirements/${fixture.requirement.id}/assignment`,
        headers: {
          ...mutationHeaders,
          'idempotency-key': `${fixture.requestIds.createArtifact}_ASSIGN`,
        },
        payload: {
          teamId: fixture.team.id,
          accountId: fixture.account.id,
          responsibility: 'PRODUCT_OWNER',
        },
      });
      const workspace = await server.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          ...mutationHeaders,
          'idempotency-key': `${fixture.requestIds.createArtifact}_WORKSPACE`,
        },
        payload: {
          teamId: fixture.team.id,
          name: fixture.workspace.name,
          repositoryLabel: fixture.workspace.repositoryLabel,
          repositoryFingerprint: fixture.workspace.repositoryFingerprint,
        },
      });
      const workspaceReplay = await server.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          ...mutationHeaders,
          'idempotency-key': `${fixture.requestIds.createArtifact}_WORKSPACE`,
        },
        payload: {
          teamId: fixture.team.id,
          name: fixture.workspace.name,
          repositoryLabel: fixture.workspace.repositoryLabel,
          repositoryFingerprint: fixture.workspace.repositoryFingerprint,
        },
      });
      const binding = await server.inject({
        method: 'PUT',
        url: `/api/v1/requirements/${fixture.requirement.id}/workspaces/${workspace.json().id}`,
        headers: {
          ...mutationHeaders,
          'idempotency-key': `${fixture.requestIds.createArtifact}_BINDING`,
        },
        payload: {
          teamId: fixture.team.id,
          allowedRelativePath: fixture.workspace.allowedRelativePath,
          accessLevel: 'WRITE',
        },
      });
      const artifactRequest = {
        capId: 'CAP-PFC-02',
        stage: 'G1',
        artifactType: 'PRD',
        title: '需求规格',
        versionLabel: 'V0.1',
        sourceType: 'WORKSPACE_RELATIVE',
        sourceRef: 'docs/requirements/spec.md',
        contentHash: 'sha256:11111111111111111111111111111111',
        sensitivity: 'INTERNAL',
      };
      const artifact = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirement.id}/artifacts`,
        headers: mutationHeaders,
        payload: artifactRequest,
      });
      const replay = await server.inject({
        method: 'POST',
        url: `/api/v1/requirements/${fixture.requirement.id}/artifacts`,
        headers: mutationHeaders,
        payload: artifactRequest,
      });
      const catalog = await server.inject({
        method: 'GET',
        url: `/api/v1/requirements/${fixture.requirement.id}/artifacts`,
        headers: { cookie },
      });

      expect(assignment.statusCode).toBe(200);
      expect(workspace.statusCode).toBe(201);
      expect(workspaceReplay.statusCode).toBe(200);
      expect(workspaceReplay.json()).toEqual(workspace.json());
      expect(workspaceReplay.headers['idempotent-replay']).toBe('true');
      expect(binding.statusCode).toBe(200);
      expect(artifact.statusCode).toBe(201);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({
        replayed: true,
        artifact: { id: artifact.json().artifact.id },
      });
      expect(catalog.json()).toEqual([
        expect.objectContaining({
          id: artifact.json().artifact.id,
          currentVersionId: artifact.json().artifact.currentVersionId,
        }),
      ]);
    });

    it('accepts a one-time invitation and resolves the new member from PostgreSQL', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const cookie = cookies(login.headers['set-cookie']);
      const csrf = login.json().actor.csrfToken as string;
      const invite = await server.inject({
        method: 'POST',
        url: `/api/v1/teams/${fixture.team.id}/members`,
        headers: {
          cookie,
          'x-csrf-token': csrf,
          'idempotency-key': `${fixture.requestIds.createArtifact}_INVITE`,
        },
        payload: { loginName: 'codex.invited', role: 'PRODUCT_MANAGER' },
      });
      const invitationToken = invite.json().invitationToken as string;
      const inviteReplay = await server.inject({
        method: 'POST',
        url: `/api/v1/teams/${fixture.team.id}/members`,
        headers: {
          cookie,
          'x-csrf-token': csrf,
          'idempotency-key': `${fixture.requestIds.createArtifact}_INVITE`,
        },
        payload: { loginName: 'codex.invited', role: 'PRODUCT_MANAGER' },
      });
      const accepted = await server.inject({
        method: 'POST',
        url: `/api/v1/invitations/${invitationToken}/accept`,
        payload: {
          displayName: 'CODEx_TEST_M1_R1 受邀产品经理',
          password: 'CODEx invited password 42',
        },
      });
      const replay = await server.inject({
        method: 'POST',
        url: `/api/v1/invitations/${invitationToken}/accept`,
        payload: {
          displayName: 'CODEx_TEST_M1_R1 受邀产品经理',
          password: 'CODEx invited password 42',
        },
      });
      const invitedLogin = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {
          loginName: 'codex.invited',
          password: 'CODEx invited password 42',
        },
      });

      expect(invite.statusCode).toBe(201);
      expect(invite.body).not.toContain('tokenHash');
      expect(inviteReplay.statusCode).toBe(503);
      expect(inviteReplay.json()).toMatchObject({
        code: 'RESULT_UNKNOWN',
        existingResourceId: invite.json().invitationId,
      });
      expect(inviteReplay.body).not.toContain(invitationToken);
      expect(accepted.statusCode).toBe(204);
      expect(replay.statusCode).toBe(404);
      expect(invitedLogin.statusCode).toBe(200);
      expect(invitedLogin.json()).toMatchObject({
        actor: {
          loginName: 'codex.invited',
          roles: ['PRODUCT_MANAGER'],
          currentTeamId: fixture.team.id,
        },
      });
    });

    it('returns a validation error when a collaboration mutation omits its idempotency key', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: {
          cookie: cookies(login.headers['set-cookie']),
          'x-csrf-token': login.json().actor.csrfToken as string,
        },
        payload: { name: 'CODEx_TEST_M1_R1 missing idempotency' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects a non-canonical workspace fingerprint without mutation effects', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const idempotencyKey = `${fixture.requestIds.createArtifact}_INVALID_WORKSPACE`;
      const counts = async () => {
        const scoped = database.withSchema(schemaName);
        const [workspaces, audit, outbox, idempotency] = await Promise.all([
          scoped
            .selectFrom('workspaces')
            .select(({ fn }) => fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow(),
          scoped
            .selectFrom('audit_events')
            .select(({ fn }) => fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow(),
          scoped
            .selectFrom('outbox_events')
            .select(({ fn }) => fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow(),
          scoped
            .selectFrom('idempotency_records')
            .select(({ fn }) => fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow(),
        ]);
        return [workspaces, audit, outbox, idempotency].map((item) =>
          Number(item.count),
        );
      };
      const before = await counts();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/workspaces',
        headers: {
          cookie: cookies(login.headers['set-cookie']),
          'x-csrf-token': login.json().actor.csrfToken as string,
          'idempotency-key': idempotencyKey,
        },
        payload: {
          teamId: fixture.team.id,
          name: `${fixture.workspace.name} invalid fingerprint`,
          repositoryLabel: fixture.workspace.repositoryLabel,
          repositoryFingerprint: `sha256:${'A'.repeat(64)}`,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        recoveryAction: 'CORRECT_INPUT',
      });
      expect(await counts()).toEqual(before);
    });
  });
}
