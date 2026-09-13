import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  fixture as base,
  context,
  secondContext,
} from './m2c-domain-fixture.mjs';
const require = createRequire(import.meta.url);
export { context, secondContext };
export const runId = 'CODEx_TEST_M2C_20260913_governance';
export const schema = 'codex_test_m2c_20260913_governance';
export async function fixture({ start = true, artifacts = false } = {}) {
  const f = await base({ governance: true, artifacts });
  const { schema, runId } = f;
  const tokens = {};
  let server;
  try {
    await require('../src/persistence/migrations').migrate(f.db);
    await f.admin.query(
      `INSERT INTO "${schema}".tenants(id,name) VALUES($1,$2),($3,$4)`,
      [
        context.tenantId,
        runId + '_tenant',
        secondContext.tenantId,
        runId + '_other',
      ],
    );
    await f.prepareRuntime();
    const port = 5195,
      baseUrl = 'http://127.0.0.1:' + port;
    const raw = async (path, method = 'GET', body, who = 'owner') => {
      const response = await fetch(baseUrl + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(tokens[who] ? { authorization: 'Bearer ' + tokens[who] } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: response.status, body: data, headers: response.headers };
    };
    const api = async (
      path,
      method = 'GET',
      body,
      who = 'owner',
      status = 200,
    ) => {
      const r = await raw(path, method, body, who);
      assert.equal(
        r.status,
        status,
        JSON.stringify({ path, status: r.status, body: r.body }),
      );
      return r.body;
    };
    const login = async (who) => {
      const result = await api('/auth/dev-login', 'POST', {
        name: runId + '_' + who,
        role: 'owner',
      });
      tokens[who] = result.token;
      return result.user;
    };
    const startRuntime = async () => {
      server = await f.startServer(port);
      return server;
    };
    const restart = async () => {
      await f.stopServer(server);
      return startRuntime();
    };
    if (start) {
      await startRuntime();
      for (const who of [
        'owner',
        'owner2',
        'executor',
        'viewer',
        'other',
        'inactive',
      ])
        await login(who);
    }
    const command = () => ({ commandId: runId + '_' + randomUUID() });
    const readyRequirement = async (input = {}) => {
      let req = (
        await api(
          '/reqs',
          'POST',
          {
            name: runId + '_ready',
            goal: '合成开发验证',
            ...input,
            ...command(),
          },
          'owner',
          201,
        )
      ).req;
      for (const question of req.questions)
        req = (
          await api(
            '/reqs/' + req.id + '/questions/' + question.id + '/answer',
            'POST',
            {
              answer: 'CODEx_TEST_有效合成回答',
              expectedRevision: req.revision,
              ...command(),
            },
          )
        ).req;
      for (const to of ['req']) {
        const v = req.versions
          .filter((v) => v.stage === req.stage)
          .sort((a, b) => b.version - a.version)[0];
        req = (
          await api(
            '/reqs/' + req.id + '/versions/' + v.id + '/confirm',
            'POST',
            { expectedRevision: req.revision, ...command() },
          )
        ).req;
        req = (
          await api('/reqs/' + req.id + '/stage', 'PATCH', {
            to,
            expectedRevision: req.revision,
            ...command(),
          })
        ).req;
      }
      return (await import('./r2-artifact-fixture.mjs')).completeArtifacts(
        api,
        req,
        command,
      );
    };
    return {
      ...f,
      get db() {
        return f.db;
      },
      baseUrl,
      port,
      tokens,
      raw,
      api,
      login,
      restart,
      startRuntime,
      readyRequirement,
      get server() {
        return server;
      },
      command,
    };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
