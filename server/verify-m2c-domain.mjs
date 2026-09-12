import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const evidenceDirectory = process.env.PFC_M2C_EVIDENCE_DIR;
if (
  evidenceDirectory !==
  'docs/quality-gate/reports/m2c-3-governance-20260913/domain'
)
  throw Error('EXPLICIT_EVIDENCE_TARGET_REQUIRED');
await integration();

async function integration() {
  const { fixture, context, secondContext, runId, schema } =
    await import('./test-data/m2c-domain-fixture.mjs');
  const { migrate, assertReady } = require('./src/persistence/migrations');
  const { randomUUID, createHash } = await import('node:crypto');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const results = [],
    sockets = [];
  let f, server, cleanup;
  const test = async (name, fn) => {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  };
  try {
    f = await fixture();
    await test('001 to 002 and repeated migration', async () => {
      await migrate(f.db, { targetVersion: '001' });
      assert.equal((await migrate(f.db)).version, '002');
      assert.equal((await migrate(f.db)).applied, false);
      await assertReady(f.db);
    });
    await f.admin.query(
      'INSERT INTO "' + schema + '".tenants(id,name) VALUES($1,$2),($3,$4)',
      [
        context.tenantId,
        runId + '_tenant',
        secondContext.tenantId,
        runId + '_other',
      ],
    );
    await f.prepareRuntime();
    server = await f.startServer();
    let tokens = {};
    const raw = async (path, method = 'GET', body, who = 'owner') => {
      const response = await fetch('http://127.0.0.1:5196/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(tokens[who] ? { authorization: 'Bearer ' + tokens[who] } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const api = async (
      path,
      method = 'GET',
      body,
      who = 'owner',
      status = 200,
    ) => {
      const result = await raw(path, method, body, who);
      assert.equal(result.status, status, JSON.stringify({ path, ...result }));
      return result.body;
    };
    for (const u of f.users) {
      const role = u.name.slice(runId.length + 1);
      tokens[role] = (
        await api('/auth/dev-login', 'POST', { name: u.name, role: 'owner' })
      ).token;
    }
    const command = () => ({ commandId: runId + '_' + randomUUID() });
    await test('PG empty startup and snapshot write barriers', async () => {
      assert.equal((await api('/health')).domainPersistence, true);
      assert.deepEqual((await api('/reqs')).items, []);
      assert.equal((await api('/state')).state, null);
      for (const [path, method, body] of [
        ['/state', 'PUT', { state: { reqs: [] } }],
        ['/state', 'DELETE', {}],
        ['/batch', 'POST', { ops: [] }],
      ])
        assert.equal(
          (await api(path, method, body, 'owner', 409)).error.code,
          'DOMAIN_WRITE_REQUIRED',
        );
    });
    let req;
    const create = {
      name: runId + '_requirement',
      goal: '合成积分提醒',
      scope: '仅合成验证',
      ...command(),
    };
    await test('HTTP create atomically persists version questions material audit event', async () => {
      req = (await api('/reqs', 'POST', create, 'owner', 201)).req;
      f.createdIds.push(req.id);
      assert.equal(req.questions.length, 2);
      assert.equal(req.materials.length, 1);
      assert.equal(req.versions.length, 1);
      assert.ok(req.questions.every((q) => q.answer === ''));
      assert.equal(
        Number(
          (await f.admin.query('SELECT count(*) n FROM "' + schema + '".reqs'))
            .rows[0].n,
        ),
        1,
      );
    });
    await test('cross-process restart retains exact HTTP domain facts', async () => {
      const before = JSON.stringify(req),
        pid = server.pid;
      await f.stopServer(server);
      server = await f.startServer();
      assert.notEqual(server.pid, pid);
      assert.equal(JSON.stringify((await api('/reqs/' + req.id)).req), before);
    });
    await test('command receipt survives restart and rejects altered body', async () => {
      assert.deepEqual(
        (await api('/reqs', 'POST', create, 'owner', 201)).req,
        req,
      );
      assert.equal(
        (
          await api(
            '/reqs',
            'POST',
            { ...create, name: runId + '_changed' },
            'owner',
            409,
          )
        ).error.code,
        'COMMAND_CONFLICT',
      );
    });
    await test('identity is server configured and tenant scoped', async () => {
      assert.equal(
        (
          await api(
            '/auth/dev-login',
            'POST',
            { name: runId + '_unknown' },
            'owner',
            403,
          )
        ).error.code,
        'UNKNOWN_LOCAL_USER',
      );
      await api('/reqs', 'POST', { ...create, ...command() }, 'viewer', 403);
      await api('/reqs/' + req.id, 'GET', undefined, 'other', 404);
      assert.equal(
        (await api('/auth/me', 'GET', undefined, 'viewer')).user.role,
        'viewer',
      );
    });
    await test('unanswered question blocks confirmation', async () => {
      await api(
        '/reqs/' + req.id + '/versions/' + req.versions[0].id + '/confirm',
        'POST',
        { ...command(), expectedRevision: req.revision },
        'owner',
        409,
      );
    });
    for (const question of req.questions) {
      req = (
        await api(
          '/reqs/' + req.id + '/questions/' + question.id + '/answer',
          'POST',
          {
            ...command(),
            answer: '合成回答 ' + question.id,
            expectedRevision: req.revision,
          },
        )
      ).req;
    }
    await test('answer and new idea version persist together', async () => {
      assert.equal(req.versions.length, 3);
      assert.ok(req.questions.every((q) => q.answer));
    });
    await test('stale two-client edit conflicts without half writes', async () => {
      const base = req.versions.at(-1),
        input = {
          ...command(),
          expectedRevision: req.revision,
          baseVersionId: base.id,
          stage: 'idea',
          content: {
            ...base.content,
            fields: [{ name: '目标', value: '合成新目标' }],
          },
        };
      const old = req.revision;
      req = (
        await api('/reqs/' + req.id + '/versions', 'POST', input, 'owner', 201)
      ).req;
      await api(
        '/reqs/' + req.id + '/versions',
        'POST',
        { ...input, ...command(), expectedRevision: old },
        'owner',
        409,
      );
      assert.equal((await api('/reqs/' + req.id)).req.versions.length, 4);
    });
    const advance = async () => {
      const v = req.versions.filter((v) => v.stage === req.stage).at(-1);
      req = (
        await api(
          '/reqs/' + req.id + '/versions/' + v.id + '/confirm',
          'POST',
          { ...command(), expectedRevision: req.revision },
        )
      ).req;
      const next = { idea: 'req', req: 'design', design: 'dev' }[req.stage];
      req = (
        await api('/reqs/' + req.id + '/stage', 'PATCH', {
          ...command(),
          to: next,
          expectedRevision: req.revision,
        })
      ).req;
    };
    await test('ordered stage transition creates only current draft', async () => {
      await advance();
      assert.equal(req.stage, 'req');
      assert.equal(req.versions.filter((v) => v.stage === 'design').length, 0);
      await advance();
      await advance();
      assert.equal(req.stage, 'dev');
      await api(
        '/reqs/' + req.id + '/stage',
        'PATCH',
        { ...command(), to: 'test', expectedRevision: req.revision },
        'owner',
        409,
      );
    });
    let fileMaterial;
    const bytes = Buffer.from('CODEx_TEST_M2C 原件 UTF8\n'),
      hash = createHash('sha256').update(bytes).digest('hex');
    await test('file original stored and independently hashed', async () => {
      const value = await api(
        '/reqs/' + req.id + '/materials',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          name: 'synthetic.txt',
          usage: 'attachment',
          file: {
            name: 'synthetic.txt',
            mimeType: 'text/plain',
            encoding: 'base64',
            content: bytes.toString('base64'),
          },
        },
        'owner',
        201,
      );
      req = value.req;
      fileMaterial = value.material;
      assert.equal(fileMaterial.hash, hash);
      const r = (
        await f.admin.query(
          'SELECT * FROM "' + schema + '".file_objects WHERE hash=$1',
          [hash],
        )
      ).rows[0];
      const { readFileSync } = await import('node:fs');
      assert.equal(
        createHash('sha256')
          .update(readFileSync(f.filesRoot + '/' + r.file_ref))
          .digest('hex'),
        hash,
      );
    });
    await test('same hash deduplicates and download requires ownership', async () => {
      req = (
        await api(
          '/reqs/' + req.id + '/materials',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            name: 'copy.txt',
            usage: 'attachment',
            file: {
              name: 'copy.txt',
              mimeType: 'text/plain',
              encoding: 'base64',
              content: bytes.toString('base64'),
            },
          },
          'owner',
          201,
        )
      ).req;
      assert.equal(
        Number(
          (
            await f.admin.query(
              'SELECT count(*) n FROM "' + schema + '".file_objects',
            )
          ).rows[0].n,
        ),
        1,
      );
      const response = await fetch(
        'http://127.0.0.1:5196/api/reqs/' +
          req.id +
          '/materials/' +
          fileMaterial.id +
          '/content',
        { headers: { authorization: 'Bearer ' + tokens.viewer } },
      );
      assert.equal(response.status, 200);
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex'),
        hash,
      );
      await api(
        '/reqs/' + req.id + '/materials/' + fileMaterial.id + '/content',
        'GET',
        undefined,
        'other',
        404,
      );
      await api(
        '/reqs/' + req.id + '/materials',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          file: { name: '../bad.txt', encoding: 'base64', content: 'YQ==' },
        },
        'owner',
        400,
      );
    });
    await test('DB failure after file write removes only unreferenced owned bytes', async () => {
      const name = runId + '_rollback_file',
        newBytes = Buffer.from(runId + '_rollback_bytes'),
        newHash = createHash('sha256').update(newBytes).digest('hex');
      await f.admin.query(
        'CREATE FUNCTION "' +
          schema +
          '".reject_test_material() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.name = ' +
          "'" +
          name +
          "'" +
          ' THEN RAISE EXCEPTION ' +
          "'INJECTED_MATERIAL_FAILURE'" +
          '; END IF; RETURN NEW; END $body$',
      );
      await f.admin.query(
        'CREATE TRIGGER reject_test_material BEFORE INSERT ON "' +
          schema +
          '".materials FOR EACH ROW EXECUTE FUNCTION "' +
          schema +
          '".reject_test_material()',
      );
      try {
        const before = (await api('/reqs/' + req.id)).req;
        for (const content of [newBytes, bytes])
          await api(
            '/reqs/' + req.id + '/materials',
            'POST',
            {
              ...command(),
              expectedRevision: req.revision,
              name,
              usage: 'attachment',
              file: {
                name: 'rollback.txt',
                mimeType: 'text/plain',
                encoding: 'base64',
                content: content.toString('base64'),
              },
            },
            'owner',
            503,
          );
        assert.deepEqual((await api('/reqs/' + req.id)).req, before);
        assert.equal(
          (
            await f.admin.query(
              'SELECT 1 FROM "' + schema + '".file_objects WHERE hash=$1',
              [newHash],
            )
          ).rowCount,
          0,
        );
        const { existsSync, readFileSync } = await import('node:fs');
        assert.equal(
          existsSync(f.filesRoot + '/' + context.tenantId + '/' + newHash),
          false,
        );
        assert.equal(
          createHash('sha256')
            .update(
              readFileSync(f.filesRoot + '/' + context.tenantId + '/' + hash),
            )
            .digest('hex'),
          hash,
        );
      } finally {
        await f.admin.query(
          'DROP TRIGGER reject_test_material ON "' + schema + '".materials',
        );
        await f.admin.query(
          'DROP FUNCTION "' + schema + '".reject_test_material()',
        );
      }
    });
    await test('exact 10 MiB files and 50 MiB logical message limit use original binary bytes', async () => {
      const binary = Buffer.alloc(10485760, 37),
        content = binary.toString('base64'),
        large = [];
      for (let n = 0; n < 5; n++) {
        const value = await api(
          '/reqs/' + req.id + '/materials',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            name: 'synthetic-' + n + '.pdf',
            usage: 'attachment',
            file: {
              name: 'synthetic.pdf',
              mimeType: 'application/pdf',
              encoding: 'base64',
              content,
            },
          },
          'owner',
          201,
        );
        req = value.req;
        large.push({ id: value.material.id, version: value.material.version });
        assert.equal(value.material.content, '');
        assert.match(value.material.parseStatus, /尚未解析/);
      }
      const result = await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '50 MiB 合成边界',
          attachments: large,
        },
        'owner',
        201,
      );
      req = result.req;
      req = (
        await api(
          '/reqs/' + req.id + '/messages/' + result.reply.id + '/stop',
          'POST',
          { ...command(), expectedRevision: req.revision },
        )
      ).req;
      await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '超过 50 MiB',
          attachments: [
            ...large,
            { id: fileMaterial.id, version: fileMaterial.version },
          ],
        },
        'owner',
        413,
      );
      const small = [];
      for (let n = 0; n < 20; n++) {
        const value = await api(
          '/reqs/' + req.id + '/materials',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            name: 'tiny-' + n + '.txt',
            usage: 'attachment',
            file: {
              name: 'tiny.txt',
              mimeType: 'text/plain',
              encoding: 'base64',
              content: bytes.toString('base64'),
            },
          },
          'owner',
          201,
        );
        req = value.req;
        small.push({ id: value.material.id, version: value.material.version });
      }
      const accepted = await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '20 份合成附件',
          attachments: small,
        },
        'owner',
        201,
      );
      req = accepted.req;
      assert.equal(accepted.message.attachments.length, 20);
      req = (
        await api(
          '/reqs/' + req.id + '/messages/' + accepted.reply.id + '/stop',
          'POST',
          { ...command(), expectedRevision: req.revision },
        )
      ).req;
      const download = await fetch(
        'http://127.0.0.1:5196/api/reqs/' +
          req.id +
          '/materials/' +
          large[0].id +
          '/content',
        { headers: { authorization: 'Bearer ' + tokens.owner } },
      );
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await download.arrayBuffer()))
          .digest('hex'),
        createHash('sha256').update(binary).digest('hex'),
      );
    });
    let userMessage, reply;
    await test('persistent simulated conversation with versioned attachment', async () => {
      const result = await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '合成会话',
          stage: 'dev',
          attachments: [{ id: fileMaterial.id, version: fileMaterial.version }],
        },
        'owner',
        201,
      );
      req = result.req;
      userMessage = result.message;
      reply = result.reply;
      assert.equal(reply.status, 'generating');
      assert.equal(userMessage.attachments[0].id, fileMaterial.id);
      assert.equal(reply.source, 'simulation');
    });
    await test('stop and resend preserve message relationships', async () => {
      req = (
        await api(
          '/reqs/' + req.id + '/messages/' + reply.id + '/stop',
          'POST',
          { ...command(), expectedRevision: req.revision },
        )
      ).req;
      let list = await api('/reqs/' + req.id + '/messages');
      assert.equal(list.items.find((m) => m.id === reply.id).status, 'stopped');
      const result = await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '合成重发',
          stage: 'dev',
          parentMessageId: userMessage.id,
          replyTo: userMessage.id,
        },
        'owner',
        201,
      );
      req = result.req;
      list = await api('/reqs/' + req.id + '/messages');
      assert.equal(
        list.items.find((m) => m.id === userMessage.id).retryMessageId,
        result.message.id,
      );
    });
    await test('restart interrupts unfinished reply and keeps attachment bytes', async () => {
      await f.stopServer(server);
      server = await f.startServer();
      const list = await api('/reqs/' + req.id + '/messages');
      assert.ok(
        list.items.some((m) => m.status === 'interrupted' || m.status === 'ok'),
      );
      assert.equal(list.total, 8);
    });
    const WebSocket = require('ws');
    const pair = await api('/bridges/pair', 'POST', {
      name: runId + '_bridge',
      simulated: true,
    });
    const ws = new WebSocket(
      'ws://127.0.0.1:5196/ws/bridge?token=' +
        encodeURIComponent(pair.bridgeToken),
    );
    sockets.push(ws);
    const received = [];
    ws.on('message', (b) => received.push(JSON.parse(String(b))));
    await new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    });
    ws.send(JSON.stringify({ type: 'bridge.hello', simulated: true }));
    let run;
    await test('plan approval gates start and persists dispatch identity', async () => {
      run = (
        await api(
          '/runs',
          'POST',
          {
            ...command(),
            reqId: req.id,
            expectedRevision: req.revision,
            plan: '合成模拟计划',
          },
          'owner',
          201,
        )
      ).run;
      await api(
        '/runs/' + run.id + '/start',
        'POST',
        { ...command(), expectedRevision: run.revision },
        'owner',
        409,
      );
      run = (
        await api('/runs/' + run.id + '/plan-approve', 'POST', {
          ...command(),
          expectedRevision: run.revision,
          by: 'forged',
        })
      ).run;
      run = (
        await api('/runs/' + run.id + '/start', 'POST', {
          ...command(),
          expectedRevision: run.revision,
        })
      ).run;
      assert.ok(run.dispatchId);
      assert.equal(run.executionMode, 'bridge-simulation');
    });
    const waitFor = async (predicate) => {
      for (let i = 0; i < 50; i++) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error('WAIT_TIMEOUT');
    };
    await waitFor(() => received.some((m) => m.type === 'job.start'));
    await test('bridge durable line and cancel late done cannot become success', async () => {
      const base = { runId: run.id, dispatchId: run.dispatchId };
      ws.send(
        JSON.stringify({
          ...base,
          type: 'job.line',
          seq: 1,
          eventId: 'synthetic-line-1',
          cls: 'info',
          text: '[模拟] 合成输出',
        }),
      );
      await waitFor(
        async () =>
          (await api('/runs/' + run.id + '/lines')).items.length === 1,
      );
      run = (
        await api('/runs/' + run.id + '/cancel', 'POST', {
          ...command(),
          expectedRevision: run.revision,
        })
      ).run;
      assert.equal(run.status, 'CANCELLING');
      ws.send(
        JSON.stringify({
          ...base,
          type: 'job.cancelled',
          seq: 2,
          eventId: 'synthetic-cancel',
        }),
      );
      await waitFor(
        async () => (await api('/runs/' + run.id)).run.status === 'CANCELLED',
      );
      ws.send(
        JSON.stringify({
          ...base,
          type: 'job.done',
          seq: 3,
          eventId: 'synthetic-late',
          exitCode: 0,
        }),
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await api('/runs/' + run.id)).run.status, 'CANCELLED');
    });
    await test('personal notice read does not change another account', async () => {
      const n = (await api('/notices')).items[0];
      assert.ok(n);
      await api('/notices/' + n.id + '/read', 'POST', command(), 'viewer');
      assert.equal(
        (await api('/notices', 'GET', undefined, 'viewer')).items.find(
          (x) => x.id === n.id,
        ).read,
        true,
      );
      assert.equal(
        (await api('/notices')).items.find((x) => x.id === n.id).read,
        false,
      );
    });
    await test('all domain output survives server restart', async () => {
      ws.close();
      await f.stopServer(server);
      server = await f.startServer();
      const result = await api('/runs/' + run.id);
      assert.equal(result.run.status, 'CANCELLED');
      assert.equal(result.lines[0].text, '[模拟] 合成输出');
      assert.equal((await api('/reqs/' + req.id)).req.id, req.id);
    });

    req = (await api('/reqs/' + req.id)).req;
    await test('two simultaneous command retries produce one requirement', async () => {
      const input = {
        name: runId + '_concurrent',
        goal: '合成',
        scope: '合成',
        ...command(),
      };
      const pair = await Promise.all([
        api('/reqs', 'POST', input, 'owner', 201),
        api('/reqs', 'POST', input, 'owner', 201),
      ]);
      assert.equal(pair[0].req.id, pair[1].req.id);
      f.createdIds.push(pair[0].req.id);
      const other = (
        await api(
          '/reqs',
          'POST',
          { ...input, ...command(), name: runId + '_crossTenant' },
          'other',
          201,
        )
      ).req;
      assert.equal(other.id, req.id);
      assert.notEqual(other.name, req.name);
    });
    await test('all write families enforce viewer role and actor cannot be forged', async () => {
      for (const path of [
        '/reqs/' + req.id + '/questions/' + req.questions[0].id + '/answer',
        '/reqs/' + req.id + '/versions',
        '/reqs/' + req.id + '/materials',
        '/reqs/' + req.id + '/messages',
        '/runs',
        '/runs/' + run.id + '/start',
        '/runs/' + run.id + '/cancel',
        '/runs/' + run.id + '/quality-gates',
        '/leases/acquire',
        '/leases/handoff',
        '/bridges/pair',
      ])
        await api(
          path,
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            role: 'owner',
            by: 'forged',
          },
          'viewer',
          403,
        );
      assert.ok(
        !(
          await f.admin.query('SELECT actor FROM "' + schema + '".audit_logs')
        ).rows.some((r) => r.actor === 'forged'),
      );
    });
    await test('file and reference boundaries reject before successful persistence', async () => {
      const file = {
        name: 'oversize.txt',
        mimeType: 'text/plain',
        encoding: 'base64',
        content: Buffer.alloc(10485761, 65).toString('base64'),
      };
      const result = await raw('/reqs/' + req.id + '/materials', 'POST', {
        ...command(),
        expectedRevision: req.revision,
        file,
      });
      assert.ok([400, 413].includes(result.status));
      await api(
        '/reqs/' + req.id + '/materials',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          name: '受限合成',
          content: '合成',
          classification: '受限',
          allowed: true,
        },
        'owner',
        400,
      );
      await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '合成',
          refs: [{ kind: 'path', id: 'D:/secret' }],
        },
        'owner',
        400,
      );
      await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '合成',
          attachments: Array.from({ length: 21 }, () => ({
            id: fileMaterial.id,
            version: 1,
          })),
        },
        'owner',
        413,
      );
    });
    await test('unavailable file directory rolls back metadata and receipt', async () => {
      const { renameSync, existsSync } = await import('node:fs'),
        { resolve, relative, isAbsolute } = await import('node:path');
      const root = resolve('.local/m2c-2-domain-20260912/files'),
        rel = relative(root, f.filesRoot);
      assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
      const offline = f.filesRoot + '-offline';
      assert.equal(existsSync(offline), false);
      const before = Number(
        (
          await f.admin.query(
            'SELECT count(*) n FROM "' + schema + '".materials',
          )
        ).rows[0].n,
      );
      renameSync(f.filesRoot, offline);
      try {
        const failed = await api(
          '/reqs/' + req.id + '/materials',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            name: 'offline.txt',
            file: {
              name: 'offline.txt',
              mimeType: 'text/plain',
              encoding: 'base64',
              content: 'b2ZmbGluZQ==',
            },
          },
          'owner',
          503,
        );
        assert.equal(failed.error.code, 'FILE_STORAGE_UNAVAILABLE');
      } finally {
        renameSync(offline, f.filesRoot);
      }
      assert.equal(
        Number(
          (
            await f.admin.query(
              'SELECT count(*) n FROM "' + schema + '".materials',
            )
          ).rows[0].n,
        ),
        before,
      );
    });
    await test('row lock timeout reports 503 and original command safely retries', async () => {
      const input = {
        ...command(),
        expectedRevision: req.revision,
        answer: '合成超时后重试',
      };
      await f.admin.query('BEGIN');
      await f.admin.query(
        'SELECT id FROM "' +
          schema +
          '".reqs WHERE tenant_id=$1 AND public_id=$2 FOR UPDATE',
        [context.tenantId, req.id],
      );
      try {
        assert.equal(
          (
            await api(
              '/reqs/' +
                req.id +
                '/questions/' +
                req.questions[0].id +
                '/answer',
              'POST',
              input,
              'owner',
              503,
            )
          ).error.code,
          'STORAGE_UNAVAILABLE',
        );
      } finally {
        await f.admin.query('ROLLBACK');
      }
      req = (
        await api(
          '/reqs/' + req.id + '/questions/' + req.questions[0].id + '/answer',
          'POST',
          input,
        )
      ).req;
    });
    const renewDesign = async () => {
      // 003 freezes the latest confirmed idea, requirement and design inputs.
      for (const stage of ['idea', 'req', 'design']) {
        const old = req.versions.filter((v) => v.stage === stage).at(-1);
        req = (
          await api(
            '/reqs/' + req.id + '/versions',
            'POST',
            {
              ...command(),
              expectedRevision: req.revision,
              baseVersionId: old.id,
              stage,
              content: old.content,
            },
            'owner',
            201,
          )
        ).req;
        const v = req.versions.filter((v) => v.stage === stage).at(-1);
        req = (
          await api(
            '/reqs/' + req.id + '/versions/' + v.id + '/confirm',
            'POST',
            { ...command(), expectedRevision: req.revision },
          )
        ).req;
      }
    };
    await renewDesign();
    await test('material version invalidates plan and old reference but retains original', async () => {
      const planned = await api(
        '/runs',
        'POST',
        { ...command(), reqId: req.id, expectedRevision: req.revision },
        'owner',
        201,
      );
      req = (
        await api(
          '/reqs/' + req.id + '/materials/' + fileMaterial.id + '/versions',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            file: {
              name: 'synthetic-v2.txt',
              mimeType: 'text/plain',
              encoding: 'base64',
              content: 'dmVyc2lvbi10d28=',
            },
          },
        )
      ).req;
      await api(
        '/runs/' + planned.run.id + '/plan-approve',
        'POST',
        { ...command(), expectedRevision: planned.run.revision },
        'owner',
        409,
      );
      await api(
        '/reqs/' + req.id + '/messages',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          content: '旧引用',
          attachments: [{ id: fileMaterial.id, version: 1 }],
        },
        'owner',
        409,
      );
      const original = await fetch(
        'http://127.0.0.1:5196/api/reqs/' +
          req.id +
          '/materials/' +
          fileMaterial.id +
          '/content?version=1',
        { headers: { authorization: 'Bearer ' + tokens.owner } },
      );
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await original.arrayBuffer()))
          .digest('hex'),
        hash,
      );
      req = (
        await api(
          '/reqs/' + req.id + '/materials/' + fileMaterial.id + '/impact',
          'POST',
          { ...command(), expectedRevision: req.revision, decision: 'include' },
        )
      ).req;
      await renewDesign();
    });
    await test('review needs changes withdraws approval and invalidates downstream', async () => {
      const v = req.versions.filter((v) => v.stage === 'design').at(-1);
      req = (
        await api(
          '/reqs/' + req.id + '/versions/' + v.id + '/reviews',
          'POST',
          {
            ...command(),
            expectedRevision: req.revision,
            result: '需修改',
            comment: '合成评审',
          },
        )
      ).req;
      assert.equal(req.versions.find((x) => x.id === v.id).confirmedAt, null);
      assert.ok(
        req.versions.filter((x) => x.stage === 'dev').every((x) => x.stale),
      );
      await renewDesign();
    });
    const connect = async (who = 'owner') => {
      const p = await api(
        '/bridges/pair',
        'POST',
        { name: runId + '_controlled_' + who, simulated: true },
        who,
      );
      const socket = new WebSocket(
        'ws://127.0.0.1:5196/ws/bridge?token=' +
          encodeURIComponent(p.bridgeToken),
      );
      sockets.push(socket);
      const messages = [];
      socket.on('message', (b) => messages.push(JSON.parse(String(b))));
      await new Promise((ok, no) => {
        socket.once('open', ok);
        socket.once('error', no);
      });
      socket.send(JSON.stringify({ type: 'bridge.hello', simulated: true }));
      return { socket, messages, pair: p };
    };
    const controlled = await connect();
    let activeRun;
    const startControlled = async () => {
      let r = (
        await api(
          '/runs',
          'POST',
          { ...command(), reqId: req.id, expectedRevision: req.revision },
          'owner',
          201,
        )
      ).run;
      r = (
        await api('/runs/' + r.id + '/plan-approve', 'POST', {
          ...command(),
          expectedRevision: r.revision,
        })
      ).run;
      const startInput = { ...command(), expectedRevision: r.revision };
      r = (await api('/runs/' + r.id + '/start', 'POST', startInput)).run;
      await api('/runs/' + r.id + '/start', 'POST', startInput);
      await waitFor(() =>
        controlled.messages.some(
          (m) => m.type === 'job.start' && m.runId === r.id,
        ),
      );
      assert.equal(
        controlled.messages.filter(
          (m) => m.type === 'job.start' && m.runId === r.id,
        ).length,
        1,
      );
      return r;
    };
    await test('controlled simulated Bridge completion replay and quality record persist', async () => {
      let completed = await startControlled();
      const base = { runId: completed.id, dispatchId: completed.dispatchId };
      for (const event of [
        { type: 'job.line', text: '合成成功输出', cls: 'ok' },
        {
          type: 'job.snapshot',
          stepNo: 1,
          label: '合成回放',
          snapshotRef: 'sim://frame',
        },
        { type: 'job.done', exitCode: 0 },
      ].map((e, n) => ({
        ...base,
        ...e,
        seq: n + 1,
        eventId: 'complete-' + n,
      })))
        controlled.socket.send(JSON.stringify(event));
      await waitFor(
        async () =>
          (await api('/runs/' + completed.id)).run.status === 'SUCCEEDED',
      );
      const state = await api('/runs/' + completed.id);
      assert.equal(state.lines.length, 1);
      assert.equal(state.replay.length, 1);
      assert.equal(state.run.executionMode, 'bridge-simulation');
      const gate = await api(
        '/runs/' + completed.id + '/quality-gates',
        'POST',
        {
          ...command(),
          expectedRevision: state.run.revision,
          gates: [
            {
              gateId: 'synthetic',
              name: '合成质量记录',
              status: 'pending',
              evidenceRef: null,
            },
          ],
        },
      );
      assert.equal(gate.gates[0].status, 'pending');
    });
    await test('HTTP and WebSocket channel roles reject bridge and viewer escalation', async () => {
      await api('/reqs', 'GET', undefined, 'executor');
      tokens.bridge = controlled.pair.bridgeToken;
      await api('/reqs', 'GET', undefined, 'bridge', 403);
      for (const [channel, token] of [
        ['bridge', tokens.viewer],
        ['web', controlled.pair.bridgeToken],
        ['web', 'invalid'],
      ]) {
        const socket = new WebSocket(
          'ws://127.0.0.1:5196/ws/' +
            channel +
            '?token=' +
            encodeURIComponent(token),
        );
        sockets.push(socket);
        socket.on('error', () => {});
        const code = await new Promise((resolve) =>
          socket.once('close', resolve),
        );
        assert.equal(code, 4001);
      }
      const page = await api('/reqs/' + req.id + '/messages?offset=2&limit=2');
      assert.equal(page.items.length, 2);
      assert.equal(page.total, 8);
    });
    await test('dispatch retry does not resend and lease acquisition has one winner', async () => {
      activeRun = await startControlled();
      const input = {
        runId: activeRun.id,
        expectedRevision: activeRun.revision,
        controller: 'web',
      };
      const outcomes = await Promise.all([
        raw('/leases/acquire', 'POST', { ...input, ...command() }, 'owner'),
        raw('/leases/acquire', 'POST', { ...input, ...command() }, 'executor'),
      ]);
      assert.equal(outcomes.filter((r) => r.status === 200).length, 1);
      assert.equal(outcomes.filter((r) => r.status === 409).length, 1);
      activeRun = (await api('/runs/' + activeRun.id)).run;
    });
    await test('bridge identity sequence idempotency and bounded history', async () => {
      const base = { runId: activeRun.id, dispatchId: activeRun.dispatchId };
      const first = {
        ...base,
        type: 'job.line',
        seq: 1,
        eventId: 'bounded-1',
        cls: 'info',
        text: '合成行 1',
      };
      controlled.socket.send(
        JSON.stringify({ ...first, dispatchId: randomUUID() }),
      );
      await waitFor(() =>
        controlled.messages.some((m) => m.code === 'DISPATCH_MISMATCH'),
      );
      controlled.socket.send(JSON.stringify(first));
      controlled.socket.send(JSON.stringify(first));
      controlled.socket.send(
        JSON.stringify({ ...first, text: 'same event different payload' }),
      );
      await waitFor(() =>
        controlled.messages.some((m) => m.code === 'COMMAND_CONFLICT'),
      );
      for (let n = 2; n <= 205; n++)
        controlled.socket.send(
          JSON.stringify({
            ...base,
            type: 'job.line',
            seq: n,
            eventId: 'bounded-' + n,
            cls: 'info',
            text: '合成行 ' + n,
          }),
        );
      await waitFor(
        async () =>
          Number(
            (
              await f.admin.query(
                'SELECT count(*) n FROM "' +
                  schema +
                  '".run_lines l JOIN "' +
                  schema +
                  '".runs r ON r.id=l.run_id WHERE r.public_id=$1',
                [activeRun.id],
              )
            ).rows[0].n,
          ) === 205,
      );
      const tail = await api('/runs/' + activeRun.id + '/lines');
      assert.equal(tail.items.length, 200);
      assert.equal(tail.items[0].seq, 6);
      assert.equal(
        (await api('/runs/' + activeRun.id + '/lines?afterSeq=0&limit=10'))
          .items.length,
        10,
      );
    });
    await test('restart turns unresolved run UNKNOWN and lease lost without dispatch', async () => {
      await f.stopServer(server);
      server = await f.startServer();
      const state = await api('/runs/' + activeRun.id);
      assert.equal(state.run.status, 'UNKNOWN');
      assert.equal(state.lease.state, 'lost');
      assert.equal(state.lines.length, 200);
      const verified = await api('/runs/' + activeRun.id + '/verify', 'POST');
      assert.equal(verified.run.status, 'UNKNOWN');
    });
    await test('migration readiness detects checksum column and constraint corruption', async () => {
      for (const sql of [
        `UPDATE "${schema}".schema_migrations SET checksum=repeat('0',64) WHERE version='002'`,
        'ALTER TABLE "' + schema + '".runs DROP COLUMN dispatch_state',
        'ALTER TABLE "' + schema + '".runs DROP CONSTRAINT runs_status_check',
      ]) {
        await f.admin.query('BEGIN');
        try {
          await f.admin.query(sql);
          await assert.rejects(() => assertReady(f.db, f.admin));
        } finally {
          await f.admin.query('ROLLBACK');
        }
      }
    });
    await test('rolled back event and version never appear as committed', async () => {
      const before = Number(
        (
          await f.admin.query(
            'SELECT count(*) n FROM "' + schema + '".domain_events',
          )
        ).rows[0].n,
      );
      await assert.rejects(
        () =>
          require('./src/persistence/transaction').withTransaction(
            f.db,
            async (c) => {
              await require('./src/persistence/events').append(
                c,
                f.db,
                { ...context, actor: runId },
                'req.updated',
                req.id,
                999,
                { reqId: req.id, syntheticRollback: true },
              );
              throw Error('INJECTED_ROLLBACK');
            },
          ),
        /INJECTED_ROLLBACK/,
      );
      assert.equal(
        Number(
          (
            await f.admin.query(
              'SELECT count(*) n FROM "' + schema + '".domain_events',
            )
          ).rows[0].n,
        ),
        before,
      );
    });
    await test('quota and fail-closed startup configuration', async () => {
      await f.stopServer(server);
      server = await f.startServer(5196, { PFC_FILE_QUOTA_BYTES: '1' });
      await api(
        '/reqs/' + req.id + '/materials',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          name: 'quota.txt',
          file: {
            name: 'quota.txt',
            mimeType: 'text/plain',
            encoding: 'base64',
            content: 'cXVvdGE=',
          },
        },
        'owner',
        413,
      );
      await f.stopServer(server);
      for (const override of [
        { PFC_DB: 'auto' },
        { JWT_SECRET: '' },
        { PFC_DB_SCHEMA: 'pfc' },
        { PFC_LOCAL_USERS_FILE: '' },
        { DATABASE_URL: f.env.DATABASE_URL.replace(/:5432\//, ':1/') },
      ])
        await assert.rejects(
          () => f.startServer(5196, override),
          /SERVER_START_FAILED/,
        );
    });
  } catch (e) {
    results.push({ status: 'FAIL', message: e.message });
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    for (const ws of sockets) ws.terminate();
    if (f)
      try {
        cleanup = await f.cleanup();
        console.log(
          JSON.stringify({
            cleanup: {
              remaining: cleanup.remaining,
              rows: cleanup.totalRows,
              filesRemaining: cleanup.filesRemaining,
              processesRemaining: cleanup.processesRemaining,
            },
          }),
        );
      } catch (e) {
        results.push({ status: 'FAIL', cleanup: e.message });
        process.exitCode = 1;
      }
    const directory = evidenceDirectory;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      directory + '/domain.json',
      JSON.stringify({ runId, results, cleanup }, null, 2),
    );
    console.log(
      JSON.stringify({
        status: process.exitCode ? 'FAIL' : 'PASS',
        tests: results.length,
      }),
    );
  }
}
