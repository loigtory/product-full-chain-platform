import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
export const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
  } catch (e) {
    results.push({ name, status: 'FAIL', code: e.code, error: e.message });
  }
}
await test('G01 explicit 003 extends immutable 001 and 002', () => {
  const { registry } = require('./src/persistence/migrations');
  const a = registry('001'),
    b = registry('002'),
    c = registry('003');
  assert.deepEqual(c.slice(0, 2), b);
  assert.deepEqual(b.slice(0, 1), a);
  assert.equal(c[2].version, '003');
  assert.doesNotMatch(
    c[2].sql,
    /CREATE (?:DATABASE|ROLE|EXTENSION)|app_state/i,
  );
});
await test('G03 fresh role replaces stale token role; inactive and absent deny', async () => {
  const policy = require('./src/domain/membership-policy');
  const db = { schema: 'codex_test_m2c_20260913_governance' };
  const ctx = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    actor: 'CODEx_TEST_owner',
    role: 'owner',
  };
  let row = {
    id: 'member-uuid',
    public_id: 'MEM-1',
    name: ctx.actor,
    role: 'viewer',
    active: true,
    revision: 2,
  };
  const client = { query: async () => ({ rows: row ? [row] : [] }) };
  assert.equal((await policy.member(client, db, ctx)).role, 'viewer');
  await assert.rejects(
    () => policy.authorizeCommand(client, db, ctx, 'member.create'),
    { code: 'FORBIDDEN' },
  );
  row.active = false;
  await assert.rejects(() => policy.member(client, db, ctx), {
    code: 'MEMBER_INACTIVE',
  });
  row = null;
  await assert.rejects(() => policy.member(client, db, ctx), {
    code: 'MEMBER_NOT_CONFIGURED',
  });
});
await test('G03 inaccessible storage never falls back to configured role', async () => {
  const policy = require('./src/domain/membership-policy');
  await assert.rejects(
    () =>
      policy.member(
        {
          query: async () => {
            throw Object.assign(Error(), { code: 'CONNECTION_LOST' });
          },
        },
        { schema: 'codex_test_m2c_20260913_governance' },
        { actor: 'CODEx_TEST_owner', role: 'owner' },
      ),
    { code: 'CONNECTION_LOST' },
  );
});
await test('G04 body-shaped bridge context cannot bypass human authorization', async () => {
  const policy = require('./src/domain/membership-policy');
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () =>
      policy.authorizeCommand(
        client,
        { schema: 'codex_test_m2c_20260913_governance' },
        { role: 'bridge', internal: true, actor: 'Bridge:fake' },
        'bridge.event:fake',
      ),
    { code: 'FORBIDDEN' },
  );
});
let cleanup;
await test('G10 CSV formula injection and count/byte limits fail without partial downloads', () => {
  const { exportCsv } = require('./src/domain/governance-read-service');
  const csv = exportCsv([
    {
      id: 'CODEx_TEST_csv',
      actor: ' =HYPERLINK("synthetic")',
      detail: 'text,"quoted"\nline',
    },
  ]);
  assert.ok(csv.includes('"\' =HYPERLINK(""synthetic"")"'));
  assert.ok(csv.includes('text,""quoted""\nline'));
  assert.throws(() => exportCsv(Array.from({ length: 10001 }, () => ({}))), {
    code: 'EXPORT_LIMIT_EXCEEDED',
  });
  assert.throws(() => exportCsv([{ detail: '合'.repeat(2 * 1024 * 1024) }]), {
    code: 'EXPORT_LIMIT_EXCEEDED',
  });
});
if (
  !process.argv.includes('--unit') &&
  results.every((r) => r.status === 'PASS')
) {
  let f;
  try {
    const { fixture } = await import('./test-data/m2c-governance-fixture.mjs');
    f = await fixture();
    await test('G01 G02 PG readiness, members and role authority', async () => {
      assert.equal((await f.api('/health')).schemaVersion, '004');
      assert.equal((await f.login('viewer')).role, 'viewer');
      const list = await f.api('/members');
      assert.equal(list.total, 5);
      assert.ok(list.items.every((m) => m.id.startsWith('MEM-')));
      assert.equal(
        (await f.api('/members', 'GET', undefined, 'other')).total,
        1,
      );
      await f.stopServer(f.server);
      await f.db.pool.query(
        `UPDATE "${f.schema}".members SET active=false,disabled_at=now() WHERE tenant_id=$1 AND role='owner'`,
        [f.users[0].tenantId],
      );
      try {
        await assert.rejects(
          () => f.startRuntime(),
          /MEMBER_INITIALIZATION_REQUIRED/,
        );
      } finally {
        await f.db.pool.query(
          `UPDATE "${f.schema}".members SET active=true,disabled_at=NULL WHERE tenant_id=$1 AND role='owner'`,
          [f.users[0].tenantId],
        );
        await f.startRuntime();
      }
    });
    await test('G02 register configured identity, role revision, current JWT, soft disable and replay', async () => {
      const command = {
        name: f.runId + '_pending',
        role: 'executor',
        ...f.command(),
      };
      const added = (await f.api('/members', 'POST', command, 'owner', 201))
        .member;
      f.createdIds.push(added.id);
      assert.deepEqual(
        (await f.api('/members', 'POST', command, 'owner', 201)).member,
        added,
      );
      assert.equal(
        (
          await f.api(
            '/members',
            'POST',
            { ...command, role: 'viewer' },
            'owner',
            409,
          )
        ).error.code,
        'COMMAND_CONFLICT',
      );
      assert.equal(
        (
          await f.api(
            '/members',
            'POST',
            { name: f.runId + '_not_allowed', role: 'owner', ...f.command() },
            'owner',
            400,
          )
        ).error.code,
        'UNKNOWN_LOCAL_USER',
      );
      const exec = (await f.api('/members')).items.find(
        (m) => m.name === f.runId + '_executor',
      );
      const oldToken = f.tokens.executor;
      await f.api('/members/' + exec.id + '/role', 'PATCH', {
        role: 'viewer',
        expectedRevision: exec.revision,
        ...f.command(),
      });
      assert.equal(f.tokens.executor, oldToken);
      assert.equal(
        (await f.api('/auth/me', 'GET', undefined, 'executor')).user.role,
        'viewer',
      );
      await f.api(
        '/reqs',
        'POST',
        { name: f.runId + '_forbidden', ...f.command() },
        'executor',
        403,
      );
      const inactive = (await f.api('/members')).items.find(
        (m) => m.name === f.runId + '_inactive',
      );
      await f.api('/members/' + inactive.id, 'DELETE', {
        expectedRevision: inactive.revision,
        ...f.command(),
      });
      assert.equal(
        (await f.api('/auth/me', 'GET', undefined, 'inactive', 403)).error.code,
        'MEMBER_INACTIVE',
      );
      assert.equal(
        (await f.api('/reqs', 'GET', undefined, 'inactive', 403)).error.code,
        'MEMBER_INACTIVE',
      );
      await f.restart();
      assert.equal(
        (await f.api('/auth/me', 'GET', undefined, 'executor')).user.role,
        'viewer',
      );
      assert.equal(
        (await f.api('/members')).items.find((m) => m.id === inactive.id)
          .active,
        false,
      );
      const { initializeMembers } =
        await import('./scripts/initialize-m2c-members.mjs');
      // The 003-only bootstrap fails closed after 004; it must not reset roles.
      await assert.rejects(
        initializeMembers(f.db, f.users),
        (e) => e.code === 'MIGRATION_VERSION_INVALID',
      );
      assert.equal(
        (await f.api('/members')).items.find((m) => m.id === inactive.id)
          .active,
        false,
      );
      assert.equal(
        (await f.api('/auth/me', 'GET', undefined, 'executor')).user.role,
        'viewer',
      );
      const current = (await f.api('/members')).items.find(
        (m) => m.id === exec.id,
      );
      await f.api('/members/' + exec.id + '/role', 'PATCH', {
        role: 'executor',
        expectedRevision: current.revision,
        ...f.command(),
      });
    });
    await test('G03 revoked member socket closes before subsequent sensitive delivery', async () => {
      const { WebSocket } = require('ws');
      const { once } = await import('node:events');
      const ws = new WebSocket(
        f.baseUrl.replace('http:', 'ws:') + '/ws/web?token=' + f.tokens.owner2,
      );
      const received = [];
      ws.on('message', (b) => received.push(JSON.parse(String(b))));
      try {
        await once(ws, 'open');
        const user = (await f.api('/members')).items.find(
          (m) => m.name === f.runId + '_owner2',
        );
        const closed = once(ws, 'close');
        await f.api('/members/' + user.id + '/role', 'PATCH', {
          role: 'viewer',
          expectedRevision: user.revision,
          ...f.command(),
        });
        ws.send(JSON.stringify({ type: 'heartbeat' }));
        const [code] = await Promise.race([
          closed,
          new Promise((_, reject) =>
            setTimeout(() => reject(Error('revoked socket stayed open')), 4000),
          ),
        ]);
        assert.equal(code, 4003);
        assert.equal(
          received.some(
            (e) => e.type === 'governance.changed' && e.entityId === user.id,
          ),
          false,
        );
        await f.api(
          '/members',
          'POST',
          { name: f.runId + '_pending', role: 'viewer', ...f.command() },
          'owner2',
          403,
        );
        const now = (await f.api('/members')).items.find(
          (m) => m.id === user.id,
        );
        await f.api('/members/' + user.id + '/role', 'PATCH', {
          role: 'owner',
          expectedRevision: now.revision,
          ...f.command(),
        });
      } finally {
        ws.terminate();
      }
    });
    await test('G02 concurrent owner demotion never removes last owner', async () => {
      const owners = (await f.api('/members')).items.filter(
        (m) => m.role === 'owner' && m.active,
      );
      assert.equal(owners.length, 2);
      const replies = await Promise.all(
        owners.map((m) =>
          f.raw(
            '/members/' + m.id + '/role',
            'PATCH',
            { role: 'viewer', expectedRevision: m.revision, ...f.command() },
            m.name.endsWith('_owner2') ? 'owner2' : 'owner',
          ),
        ),
      );
      assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        replies.find((r) => r.status === 409).body.error.code,
        'LAST_OWNER_REQUIRED',
      );
      const list = (await f.api('/members')).items,
        remaining = list.find((m) => m.role === 'owner');
      const downgraded = list.find(
        (m) => owners.some((o) => o.id === m.id) && m.role === 'viewer',
      );
      await f.api(
        '/members/' + downgraded.id + '/role',
        'PATCH',
        {
          role: 'owner',
          expectedRevision: downgraded.revision,
          ...f.command(),
        },
        remaining.name.endsWith('_owner2') ? 'owner2' : 'owner',
      );
    });
    await test('G05 G06 capabilities require review and enablement, binding revision and tenant isolation', async () => {
      const input = {
        name: f.runId + '_tool',
        type: 'MCP',
        endpoint: 'synthetic://read-only',
        src: 'synthetic',
        ver: '1',
        desc: '合成能力，登记不执行',
        ...f.command(),
      };
      let cap = (await f.api('/caps', 'POST', input, 'owner', 201)).cap;
      assert.equal(cap.pending, true);
      assert.equal(cap.enabled, false);
      await f.api(
        '/caps/' + cap.id + '/toggle',
        'PATCH',
        { enabled: true, expectedRevision: cap.revision, ...f.command() },
        'owner',
        409,
      );
      cap = (
        await f.api('/caps/' + cap.id + '/review', 'POST', {
          expectedRevision: cap.revision,
          ...f.command(),
        })
      ).cap;
      assert.equal(cap.enabled, false);
      cap = (
        await f.api('/caps/' + cap.id + '/toggle', 'PATCH', {
          enabled: true,
          expectedRevision: cap.revision,
          ...f.command(),
        })
      ).cap;
      await f.api('/caps', 'POST', { ...input, ...f.command() }, 'owner', 409);
      await f.api(
        '/caps',
        'POST',
        {
          ...input,
          name: f.runId + '_bad',
          endpoint: 'https://user:password@invalid.example',
          ...f.command(),
        },
        'owner',
        400,
      );
      await f.api(
        '/caps',
        'POST',
        { ...input, name: f.runId + '_forbidden', ...f.command() },
        'executor',
        403,
      );
      const binding = (await f.api('/bindings')).items.find(
        (x) => x.stage === 'dev',
      );
      const saved = await f.api('/bindings', 'PUT', {
        stage: 'dev',
        capIds: [cap.id],
        expectedRevision: binding.revision,
        ...f.command(),
      });
      assert.deepEqual(saved.binding.capIds, [cap.id]);
      await f.api(
        '/bindings',
        'PUT',
        {
          stage: 'dev',
          capIds: [],
          expectedRevision: binding.revision,
          ...f.command(),
        },
        'owner',
        409,
      );
      await f.api(
        '/bindings',
        'PUT',
        { stage: 'dev', capIds: [cap.id], expectedRevision: 0, ...f.command() },
        'other',
        404,
      );
      assert.equal((await f.api('/caps', 'GET', undefined, 'other')).total, 0);
    });
    await test('G08 G09 project metadata, tenant boundary and immutable knowledge references', async () => {
      const project = (
        await f.api(
          '/projects',
          'POST',
          {
            name: f.runId + '_project',
            path: 'synthetic://workspace',
            repo: '',
            branch: 'main',
            tech: ['Node', 'Node'],
            source: 'existing',
            ...f.command(),
          },
          'executor',
          201,
        )
      ).project;
      assert.deepEqual(project.tech, ['Node']);
      assert.equal(project.scanned, false);
      await f.api('/projects/' + project.id, 'GET', undefined, 'other', 404);
      for (let i = 0; i < 4; i++)
        await f.api(
          '/knowledge',
          'POST',
          {
            title: f.runId + '_guidance_' + i,
            type: '接口契约',
            content: '<script>synthetic only</script>',
            tags: ['续期'],
            ...f.command(),
          },
          'executor',
          201,
        );
      const req = (
        await f.api(
          '/reqs',
          'POST',
          {
            name: f.runId + '_续期',
            goal: '合成知识匹配',
            projectId: project.id,
            ...f.command(),
          },
          'executor',
          201,
        )
      ).req;
      assert.equal(req.projectId, project.id);
      assert.equal(req.knowledgeRefs.length, 3);
      assert.ok(
        req.knowledgeRefs.every(
          (k) => k.version === 1 && k.reason.includes('续期'),
        ),
      );
      const refs = req.knowledgeRefs;
      await f.restart();
      assert.deepEqual(
        (await f.api('/reqs/' + req.id)).req.knowledgeRefs,
        refs,
      );
      assert.equal(
        (await f.api('/knowledge?q=' + encodeURIComponent('续期'))).total,
        4,
      );
      const empty = (
        await f.api(
          '/reqs',
          'POST',
          { name: f.runId + '_no_match', ...f.command() },
          'owner',
          201,
        )
      ).req;
      assert.deepEqual(empty.knowledgeRefs, []);
      await f.api(
        '/reqs',
        'POST',
        { name: f.runId + '_cross', projectId: project.id, ...f.command() },
        'other',
        404,
      );
      await f.api(
        '/knowledge',
        'POST',
        {
          title: f.runId,
          type: '接口契约',
          content: 'x'.repeat(32001),
          tags: [],
          ...f.command(),
        },
        'owner',
        400,
      );
      const other = (
        await f.api(
          '/projects',
          'POST',
          {
            name: f.runId + '_project2',
            path: 'synthetic://other',
            ...f.command(),
          },
          'owner',
          201,
        )
      ).project;
      const changed = await f.api('/reqs/' + req.id + '/project', 'PATCH', {
        projectId: other.id,
        expectedRevision: req.revision,
        ...f.command(),
      });
      assert.equal(changed.req.projectId, other.id);
      assert.ok(changed.req.versions.every((v) => v.stale));
      await f.api(
        '/reqs/' + req.id + '/project',
        'PATCH',
        {
          projectId: project.id,
          expectedRevision: req.revision,
          ...f.command(),
        },
        'owner',
        409,
      );
    });
    await test('G10 G11 bounded audit export and budget has no invented usage', async () => {
      const audit = await f.api('/audit?action=cap.created');
      assert.equal(audit.total, 1);
      const response = await fetch(
        f.baseUrl + '/api/audit/export?action=cap.created',
        { headers: { Authorization: 'Bearer ' + f.tokens.owner } },
      );
      assert.equal(response.status, 200);
      const csv = await response.text();
      assert.ok(csv.includes('cap.created'));
      assert.equal(response.headers.get('x-export-count'), '1');
      assert.equal((await f.api('/audit?action=audit.export')).total, 1);
      await f.api('/audit/export', 'GET', undefined, 'executor', 403);
      await f.api('/audit', 'GET', undefined, 'viewer', 403);
      await f.api('/audit?limit=101', 'GET', undefined, 'owner', 400);
      const budget = (await f.api('/budgets/me')).budget;
      assert.equal(budget.configured, false);
      assert.equal(budget.used, null);
      assert.equal(budget.remaining, null);
      await f.db.pool.query(
        `INSERT INTO "${f.schema}".budget_accounts(tenant_id,period,quota,used,source) VALUES($1,$2,100,30,'synthetic-test')`,
        [f.users[0].tenantId, budget.period],
      );
      const configured = (await f.api('/budgets/me')).budget;
      assert.equal(configured.remaining, 70);
      assert.equal(configured.source, 'synthetic-test');
    });
    await test('G07 G14 G15 immutable plan, configuration changes, approver revocation and project guard', async () => {
      const project = (await f.api('/projects')).items[0];
      const req = await f.readyRequirement({
        name: f.runId + '_续期_plan',
        projectId: project.id,
      });
      let plan = await f.api(
        '/runs',
        'POST',
        {
          reqId: req.id,
          plan: 'CODEx_TEST_模拟计划',
          expectedRevision: req.revision,
          ...f.command(),
        },
        'owner',
        201,
      );
      assert.equal(plan.plan.snapshotVersion, 2);
      const snapshot = plan.plan.contextSnapshot;
      assert.equal(snapshot.project.id, project.id);
      assert.equal(snapshot.artifacts.length, 3);
      assert.equal(snapshot.knowledgeRefs.length, 3);
      assert.equal(snapshot.capabilities.effectiveCaps.length, 1);
      assert.equal(plan.plan.contextFingerprint, snapshot.fingerprint);
      const binding = (await f.api('/bindings')).items.find(
        (b) => b.stage === 'dev',
      );
      await f.api('/bindings', 'PUT', {
        stage: 'dev',
        capIds: [],
        expectedRevision: binding.revision,
        ...f.command(),
      });
      const changed = await f.api('/reqs/' + req.id + '/cap-overrides', 'PUT', {
        stage: 'dev',
        overrides: [],
        expectedRevision: req.revision,
        ...f.command(),
      });
      assert.deepEqual(changed.effectiveCaps, []);
      assert.deepEqual(
        (await f.api('/runs/' + plan.run.id)).plan.contextSnapshot,
        snapshot,
      );
      const second = (await f.api('/projects')).items[1];
      assert.equal(
        (
          await f.api(
            '/reqs/' + req.id + '/project',
            'PATCH',
            {
              projectId: second.id,
              expectedRevision: changed.revision,
              ...f.command(),
            },
            'owner',
            409,
          )
        ).error.code,
        'PROJECT_HAS_ACTIVE_RUN',
      );
      let approved = await f.api(
        '/runs/' + plan.run.id + '/plan-approve',
        'POST',
        { expectedRevision: plan.run.revision, ...f.command() },
        'executor',
      );
      plan = await f.api('/runs/' + plan.run.id);
      assert.ok(plan.plan.approvedMemberId.startsWith('MEM-'));
      assert.equal(plan.plan.approvedContextFingerprint, snapshot.fingerprint);
      const cap = (await f.api('/caps')).items[0];
      const disabled = (
        await f.api('/caps/' + cap.id + '/toggle', 'PATCH', {
          enabled: false,
          expectedRevision: cap.revision,
          ...f.command(),
        })
      ).cap;
      assert.equal(
        (
          await f.api(
            '/runs/' + plan.run.id + '/start',
            'POST',
            { expectedRevision: approved.run.revision, ...f.command() },
            'owner',
            409,
          )
        ).error.code,
        'CAP_DISABLED',
      );
      await f.api('/caps/' + cap.id + '/toggle', 'PATCH', {
        enabled: true,
        expectedRevision: disabled.revision,
        ...f.command(),
      });
      const exec = (await f.api('/members')).items.find(
        (m) => m.name === f.runId + '_executor',
      );
      const demoted = (
        await f.api('/members/' + exec.id + '/role', 'PATCH', {
          role: 'viewer',
          expectedRevision: exec.revision,
          ...f.command(),
        })
      ).member;
      assert.equal(
        (
          await f.api(
            '/runs/' + plan.run.id + '/start',
            'POST',
            { expectedRevision: approved.run.revision, ...f.command() },
            'owner',
            409,
          )
        ).error.code,
        'APPROVER_PERMISSION_REVOKED',
      );
      await f.api('/members/' + exec.id + '/role', 'PATCH', {
        role: 'executor',
        expectedRevision: demoted.revision,
        ...f.command(),
      });
      await f.restart();
      assert.deepEqual(
        (await f.api('/runs/' + plan.run.id)).plan.contextSnapshot,
        snapshot,
      );
      await f.api('/runs/' + plan.run.id + '/start', 'POST', {
        expectedRevision: approved.run.revision,
        ...f.command(),
      });
      const until = Date.now() + 4000;
      let finished;
      do {
        finished = await f.api('/runs/' + plan.run.id);
        if (finished.run.status === 'SUCCEEDED') break;
        await new Promise((r) => setTimeout(r, 40));
      } while (Date.now() < until);
      assert.equal(finished.run.status, 'SUCCEEDED');
      assert.deepEqual(finished.plan.contextSnapshot, snapshot);
      const stored = (
        await f.db.pool.query(
          `SELECT context_snapshot,approved_context_fingerprint FROM "${f.schema}".run_plans WHERE public_id=$1`,
          [plan.plan.id],
        )
      ).rows[0];
      assert.deepEqual(stored.context_snapshot, snapshot);
      assert.equal(stored.approved_context_fingerprint, snapshot.fingerprint);
      const current = (await f.api('/reqs/' + req.id)).req;
      const rebound = (
        await f.api('/reqs/' + req.id + '/project', 'PATCH', {
          projectId: second.id,
          expectedRevision: current.revision,
          ...f.command(),
        })
      ).req;
      assert.ok(rebound.versions.every((v) => v.stale));
    });
    await test('G03 G04 controlled internal results survive revocation and UNKNOWN retains project guard', async () => {
      const { WebSocket } = require('ws'),
        { once } = await import('node:events');
      const pair = await f.api('/bridges/pair', 'POST', {
        name: f.runId + '_controlled',
        simulated: true,
      });
      const socket = new WebSocket(
          f.baseUrl.replace('http:', 'ws:') +
            '/ws/bridge?token=' +
            encodeURIComponent(pair.bridgeToken),
        ),
        received = [];
      socket.on('message', (bytes) => received.push(JSON.parse(String(bytes))));
      const wait = async (fn) => {
        const until = Date.now() + 4000;
        while (Date.now() < until) {
          if (await fn()) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        throw Error('CONTROLLED_EVENT_TIMEOUT');
      };
      try {
        await once(socket, 'open');
        socket.send(JSON.stringify({ type: 'bridge.hello', simulated: true }));
        await wait(async () =>
          (await f.api('/bridges')).items.some(
            (b) => b.id === pair.bridgeId && b.status === 'ONLINE',
          ),
        );
        const project = (await f.api('/projects')).items[0],
          other = (await f.api('/projects')).items[1];
        const req = await f.readyRequirement({ projectId: project.id });
        const start = async () => {
          let run = (
            await f.api(
              '/runs',
              'POST',
              { reqId: req.id, expectedRevision: req.revision, ...f.command() },
              'executor',
              201,
            )
          ).run;
          run = (
            await f.api(
              '/runs/' + run.id + '/plan-approve',
              'POST',
              { expectedRevision: run.revision, ...f.command() },
              'executor',
            )
          ).run;
          return (
            await f.api(
              '/runs/' + run.id + '/start',
              'POST',
              { expectedRevision: run.revision, ...f.command() },
              'executor',
            )
          ).run;
        };
        const run = await start();
        await wait(() =>
          received.some((m) => m.type === 'job.start' && m.runId === run.id),
        );
        const exec = (await f.api('/members')).items.find(
          (m) => m.name === f.runId + '_executor',
        );
        const down = (
          await f.api('/members/' + exec.id + '/role', 'PATCH', {
            role: 'viewer',
            expectedRevision: exec.revision,
            ...f.command(),
          })
        ).member;
        await f.api(
          '/runs/' + run.id + '/cancel',
          'POST',
          { expectedRevision: run.revision, ...f.command() },
          'executor',
          403,
        );
        const done = {
          type: 'job.done',
          runId: run.id,
          dispatchId: run.dispatchId,
          seq: 1,
          eventId: f.runId + '_internal_done',
          exitCode: 0,
        };
        socket.send(JSON.stringify(done));
        await wait(
          async () =>
            (await f.api('/runs/' + run.id)).run.status === 'SUCCEEDED',
        );
        socket.send(JSON.stringify(done));
        assert.equal((await f.api('/audit?action=run.succeeded')).total, 2);
        await f.api('/members/' + exec.id + '/role', 'PATCH', {
          role: 'executor',
          expectedRevision: down.revision,
          ...f.command(),
        });
        const running = await start();
        await wait(() =>
          received.some(
            (m) => m.type === 'job.start' && m.runId === running.id,
          ),
        );
        const rebind = () =>
          f.api(
            '/reqs/' + req.id + '/project',
            'PATCH',
            {
              projectId: other.id,
              expectedRevision: req.revision,
              ...f.command(),
            },
            'owner',
            409,
          );
        assert.equal((await rebind()).error.code, 'PROJECT_HAS_ACTIVE_RUN');
        const cancelling = (
          await f.api('/runs/' + running.id + '/cancel', 'POST', {
            expectedRevision: running.revision,
            ...f.command(),
          })
        ).run;
        assert.equal(cancelling.status, 'CANCELLING');
        assert.equal((await rebind()).error.code, 'PROJECT_HAS_ACTIVE_RUN');
        socket.close();
        await wait(
          async () =>
            (await f.api('/runs/' + running.id)).run.status === 'UNKNOWN',
        );
        assert.equal((await rebind()).error.code, 'PROJECT_HAS_ACTIVE_RUN');
        const unknown = await f.api(
          '/runs/' + running.id + '/verify',
          'POST',
          {},
        );
        assert.equal(unknown.run.id, running.id);
        assert.equal(unknown.run.status, 'UNKNOWN');
      } finally {
        socket.terminate();
      }
    });
    await test('G14 legacy waiting plans and oversized snapshots reject atomically', async () => {
      const req = await f.readyRequirement();
      const old = await f.api(
        '/runs',
        'POST',
        { reqId: req.id, expectedRevision: req.revision, ...f.command() },
        'owner',
        201,
      );
      await f.db.pool.query(
        `UPDATE "${f.schema}".run_plans SET snapshot_version=NULL,context_snapshot=NULL,context_fingerprint=NULL WHERE public_id=$1`,
        [old.plan.id],
      );
      assert.equal(
        (
          await f.api(
            '/runs/' + old.run.id + '/plan-approve',
            'POST',
            { expectedRevision: old.run.revision, ...f.command() },
            'owner',
            409,
          )
        ).error.code,
        'STALE_PLAN',
      );
      await f.api('/runs/' + old.run.id + '/cancel', 'POST', {
        expectedRevision: old.run.revision,
        ...f.command(),
      });
      const ids = [];
      for (let i = 0; i < 50; i++) {
        let c = (
          await f.api(
            '/caps',
            'POST',
            {
              name: f.runId + '_large_' + i,
              type: 'Skill',
              ver: '1',
              endpoint: 'synthetic://large',
              desc: '合'.repeat(4000),
              ...f.command(),
            },
            'owner',
            201,
          )
        ).cap;
        c = (
          await f.api('/caps/' + c.id + '/review', 'POST', {
            expectedRevision: c.revision,
            ...f.command(),
          })
        ).cap;
        c = (
          await f.api('/caps/' + c.id + '/toggle', 'PATCH', {
            enabled: true,
            expectedRevision: c.revision,
            ...f.command(),
          })
        ).cap;
        ids.push(c.id);
      }
      const b = (await f.api('/bindings')).items.find((b) => b.stage === 'dev');
      await f.api('/bindings', 'PUT', {
        stage: 'dev',
        capIds: ids,
        expectedRevision: b.revision,
        ...f.command(),
      });
      const before = await f.db.pool.query(
        `SELECT (SELECT count(*) FROM "${f.schema}".runs) runs,(SELECT count(*) FROM "${f.schema}".run_plans) plans,(SELECT count(*) FROM "${f.schema}".audit_logs WHERE action='run.created') audit`,
      );
      const result = await f.api(
        '/runs',
        'POST',
        { reqId: req.id, expectedRevision: req.revision, ...f.command() },
        'owner',
        409,
      );
      assert.equal(result.error.code, 'CONTEXT_LIMIT_EXCEEDED');
      const after = await f.db.pool.query(
        `SELECT (SELECT count(*) FROM "${f.schema}".runs) runs,(SELECT count(*) FROM "${f.schema}".run_plans) plans,(SELECT count(*) FROM "${f.schema}".audit_logs WHERE action='run.created') audit`,
      );
      assert.deepEqual(after.rows, before.rows);
      await f.api(
        '/bindings',
        'PUT',
        {
          stage: 'dev',
          capIds: Array.from({ length: 101 }, (_, i) => 'CP-' + i),
          expectedRevision: b.revision + 1,
          ...f.command(),
        },
        'owner',
        400,
      );
    });
  } catch (e) {
    results.push({
      name: 'PG fixture / readiness',
      status: 'FAIL',
      code: e.code || e.message,
    });
  } finally {
    if (f) cleanup = await f.cleanup();
  }
}
const report = {
  status: results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL',
  phase: process.argv.includes('--unit') ? 'unit' : 'integration',
  results,
  cleanup,
  data: 'deterministic local fixtures only',
};
const out = 'docs/quality-gate/reports/r2-artifacts-20260913/governance';
mkdirSync(out, { recursive: true });
writeFileSync(
  out + '/' + report.phase + '-' + Date.now() + '.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      ...report,
      cleanup: cleanup
        ? {
            schema: cleanup.schema,
            remaining: cleanup.remaining,
            totalRows: cleanup.totalRows,
            filesRemaining: cleanup.filesRemaining,
            processesRemaining: cleanup.processesRemaining,
            externalSchemaMetadataUnchanged:
              cleanup.externalSchemaMetadataUnchanged,
          }
        : undefined,
    },
    null,
    2,
  ),
);
if (report.status !== 'PASS') process.exitCode = 1;
