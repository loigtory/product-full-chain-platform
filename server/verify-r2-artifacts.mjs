import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  fixture,
  runId,
  schema,
  bundle,
  toRequirement,
  completeArtifacts,
} from './test-data/r2-artifact-fixture.mjs';
const require = createRequire(import.meta.url);
const report = { at: new Date().toISOString(), status: 'FAIL', results: [] };
let f;
async function test(name, fn) {
  const began = performance.now();
  await fn();
  report.results.push({
    name,
    status: 'PASS',
    durationMs: Math.round(performance.now() - began),
  });
  console.log('PASS ' + name);
}
try {
  f = await fixture({ start: false });
  const call = f.api;
  report.observations = [];
  f.api = async (...args) => {
    const began = performance.now(),
      result = await call(...args);
    if (
      /artifact-workspace$|\/adopt$/.test(args[0]) &&
      report.observations.length < 100
    )
      report.observations.push({
        path: args[0],
        method: args[1] || 'GET',
        durationMs: Math.round(performance.now() - began),
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
      });
    return result;
  };
  await test('A04 explicit004 migration and immutable history constraints', async () => {
    const r = require('./src/persistence/migrations').registry('004');
    assert.equal(r.length, 4);
    assert.equal(f.db.targetVersion, '006');
    await require('./src/persistence/migrations').assertReady(f.db);
    const rows = (
      await f.admin.query(
        'SELECT version FROM "' +
          schema +
          '".schema_migrations ORDER BY version',
      )
    ).rows;
    assert.deepEqual(
      rows.map((x) => x.version),
      ['001', '002', '003', '004', '005', '006'],
    );
  });
  await f.startRuntime();
  for (const who of ['owner', 'owner2', 'executor', 'viewer', 'other'])
    await f.login(who);
  await test('A01 partial candidate can be saved before questions but cannot be adopted', async () => {
    const req = (
      await f.api(
        '/reqs',
        'POST',
        {
          name: runId + '_partial',
          goal: 'CODEx_TEST_原型先行',
          ...f.command(),
        },
        'owner',
        201,
      )
    ).req;
    const w = await f.api('/reqs/' + req.id + '/artifact-workspace');
    const p = await f.api(
      '/reqs/' + req.id + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: { prototype: bundle().prototype },
        sourceRefs: [],
      },
      'owner',
      201,
    );
    assert.equal(p.proposal.state, 'INCOMPLETE');
    const rejected = await f.raw(
      '/reqs/' + req.id + '/artifact-proposals/' + p.proposal.id + '/adopt',
      'POST',
      {
        ...f.command(),
        expectedRevision: p.req.revision,
        baselineGroupId: null,
        inputFingerprint: p.proposal.inputFingerprint,
      },
    );
    assert.equal(rejected.status, 409);
    await f.restart();
    const recovered = await f.api(
      '/reqs/' + req.id + '/artifact-proposals/' + p.proposal.id,
    );
    assert.deepEqual(recovered.proposal.content, p.proposal.content);
    assert.equal(recovered.proposal.state, 'INCOMPLETE');
  });
  await test('A11 JSON original is parsed from persisted bytes and source hash is retained', async () => {
    const req = await toRequirement(f, 'json_import'),
      path = '/reqs/' + req.id,
      content = bundle('CODEx_TEST_JSON'),
      bytes = Buffer.from(JSON.stringify(content));
    const upload = await f.api(
      path + '/materials',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        name: 'CODEx_TEST_candidate.json',
        allowed: true,
        file: {
          name: 'CODEx_TEST_candidate.json',
          mimeType: 'application/json',
          encoding: 'base64',
          content: bytes.toString('base64'),
        },
      },
      'owner',
      201,
    );
    const w = await f.api(path + '/artifact-workspace');
    const p = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: upload.req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'import',
        sourceRefs: [{ kind: 'material', id: upload.material.id, version: 1 }],
      },
      'owner',
      201,
    );
    assert.deepEqual(p.proposal.content, content);
    assert.equal(
      p.proposal.source.files[0].hash,
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.equal(p.proposal.state, 'READY');
  });
  await test('A06 legacy PRD writes cannot bypass linked adoption', async () => {
    const req = await toRequirement(f, 'legacy'),
      v = req.versions.find((x) => x.stage === 'req');
    const r = await f.raw('/reqs/' + req.id + '/versions', 'POST', {
      stage: 'req',
      content: {
        title: 'CODEx_TEST_',
        fields: [{ name: '规则', value: '绕过关联' }],
      },
      baseVersionId: v.id,
      expectedRevision: req.revision,
      ...f.command(),
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'LINKED_WRITE_REQUIRED');
  });
  await test('A02/A06 independent versions, atomic confirmations and immutable history', async () => {
    let req = await toRequirement(f, 'linked');
    req = await completeArtifacts(f.api, req, f.command);
    const path = '/reqs/' + req.id;
    let w = await f.api(path + '/artifact-workspace');
    assert.equal(req.stage, 'dev');
    assert.ok(w.businessConfirmation);
    assert.ok(w.designConfirmation);
    const g1 = w.currentGroup,
      original = JSON.stringify(g1);
    const changed = structuredClone(bundle().acceptance);
    changed.items[0].expected = 'CODEx_TEST_显示名称必填';
    const p = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: g1.id,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: { acceptance: changed },
      },
      'owner',
      201,
    );
    const command = {
      ...f.command(),
      expectedRevision: p.req.revision,
      baselineGroupId: g1.id,
      inputFingerprint: p.proposal.inputFingerprint,
    };
    const result = await f.api(
      path + '/artifact-proposals/' + p.proposal.id + '/adopt',
      'POST',
      command,
    );
    const repeated = await f.api(
      path + '/artifact-proposals/' + p.proposal.id + '/adopt',
      'POST',
      command,
    );
    assert.equal(result.group.id, repeated.group.id);
    w = await f.api(path + '/artifact-workspace');
    assert.equal(w.currentGroup.prototype.id, g1.prototype.id);
    assert.equal(w.currentGroup.prd.id, g1.prd.id);
    assert.notEqual(w.currentGroup.acceptance.id, g1.acceptance.id);
    assert.equal(w.businessConfirmation, null);
    assert.equal(w.designConfirmation, null);
    assert.equal(result.req.stage, 'req');
    assert.equal(
      JSON.stringify((await f.api(path + '/artifact-groups/' + g1.id)).group),
      original,
    );
    await assert.rejects(
      f.admin.query(
        'UPDATE "' +
          schema +
          '".artifact_groups SET rules=rules WHERE public_id=$1',
        [g1.id],
      ),
      (e) => e.code === '23514',
    );
    const input = await f.api(path + '/stage-inputs?stage=dev');
    assert.equal(input.ready, false);
  });
  await test('A03 concurrent adoption and changed-payload replay never duplicate versions', async () => {
    let req = await toRequirement(f, 'race');
    const path = '/reqs/' + req.id,
      w = await f.api(path + '/artifact-workspace');
    const a = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: bundle(),
      },
      'owner',
      201,
    );
    const b = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: a.req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: bundle('CODEx_TEST_另一方案'),
      },
      'owner',
      201,
    );
    const command = {
      ...f.command(),
      expectedRevision: b.req.revision,
      baselineGroupId: null,
      inputFingerprint: w.inputFingerprint,
    };
    const raced = await Promise.all(
      [a, b].map((p) =>
        f.raw(
          path + '/artifact-proposals/' + p.proposal.id + '/adopt',
          'POST',
          command,
        ),
      ),
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await f.api(path + '/artifact-groups')).items.length, 1);
    const winner = [a, b][raced.findIndex((r) => r.status === 200)];
    const replay = await f.raw(
      path + '/artifact-proposals/' + winner.proposal.id + '/adopt',
      'POST',
      { ...command, expectedRevision: 999 },
    );
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'COMMAND_CONFLICT');
  });
  await test('A04 injected failures at version, group and event writes roll back everything', async () => {
    const req = await toRequirement(f, 'atomic'),
      path = '/reqs/' + req.id,
      w = await f.api(path + '/artifact-workspace');
    const p = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: bundle(),
      },
      'owner',
      201,
    );
    const snapshot = async () => {
      const output = {};
      for (const table of [
        'artifact_versions',
        'artifact_groups',
        'artifact_group_sources',
        'artifact_impacts',
        'req_versions',
        'audit_logs',
        'domain_events',
        'command_receipts',
      ])
        output[table] = (
          await f.admin.query(
            'SELECT count(*) n FROM "' + schema + '".' + table,
          )
        ).rows[0].n;
      output.req = (await f.api(path)).req;
      return output;
    };
    const before = await snapshot();
    await f.admin.query(
      'CREATE FUNCTION "' +
        schema +
        "\".r2_inject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CODEx_TEST_INJECTED'; END $$",
    );
    try {
      for (const table of [
        'artifact_versions',
        'artifact_groups',
        'domain_events',
      ]) {
        await f.admin.query(
          'CREATE TRIGGER r2_inject BEFORE INSERT ON "' +
            schema +
            '".' +
            table +
            ' FOR EACH ROW EXECUTE FUNCTION "' +
            schema +
            '".r2_inject()',
        );
        try {
          assert.equal(
            (
              await f.raw(
                path + '/artifact-proposals/' + p.proposal.id + '/adopt',
                'POST',
                {
                  ...f.command(),
                  expectedRevision: p.req.revision,
                  baselineGroupId: null,
                  inputFingerprint: w.inputFingerprint,
                },
              )
            ).status,
            503,
          );
          assert.deepEqual(await snapshot(), before);
        } finally {
          await f.admin.query(
            'DROP TRIGGER r2_inject ON "' + schema + '".' + table,
          );
        }
      }
    } finally {
      await f.admin.query('DROP FUNCTION "' + schema + '".r2_inject()');
    }
    assert.equal(
      (await f.api(path + '/artifact-proposals/' + p.proposal.id)).proposal
        .state,
      'READY',
    );
  });
  await test('A07 design-only updates preserve business, question changes invalidate both', async () => {
    let req = await completeArtifacts(
      f.api,
      await toRequirement(f, 'impact'),
      f.command,
    );
    const path = '/reqs/' + req.id,
      old = await f.api(path + '/artifact-workspace');
    const design = req.versions.filter((v) => v.stage === 'design').at(-1);
    req = (
      await f.api(
        path + '/versions',
        'POST',
        {
          ...f.command(),
          expectedRevision: req.revision,
          stage: 'design',
          baseVersionId: design.id,
          content: {
            ...design.content,
            fields: [
              { name: 'CODEx_TEST_设计', value: 'CODEx_TEST_仅设计修改' },
            ],
          },
        },
        'owner',
        201,
      )
    ).req;
    let w = await f.api(path + '/artifact-workspace');
    assert.equal(req.stage, 'design');
    assert.equal(w.businessConfirmation.id, old.businessConfirmation.id);
    assert.equal(w.designConfirmation, null);
    req = await completeArtifacts(f.api, req, f.command);
    req = (
      await f.api(
        path + '/questions/' + req.questions[0].id + '/answer',
        'POST',
        {
          ...f.command(),
          expectedRevision: req.revision,
          answer: 'CODEx_TEST_业务规则改变',
        },
      )
    ).req;
    w = await f.api(path + '/artifact-workspace');
    assert.equal(req.stage, 'req');
    assert.equal(w.businessConfirmation, null);
    assert.equal(w.designConfirmation, null);
    assert.ok(w.confirmations.some((c) => c.id === old.designConfirmation.id));
    assert.ok(w.impacts.length >= 3);
  });
  await test('A05/A11 import preserves original bytes, rejects forged source and revoked reads', async () => {
    let req = await toRequirement(f, 'files');
    const path = '/reqs/' + req.id,
      bytes = Buffer.from(
        '<script>parent.__unsafe=true;fetch("https://invalid.example")</script>CODEx_TEST_',
      );
    const uploaded = await f.api(
      path + '/materials',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        name: 'CODEx_TEST_original.html',
        allowed: true,
        usage: 'attachment',
        file: {
          name: 'CODEx_TEST_original.html',
          mimeType: 'text/html',
          encoding: 'base64',
          content: bytes.toString('base64'),
        },
      },
      'owner',
      201,
    );
    req = uploaded.req;
    const w = await f.api(path + '/artifact-workspace'),
      refs = [{ kind: 'attachment', id: uploaded.material.id, version: 1 }];
    const forged = await f.raw(path + '/artifact-proposals', 'POST', {
      ...f.command(),
      expectedRevision: req.revision,
      baseGroupId: null,
      inputFingerprint: w.inputFingerprint,
      inputMode: 'import',
      sourceRefs: refs,
      changes: bundle(),
    });
    assert.equal(forged.status, 400);
    const p = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'import',
        sourceRefs: refs,
      },
      'owner',
      201,
    );
    assert.equal(p.proposal.state, 'INCOMPLETE');
    assert.equal(p.proposal.content.prototype.representation, 'file');
    const response = await fetch(
      f.baseUrl +
        '/api' +
        path +
        '/materials/' +
        uploaded.material.id +
        '/content',
      { headers: { authorization: 'Bearer ' + f.tokens.owner } },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(
      p.proposal.source.files[0].hash,
      createHash('sha256').update(bytes).digest('hex'),
    );
    const { readFileSync, writeFileSync } = await import('node:fs'),
      { resolve, relative, isAbsolute } = await import('node:path');
    const tenant = (
      await f.admin.query(
        'SELECT tenant_id FROM "' + schema + '".reqs WHERE public_id=$1',
        [req.id],
      )
    ).rows[0].tenant_id;
    const filePath = resolve(
        f.filesRoot,
        tenant,
        p.proposal.source.files[0].hash,
      ),
      rel = relative(f.filesRoot, filePath);
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
    const original = readFileSync(filePath);
    try {
      writeFileSync(filePath, Buffer.from('CODEx_TEST_corrupt'));
      assert.equal(
        (await f.raw(path + '/materials/' + uploaded.material.id + '/content'))
          .status,
        503,
      );
      const corrupt = await f.raw(path + '/artifact-proposals', 'POST', {
        ...f.command(),
        expectedRevision: p.req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'import',
        sourceRefs: refs,
      });
      assert.equal(corrupt.status, 503);
    } finally {
      writeFileSync(filePath, original);
      assert.deepEqual(readFileSync(filePath), bytes);
    }
    const other = await toRequirement(f, 'otherreq');
    assert.equal(
      (
        await f.raw(
          '/reqs/' + other.id + '/artifact-proposals/' + p.proposal.id,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.raw(
          path + '/artifact-proposals/' + p.proposal.id,
          'GET',
          undefined,
          'other',
        )
      ).status,
      404,
    );
    await f.admin.query(
      'UPDATE "' +
        schema +
        '".materials SET allowed=false WHERE public_id=$1 AND req_id=(SELECT id FROM "' +
        schema +
        '".reqs WHERE public_id=$2)',
      [uploaded.material.id, req.id],
    );
    assert.equal(
      (await f.raw(path + '/materials/' + uploaded.material.id + '/content'))
        .status,
      403,
    );
    assert.equal(
      (
        await f.raw(path + '/artifact-proposals', 'POST', {
          ...f.command(),
          expectedRevision: p.req.revision,
          baseGroupId: null,
          inputFingerprint: (await f.api(path + '/artifact-workspace'))
            .inputFingerprint,
          inputMode: 'import',
          sourceRefs: refs,
        })
      ).status,
      409,
    );
  });
  await test('A08/A09 v2 survives restart; pending plans stale, active runs block adoption only', async () => {
    let req = await completeArtifacts(
      f.api,
      await toRequirement(f, 'plans'),
      f.command,
    );
    const path = '/reqs/' + req.id;
    const plan = await f.api(
      '/runs',
      'POST',
      { ...f.command(), reqId: req.id, expectedRevision: req.revision },
      'owner',
      201,
    );
    assert.equal(plan.plan.snapshotVersion, 2);
    assert.ok(plan.plan.contextSnapshot.linkedArtifacts.designConfirmationId);
    await f.restart();
    assert.deepEqual(
      (await f.api('/runs/' + plan.run.id)).plan.contextSnapshot,
      plan.plan.contextSnapshot,
    );
    req = (await f.api(path)).req;
    const w = await f.api(path + '/artifact-workspace'),
      ac = structuredClone(w.currentGroup.acceptance.content);
    ac.items[0].expected = 'CODEx_TEST_更新验收项';
    const p = await f.api(
      path + '/artifact-proposals',
      'POST',
      {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: w.currentGroup.id,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: { acceptance: ac },
      },
      'owner',
      201,
    );
    for (const status of ['RUNNING', 'UNKNOWN']) {
      await f.admin.query(
        'UPDATE "' + schema + '".runs SET status=$1 WHERE public_id=$2',
        [status, plan.run.id],
      );
      const r = await f.raw(
        path + '/artifact-proposals/' + p.proposal.id + '/adopt',
        'POST',
        {
          ...f.command(),
          expectedRevision: p.req.revision,
          baselineGroupId: w.currentGroup.id,
          inputFingerprint: p.proposal.inputFingerprint,
        },
      );
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'ACTIVE_RUN_BLOCKS_ADOPTION');
    }
    await f.admin.query(
      'UPDATE "' +
        schema +
        "\".runs SET status='WAITING_APPROVAL' WHERE public_id=$1",
      [plan.run.id],
    );
    await f.api(
      path + '/artifact-proposals/' + p.proposal.id + '/adopt',
      'POST',
      {
        ...f.command(),
        expectedRevision: p.req.revision,
        baselineGroupId: w.currentGroup.id,
        inputFingerprint: p.proposal.inputFingerprint,
      },
    );
    const stale = await f.raw(
      '/runs/' + plan.run.id + '/plan-approve',
      'POST',
      { ...f.command(), expectedRevision: plan.run.revision },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_PLAN');
    assert.deepEqual(
      (await f.api('/runs/' + plan.run.id)).plan.contextSnapshot,
      plan.plan.contextSnapshot,
    );
  });
  await test('A13 API roles and revoked identity cannot read or write/replay', async () => {
    const req = await toRequirement(f, 'roles'),
      path = '/reqs/' + req.id,
      w = await f.api(path + '/artifact-workspace'),
      input = {
        ...f.command(),
        expectedRevision: req.revision,
        baseGroupId: null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: bundle(),
      };
    assert.equal(
      (await f.raw(path + '/artifact-workspace', 'GET', undefined, 'viewer'))
        .status,
      200,
    );
    assert.equal(
      (await f.raw(path + '/artifact-proposals', 'POST', input, 'viewer'))
        .status,
      403,
    );
    const executor = await f.api(
      path + '/artifact-proposals',
      'POST',
      input,
      'executor',
      201,
    );
    assert.ok(executor.proposal.id);
    await f.admin.query(
      'UPDATE "' +
        schema +
        '".members SET active=false,disabled_at=now() WHERE name=$1',
      [runId + '_executor'],
    );
    assert.equal(
      (await f.raw(path + '/artifact-proposals', 'POST', input, 'executor'))
        .status,
      403,
    );
    await f.admin.query(
      'UPDATE "' +
        schema +
        '".members SET active=true,disabled_at=NULL WHERE name=$1',
      [runId + '_executor'],
    );
  });
  await test('A09 confirmation author revocation blocks approval without rewriting snapshot', async () => {
    const req = await completeArtifacts(
        f.api,
        await toRequirement(f, 'revokedconfirmer'),
        f.command,
      ),
      path = '/reqs/' + req.id;
    const plan = await f.api(
      '/runs',
      'POST',
      { ...f.command(), reqId: req.id, expectedRevision: req.revision },
      'owner',
      201,
    );
    await f.admin.query(
      'UPDATE "' + schema + "\".members SET role='viewer' WHERE name=$1",
      [runId + '_owner'],
    );
    try {
      const w = await f.api(
        path + '/artifact-workspace',
        'GET',
        undefined,
        'owner2',
      );
      assert.equal(w.businessConfirmation, null);
      assert.equal(w.designConfirmation, null);
      assert.equal(
        (
          await f.raw(
            '/runs/' + plan.run.id + '/plan-approve',
            'POST',
            { ...f.command(), expectedRevision: plan.run.revision },
            'owner2',
          )
        ).status,
        409,
      );
      assert.deepEqual(
        (await f.api('/runs/' + plan.run.id, 'GET', undefined, 'owner2')).plan
          .contextSnapshot,
        plan.plan.contextSnapshot,
      );
    } finally {
      await f.admin.query(
        'UPDATE "' + schema + "\".members SET role='owner' WHERE name=$1",
        [runId + '_owner'],
      );
    }
  });
  await test('A14 20 pending candidates accepted; 21st rejected without truncation', async () => {
    let req = await toRequirement(f, 'limits');
    const path = '/reqs/' + req.id,
      w = await f.api(path + '/artifact-workspace');
    for (let n = 0; n < 20; n++)
      req = (
        await f.api(
          path + '/artifact-proposals',
          'POST',
          {
            ...f.command(),
            expectedRevision: req.revision,
            baseGroupId: null,
            inputFingerprint: w.inputFingerprint,
            inputMode: 'manual',
            changes: { prototype: bundle().prototype },
          },
          'owner',
          201,
        )
      ).req;
    const r = await f.raw(path + '/artifact-proposals', 'POST', {
      ...f.command(),
      expectedRevision: req.revision,
      baseGroupId: null,
      inputFingerprint: w.inputFingerprint,
      inputMode: 'manual',
      changes: { prototype: bundle().prototype },
    });
    assert.equal(r.status, 413);
    assert.equal((await f.api(path + '/artifact-proposals')).items.length, 20);
  });
  report.status = 'PASS';
} catch (e) {
  report.error = { code: e.code, message: e.message };
  console.error(e.code || '', e.message);
} finally {
  if (f)
    try {
      report.cleanup = await f.cleanup();
    } catch (e) {
      report.status = 'FAIL';
      report.cleanupError = { code: e.code, message: e.message };
    }
  const out = 'docs/quality-gate/reports/local-use-baseline-20260913/artifacts';
  mkdirSync(out, { recursive: true });
  writeFileSync(
    out + '/integration-' + Date.now() + '.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    tests: report.results.length,
    error: report.error,
    cleanup: report.cleanup && {
      schema: report.cleanup.schema,
      remaining: report.cleanup.remaining,
      files: report.cleanup.filesRemaining,
      processes: report.cleanup.processesRemaining,
    },
  }),
);
if (report.status !== 'PASS') process.exitCode = 1;
