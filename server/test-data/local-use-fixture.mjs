import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { layout, read, noLinks, fault, repo } = require('../src/local/profile');
const { connection } = require('../src/local/ops-config');
export const out = resolve(
  repo,
  'docs/quality-gate/reports/local-use-baseline-20260913/local-use',
);
export async function gate(name, work) {
  const started = Date.now();
  const report = {
    at: new Date().toISOString(),
    command:
      name === 'browser'
        ? 'node output/pfc-workbench-prototype/verify-local-use-browser.mjs'
        : name === 'ops-profile'
          ? 'node --input-type=module (bounded ops timing probe)'
          : 'node server/verify-local-use-' + name + '.mjs',
    environment:
      'loopback synthetic only; source .env.local; authorization 40/41',
    status: 'FAIL',
    results: [],
    cleanup: 'NOT_RUN',
  };
  try {
    await work(report, async (scenario, run) => {
      const began = Date.now();
      await run();
      report.results.push({
        scenario,
        status: 'PASS',
        elapsedMs: Date.now() - began,
      });
      console.log(JSON.stringify({ scenario, status: 'PASS' }));
    });
    report.status = 'PASS';
  } catch (e) {
    report.error = {
      code: /^[A-Z_0-9]+$/.test(e.code || '') ? e.code : 'CHECK_FAILED',
      location: String(e.stack || '')
        .split('\n')
        .filter((x) => /^\s+at /.test(x))
        .slice(0, 4)
        .join('\n'),
    };
    process.exitCode = 1;
  } finally {
    report.elapsedMs = Date.now() - started;
    if (report.elapsedMs > 180000) {
      report.status = 'FAIL';
      report.error = { ...report.error, code: 'GATE_DEADLINE_EXCEEDED' };
      process.exitCode = 1;
    }
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      resolve(out, name + '-' + Date.now() + '.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        ...report,
        sourceHashes: undefined,
        cleanup:
          typeof report.cleanup === 'object'
            ? {
                ...report.cleanup,
                createdCount: report.cleanup.createdIds?.length,
                createdIds: undefined,
              }
            : report.cleanup,
      }),
    );
  }
}
export async function fingerprint(pool) {
  const rows = (
    await pool.query(
      "SELECT n.nspname,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND n.nspname<>$1 ORDER BY 1,2,3,4",
      [schema],
    )
  ).rows;
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export async function fixture({ initialize = true } = {}) {
  const target = layout({ scope: 'source', runId: newRunId() });
  const pool = new Pool({
    ...connection(target).pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let before,
    owned = false,
    child,
    createdIds = [],
    baselineOid,
    activeCookie;
  let poolClosed = false;
  const closePool = async () => {
    if (!poolClosed) {
      poolClosed = true;
      await pool.end();
    }
  };
  try {
    if (
      fs.existsSync(target.root) ||
      (await require('../src/local/preflight').metadata(target))
    )
      throw fault('SYNTHETIC_TARGET_EXISTS');
    before = await fingerprint(pool);
    owned = true;
    const f = {
      target,
      pool,
      createdIds,
      get profile() {
        return read(target.profileFile);
      },
      get key() {
        return fs.readFileSync(resolve(target.root, 'access-key.txt'), 'utf8');
      },
      get base() {
        return 'http://127.0.0.1:' + target.apiPort;
      },
      async initialize(options) {
        try {
          return await require('../src/local/initialize').initialize(
            target,
            options,
          );
        } finally {
          if (fs.existsSync(target.profileFile))
            baselineOid = read(target.profileFile, false).ownedOid;
        }
      },
      async start() {
        const r = await require('../src/local/lifecycle').start(f.profile);
        child = r;
        return r.info;
      },
      async stop() {
        if (child) {
          await require('../src/local/lifecycle').stop(f.profile);
          await child.exit;
          child = null;
        }
      },
      async request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
        return fetch(f.base + path, {
          method,
          headers: {
            Origin: f.base,
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
          ...(body !== undefined
            ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
            : {}),
          signal: AbortSignal.timeout(10000),
        });
      },
      async login() {
        const r = await f.request('/api/auth/local-session', {
          method: 'POST',
          body: { key: f.key },
        });
        if (r.status !== 200) throw fault('SYNTHETIC_LOGIN_FAILED');
        activeCookie = r.headers.get('set-cookie').split(';')[0];
        return activeCookie;
      },
      runId: prefix,
      command: () => ({ commandId: prefix + '_' + randomUUID() }),
      async api(path, method = 'GET', body, _who = 'owner', expected = 200) {
        const r = await f.request('/api' + path, {
          method,
          body,
          cookie: activeCookie,
        });
        const data = await r.json();
        if (r.status !== expected)
          throw fault(data.error?.code || 'SYNTHETIC_API_STATUS');
        return data;
      },
      async refresh(id) {
        return (await f.api('/reqs/' + id)).req;
      },
      async write(id, path, body, expected = 200) {
        return f.api(
          '/reqs/' + id + path,
          'POST',
          {
            ...body,
            ...f.command(),
            expectedRevision: (await f.refresh(id)).revision,
          },
          'owner',
          expected,
        );
      },
      async upload(id, suffix = 'evidence') {
        const bytes = Buffer.from(prefix + '_' + suffix);
        return f.uploadBytes(id, bytes, suffix);
      },
      async uploadBytes(id, bytes, suffix, expected = 201) {
        const r = await f.write(
          id,
          '/materials',
          {
            name: prefix + '_' + suffix + '.txt',
            usage: 'attachment',
            allowed: true,
            file: {
              name: suffix + '.txt',
              mimeType: 'application/octet-stream',
              encoding: 'base64',
              content: bytes.toString('base64'),
            },
          },
          expected,
        );
        if (expected !== 201) return r;
        createdIds.push(r.material.id);
        return { id: r.material.id, version: r.material.version };
      },
      async volume(total = 100) {
        const start = Date.now();
        const existing = Number(
          (await pool.query('SELECT count(*) n FROM "' + schema + '".reqs'))
            .rows[0].n,
        );
        for (let i = existing; i < total; i++) {
          const q = (
            await f.api(
              '/reqs',
              'POST',
              {
                ...f.command(),
                name: prefix + '_volume_' + i,
                goal: '合成容量验证',
              },
              'owner',
              201,
            )
          ).req;
          createdIds.push(q.id);
          await f.upload(q.id, 'volume_' + i + '_1');
          await f.upload(q.id, 'volume_' + i + '_2');
        }
        return { requirements: total, elapsedMs: Date.now() - start };
      },
      async cleanup() {
        await f.stop();
        const p = fs.existsSync(target.profileFile)
          ? read(target.profileFile, false)
          : null;
        const row = await require('../src/local/preflight').metadata(target);
        if (row) {
          if (
            !owned ||
            !p ||
            !baselineOid ||
            row.oid !== baselineOid ||
            row.marker !== p.marker ||
            !row.owned
          )
            throw fault('SYNTHETIC_CLEANUP_NOT_OWNED');
          const tables = (
            await pool.query(
              'SELECT tablename FROM pg_tables WHERE schemaname=$1',
              [schema],
            )
          ).rows;
          let count = 0;
          for (const t of tables) {
            if (!/^[a-z_]+$/.test(t.tablename))
              throw fault('SYNTHETIC_TABLE_INVALID');
            count += Number(
              (
                await pool.query(
                  'SELECT count(*) n FROM "' +
                    schema +
                    '"."' +
                    t.tablename +
                    '"',
                )
              ).rows[0].n,
            );
          }
          if (count > 6500) throw fault('SYNTHETIC_ROW_LIMIT');
          if (tables.some((t) => t.tablename === 'tenants')) {
            const tenants = (
              await pool.query('SELECT id,name FROM "' + schema + '".tenants')
            ).rows;
            if (
              tenants.some(
                (t) => t.id !== p.tenantId || !t.name.startsWith(prefix),
              )
            )
              throw fault('SYNTHETIC_DATA_NOT_OWNED');
          }
          await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
        }
        if (owned && fs.existsSync(target.root)) {
          if (!p && fs.readdirSync(target.root).length === 0) {
            noLinks(target.root);
            fs.rmdirSync(target.root);
          } else {
            if (!p || p.runId !== target.runId)
              throw fault('SYNTHETIC_FILES_NOT_OWNED');
            require('../src/local/ops-files').manifest(
              target.root,
              2 * 1073741824,
            );
            noLinks(target.root);
            fs.rmSync(target.root, { recursive: true });
          }
        }
        if (
          (await require('../src/local/preflight').metadata(target)) ||
          fs.existsSync(target.root) ||
          (await fingerprint(pool)) !== before ||
          !(await require('../src/local/preflight').portFree(target.apiPort))
        )
          throw fault('SYNTHETIC_CLEANUP_READBACK_FAILED');
        await closePool();
        return {
          status: 'PASS',
          runId: target.runId,
          ownedOid: baselineOid,
          createdIds,
          schemaAbsent: true,
          filesAbsent: true,
          portFree: true,
          outsideFingerprintUnchanged: true,
        };
      },
    };
    if (initialize) {
      try {
        await f.initialize();
      } catch (e) {
        await f.cleanup();
        throw e;
      }
    }
    return f;
  } catch (e) {
    await closePool();
    throw e;
  }
}

export const prefix = 'CODEx_TEST_M2C_20260913_localuse';
export const schema = 'codex_test_m2c_20260913_localuse';
export const identity = Object.freeze({
  name: prefix + '_owner',
  role: 'owner',
  tenantId: '10000000-0000-4000-8000-000000000041',
});
export const syntheticKey = 'CODEx_TEST_' + 'x'.repeat(32);
export const newRunId = () => prefix + '_' + randomUUID();
export function clock() {
  let value = 1800000000000;
  return { now: () => value, advance: (ms) => (value += ms) };
}
export async function prepareChain(f) {
  const { toRequirement, completeArtifacts } =
    await import('./r2-artifact-fixture.mjs');
  const { planData, resultData } = await import('./m2c-release-fixture.mjs');
  const project = (
    await f.api(
      '/projects',
      'POST',
      {
        ...f.command(),
        name: prefix + '_project',
        path: 'D:/CODEx_TEST_/local-use',
        branch: 'CODEx_TEST_branch',
        source: 'existing',
        tech: ['JS'],
      },
      'owner',
      201,
    )
  ).project;
  let req = await toRequirement(
    {
      ...f,
      api: (path, method, body, ...rest) =>
        f.api(
          path,
          method,
          path === '/reqs' && method === 'POST'
            ? { ...body, projectId: project.id }
            : body,
          ...rest,
        ),
    },
    'chain',
  );
  req = await completeArtifacts(f.api, req, f.command);
  const id = req.id;
  f.createdIds.push(id, project.id);
  const evidence = await f.upload(id),
    second = await f.upload(id, 'second');
  const dev = req.versions.filter((v) => v.stage === 'dev').at(-1);
  await f.write(
    id,
    '/versions',
    {
      stage: 'dev',
      baseVersionId: dev.id,
      content: {
        title: prefix + '_开发交付',
        fields: [
          { name: '实施说明', value: prefix + '_名称校验' },
          { name: '范围', value: '合成表单' },
        ],
      },
    },
    201,
  );
  const group = (await f.api('/reqs/' + id + '/artifact-workspace'))
    .currentGroup;
  const draft = (
    await f.write(
      id,
      '/test-suites',
      { baseGroupId: group.id, fromAcceptance: true },
      201,
    )
  ).suite;
  const suite = (
    await f.write(
      id,
      '/test-suites',
      {
        baseGroupId: group.id,
        baseSuiteId: draft.id,
        cases: draft.cases.map((c) => ({
          ...c,
          dataPolicy: 'CODEx_TEST_空名称与普通名称',
          owner: f.profile.ownerName,
        })),
      },
      201,
    )
  ).suite;
  await f.write(id, '/test-suites/' + suite.id + '/adopt', {
    baseGroupId: group.id,
    currentSuiteId: null,
  });
  req = await f.refresh(id);
  const delivery = (
    await f.write(
      id,
      '/delivery-baselines',
      {
        devVersionId: req.versions.filter((v) => v.stage === 'dev').at(-1).id,
        versionRef: 'CODEx_TEST_build_1',
        changes: 'CODEx_TEST_名称校验',
        implementation: 'CODEx_TEST_合成实现',
        rollback: 'CODEx_TEST_前一版本',
        unimplemented: '无',
        evidence: [evidence],
      },
      201,
    )
  ).delivery;
  const batch = (
    await f.write(
      id,
      '/test-batches',
      {
        baselineId: delivery.id,
        environment: 'CODEx_TEST_本地合成',
        source: 'USER_REPORTED',
      },
      201,
    )
  ).batch;
  await f.write(
    id,
    '/test-batches/' + batch.id + '/results',
    {
      results: suite.cases.map((c) => ({
        caseId: c.caseId,
        status: 'PASS',
        sequence: 1,
        previousResultId: null,
        actual: prefix + '_空名称被拒绝',
        reason: '',
        executedAt: '2026-09-13T01:00:00Z',
        source: 'USER_REPORTED',
        evidence: [evidence],
      })),
    },
    201,
  );
  await f.write(id, '/test-batches/' + batch.id + '/complete', {});
  await f.write(
    id,
    '/product-acceptances',
    {
      baselineId: delivery.id,
      batchId: batch.id,
      decision: 'ACCEPTED',
      checks: { functionality: true, exceptions: true, evidence: true },
      comment: 'CODEx_TEST_合成验收',
      risks: '无',
    },
    201,
  );
  const plan = (
    await f.write(
      id,
      '/release-plans',
      planData([evidence], f.profile.ownerName),
      201,
    )
  ).plan;
  await f.write(id, '/releases', { planId: plan.id }, 201);
  await f.api('/releases/' + plan.id + '/approve', 'POST', {
    ...f.command(),
    expectedRevision: (await f.refresh(id)).revision,
    comment: 'CODEx_TEST_仅准备记录',
  });
  const record = (
    await f.write(
      id,
      '/releases/' + plan.id + '/reported-results',
      {
        ...resultData([evidence]),
        status: 'UNKNOWN',
        endedAt: null,
        locator: 'CODEx_TEST_job',
        responsible: f.profile.ownerName,
      },
      201,
    )
  ).record;
  return { id, evidence, second, planId: plan.id, recordId: record.id };
}
