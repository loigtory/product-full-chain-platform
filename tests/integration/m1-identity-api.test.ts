import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../apps/server/src/app.ts';
import { IdentityApplicationService } from '../../apps/server/src/identity/index.ts';
import { hashPassword } from '../../apps/server/src/identity/security.ts';
import {
  PostgresCollaborationRepository,
  PostgresIdentityRepository,
  createDatabase,
  createLifecycleSchema,
  createM1CollaborationTables,
  dropLifecycleSchema,
} from '../../packages/persistence/src/index.ts';
import { createM1R1Fixture } from '../../packages/test-data/src/index.ts';

const connectionString = process.env.DATABASE_URL;
const runId = process.env.CODEX_TEST_RUN_ID ?? 'IDENTITY_API';
const schemaName = `codex_test_m1_r1_${runId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
const fixture = createM1R1Fixture(runId);
const password = 'CODEx local password 42';

function cookieHeader(headers: string | string[] | undefined): string {
  const values = Array.isArray(headers) ? headers : headers ? [headers] : [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

if (connectionString) {
  describe('M1 identity HTTP API', () => {
    const database = createDatabase({ connectionString });
    const identityRepository = new PostgresIdentityRepository(
      database,
      schemaName,
    );
    const collaboration = new PostgresCollaborationRepository(
      database,
      schemaName,
    );
    const now = '2026-09-06T04:00:00.000Z';
    let idSequence = 0;
    const service = new IdentityApplicationService(identityRepository, {
      now: () => now,
      idFactory: (prefix) => `${fixture.account.id}_${prefix}_${++idSequence}`,
    });
    const server = buildServer({
      identityService: service,
      secureCookies: true,
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
      await collaboration.createTeamWithOwner({
        ...fixture.team,
        ownerAccountId: fixture.account.id,
        now,
      });
    });

    afterAll(async () => {
      await server.close();
      await dropLifecycleSchema(database, schemaName);
      await database.destroy();
    });

    it('returns the same generic failure for unknown login and wrong password', async () => {
      const wrongPassword = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password: 'wrong' },
      });
      const unknown = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: 'unknown.account', password: 'wrong' },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrongPassword.json()).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
        message: '账号或密码不正确。',
      });
      expect(unknown.json()).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
        message: '账号或密码不正确。',
      });
    });

    it('creates a database session and resolves a redacted current actor', async () => {
      const anonymousState = await server.inject({
        method: 'GET',
        url: '/api/v1/session-state',
      });
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const cookies = cookieHeader(login.headers['set-cookie']);
      const me = await server.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { cookie: cookies },
      });
      const authenticatedState = await server.inject({
        method: 'GET',
        url: '/api/v1/session-state',
        headers: { cookie: cookies },
      });

      expect(anonymousState.statusCode).toBe(200);
      expect(anonymousState.json()).toEqual({ authenticated: false });
      expect(login.statusCode).toBe(200);
      expect(login.headers['set-cookie']).toBeDefined();
      expect(login.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('; Secure')]),
      );
      expect(login.body).not.toContain(password);
      expect(me.json()).toMatchObject({
        actorId: fixture.account.id,
        loginName: fixture.account.loginName,
        roles: ['TEAM_ADMIN'],
        currentTeamId: fixture.team.id,
      });
      expect(me.body).not.toContain('passwordHash');
      expect(me.body).not.toContain('sessionToken');
      expect(authenticatedState.json()).toMatchObject({
        authenticated: true,
        actor: { actorId: fixture.account.id },
      });
    });

    it('rejects mutation without matching CSRF and revokes a valid session', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { loginName: fixture.account.loginName, password },
      });
      const cookies = cookieHeader(login.headers['set-cookie']);
      const csrfToken = login.json().actor.csrfToken as string;
      const denied = await server.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: { cookie: cookies },
      });
      const logout = await server.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: { cookie: cookies, 'x-csrf-token': csrfToken },
      });
      const afterLogout = await server.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { cookie: cookies },
      });

      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: 'CSRF_INVALID' });
      expect(logout.statusCode).toBe(200);
      expect(afterLogout.statusCode).toBe(401);
      const securityActions = await database
        .withSchema(schemaName)
        .selectFrom('audit_events')
        .select('action')
        .where('actor_id', '=', fixture.account.id)
        .where('action', 'in', ['session.created', 'session.revoked'])
        .execute();
      expect(securityActions.map((item) => item.action)).toEqual(
        expect.arrayContaining(['session.created', 'session.revoked']),
      );
    });
  });
}
