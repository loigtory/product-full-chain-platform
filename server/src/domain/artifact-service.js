'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  repo = require('../persistence/artifacts'),
  reqs = require('../persistence/requirements');
const { command, fingerprint } = require('../persistence/commands'),
  { allocateIdentifier } = require('../persistence/identifiers');
const dto = require('./artifact-dto'),
  policy = require('./artifact-policy'),
  impact = require('./artifact-impact-service');
async function read(id, work) {
  const ctx = access.current(),
    db = runtime.db();
  return require('./membership-policy').read(db, ctx, false, async (client) => {
    const req = (
      await client.query(
        `SELECT * FROM ${repo.table(db, 'reqs')} WHERE tenant_id=$1 AND public_id=$2`,
        [ctx.tenantId, id],
      )
    ).rows[0];
    if (!req) access.fail('NOT_FOUND', 404);
    return work(client, db, ctx, req);
  });
}
async function mutate(id, input, operation, work) {
  const ctx = access.current(true),
    db = runtime.db();
  return command(
    db,
    ctx,
    'artifact.' + operation + ':' + id,
    input,
    async (client) => {
      const req = await reqs.lock(client, db, ctx, id);
      access.revision(req, input.expectedRevision);
      const result = await work(client, db, ctx, req);
      const updated = await reqs.touch(
        client,
        db,
        ctx,
        req,
        'artifact.' + operation,
      );
      return {
        ...result,
        req: await require('./requirement-service').detail(
          client,
          db,
          ctx,
          updated,
        ),
      };
    },
  );
}
async function proposalRows(client, db, ctx, req, input = {}) {
  const { limit, offset } = access.page(input);
  return (
    await client.query(
      `SELECT p.*,b.public_id base_group_public_id,g.public_id result_group_public_id FROM ${repo.table(db, 'artifact_proposals')} p LEFT JOIN ${repo.table(db, 'artifact_groups')} b ON b.tenant_id=p.tenant_id AND b.id=p.base_group_id LEFT JOIN ${repo.table(db, 'artifact_groups')} g ON g.tenant_id=p.tenant_id AND g.id=p.result_group_id WHERE p.tenant_id=$1 AND p.req_id=$2 ORDER BY p.created_at DESC,p.public_id DESC LIMIT $3 OFFSET $4`,
      [ctx.tenantId, req.id, limit, offset],
    )
  ).rows;
}
async function showProposal(client, db, ctx, req, p) {
  const input = await repo.inputs(client, db, ctx, req, p.inputs.explicitRefs);
  return dto.proposal(p, req.current_artifact_group_id, input.fingerprint);
}
async function workspace(client, db, ctx, req) {
  const s = await impact.inspect(client, db, ctx, req);
  const history = (
    await client.query(
      `SELECT public_id id,reason,return_stage,detail,created_at FROM ${repo.table(db, 'artifact_impacts')} WHERE tenant_id=$1 AND req_id=$2 ORDER BY created_at DESC,public_id DESC LIMIT 20`,
      [ctx.tenantId, req.id],
    )
  ).rows;
  const proposals = [];
  for (const p of await proposalRows(client, db, ctx, req)) {
    const value = await showProposal(client, db, ctx, req, p);
    delete value.content;
    proposals.push(value);
  }
  return {
    reqId: req.public_id,
    revision: req.revision,
    currentGroup: dto.group(s.group),
    inputFingerprint: s.inputs.fingerprint,
    inputs: s.inputs.snapshot,
    blockers: s.blockers,
    questions: s.questions.map((q) => ({ id: q.public_id, text: q.q })),
    businessConfirmation: dto.confirmation(s.business),
    designConfirmation: dto.confirmation(s.design),
    confirmations: s.history.map(dto.confirmation),
    impacts: history,
    proposals,
    actions: {
      canEdit: ['owner', 'executor'].includes(ctx.role),
      canConfirmBusiness:
        req.stage === 'req' &&
        !!s.group &&
        !s.blockers.length &&
        !s.questions.length,
      canConfirmDesign: req.stage === 'design' && !!s.business,
      canPlan: req.stage === 'dev' && !!s.design,
    },
  };
}
const getWorkspace = (id) => read(id, workspace);
async function createProposal(id, input) {
  return mutate(id, input, 'proposal.created', async (client, db, ctx, req) => {
    if (
      !['idea', 'req', 'design', 'dev', 'test', 'accept', 'release'].includes(
        req.stage,
      )
    )
      access.fail('CAPABILITY_UNAVAILABLE');
    const g = await repo.group(client, db, ctx, req),
      current = await repo.inputs(
        client,
        db,
        ctx,
        req,
        g?.inputs.explicitRefs || [],
      );
    if (
      (input.baseGroupId ?? null) !== (g?.public_id || null) ||
      input.inputFingerprint !== current.fingerprint
    )
      access.fail('STALE_ARTIFACT_PROPOSAL');
    const prior = input.supersedesProposalId
      ? await repo.find(
          client,
          db,
          ctx,
          req.id,
          'artifact_proposals',
          input.supersedesProposalId,
        )
      : null;
    if (
      input.supersedesProposalId &&
      (!prior || !['INCOMPLETE', 'READY'].includes(prior.state))
    )
      access.fail('INVALID_PROPOSAL_STATE');
    if (
      Number(
        (
          await client.query(
            `SELECT count(*) n FROM ${repo.table(db, 'artifact_proposals')} WHERE tenant_id=$1 AND req_id=$2 AND state IN ('INCOMPLETE','READY')`,
            [ctx.tenantId, req.id],
          )
        ).rows[0].n,
      ) -
        (prior ? 1 : 0) >=
      20
    )
      access.fail('ARTIFACT_LIMIT_EXCEEDED', 413);
    let changes = input.changes || {},
      source = { kind: input.inputMode, memberId: ctx.memberPublicId };
    if (input.inputMode === 'template') {
      if (Object.keys(changes).length)
        access.fail('INVALID_ARTIFACT', 400, '模板模式只接受模板和参数');
      const spec = require('./prototype-spec').template(
        input.templateId,
        input.params || {},
      );
      changes = {
        prototype: { representation: 'spec', spec },
        prd: {
          title: spec.title + ' · PRD草稿',
          fields: [{ name: '业务规则', value: '请核对并完善本模板示例规则' }],
        },
        acceptance: {
          items: [
            {
              acId: 'AC1',
              ruleId: 'RULE1',
              scenario: '体验交互',
              precondition: '已打开候选',
              steps: ['按画布提示操作'],
              expected: '显示对应状态反馈，规则待人工核对',
            },
          ],
        },
        rules: [{ ruleId: 'RULE1', fieldIndex: 0 }],
      };
      source = {
        ...source,
        templateId: input.templateId,
        templateVersion: 1,
        paramsFingerprint: fingerprint(input.params || {}),
      };
    } else if (!['manual', 'import'].includes(input.inputMode))
      access.fail('INVALID_SOURCE', 400);
    if (input.inputMode === 'import') {
      if (
        Object.keys(changes).length ||
        !Array.isArray(input.sourceRefs) ||
        input.sourceRefs.length !== 1
      )
        access.fail(
          'INVALID_SOURCE',
          400,
          '导入模式请选择一个原件，不接受另填的导入内容',
        );
      const imported = await repo.inputs(
          client,
          db,
          ctx,
          req,
          input.sourceRefs,
        ),
        file = imported.snapshot.materials.find(
          (m) => m.id === input.sourceRefs[0].id,
        );
      if (imported.blockers.length || !file?.fileId)
        access.fail('STALE_REFERENCE');
      const bytes = await require('../files/local-files').read(
        ctx.tenantId,
        file.hash,
      );
      if (/\.json$/i.test(file.name)) {
        if (bytes.length > 524288) access.fail('ARTIFACT_LIMIT_EXCEEDED', 413);
        let parsed;
        try {
          parsed = JSON.parse(bytes.toString('utf8'));
        } catch {
          access.fail('INVALID_ARTIFACT', 400, 'JSON原件格式错误');
        }
        changes =
          parsed?.schemaVersion === 1
            ? { prototype: { representation: 'spec', spec: parsed } }
            : parsed;
      } else
        changes = {
          prototype: {
            representation: 'file',
            materialId: file.id,
            version: file.version,
          },
        };
    }
    policy.object(changes, ['prototype', 'prd', 'acceptance', 'rules']);
    const merged = { ...repo.content(g), ...changes };
    const validation = policy.validateBundle(merged);
    let refs =
      input.sourceRefs === undefined
        ? g?.inputs.explicitRefs || []
        : input.sourceRefs;
    if (!Array.isArray(refs)) access.fail('INVALID_REFERENCE', 400);
    if (
      merged.prototype?.representation === 'file' &&
      !refs.some((x) => x.id === merged.prototype.materialId)
    ) {
      const m = (
        await client.query(
          `SELECT usage FROM ${repo.table(db, 'materials')} WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3`,
          [ctx.tenantId, req.id, merged.prototype.materialId],
        )
      ).rows[0];
      if (!m) access.fail('STALE_REFERENCE');
      refs = [
        ...refs,
        {
          kind: m.usage,
          id: merged.prototype.materialId,
          version: merged.prototype.version,
        },
      ];
    }
    const inputs = await repo.inputs(client, db, ctx, req, refs);
    if (
      input.inputMode === 'import' &&
      !inputs.snapshot.materials.some(
        (m) => m.fileId && refs.some((r) => r.id === m.id),
      )
    )
      access.fail('INVALID_SOURCE', 400);
    if (merged.prototype?.representation === 'file') {
      const m = inputs.snapshot.materials.find(
        (x) => x.id === merged.prototype.materialId,
      );
      if (!m?.fileId || m.version !== merged.prototype.version)
        access.fail('INVALID_FILE_REFERENCE', 400);
    }
    if (input.inputMode === 'import') {
      source = {
        ...source,
        files: inputs.snapshot.materials
          .filter((m) => m.fileId && refs.some((r) => r.id === m.id))
          .map((m) => ({ id: m.id, version: m.version, hash: m.hash })),
      };
    }
    await repo.jsonSize(client, merged);
    const pid = await allocateIdentifier(
      client,
      db,
      ctx.tenantId,
      'artifact_proposals',
    );
    const p = (
      await client.query(
        `INSERT INTO ${repo.table(db, 'artifact_proposals')}(id,tenant_id,req_id,public_id,base_group_id,input_fingerprint,inputs,payload,source,state,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          pid.id,
          ctx.tenantId,
          req.id,
          pid.publicId,
          g?.id || null,
          inputs.fingerprint,
          JSON.stringify(inputs.snapshot),
          JSON.stringify(merged),
          JSON.stringify(source),
          validation.status,
          prior?.id || null,
          ctx.memberId,
        ],
      )
    ).rows[0];
    if (prior)
      await client.query(
        `UPDATE ${repo.table(db, 'artifact_proposals')} SET state='SUPERSEDED',handled_by=$1,handled_at=now(),reason=$2 WHERE tenant_id=$3 AND id=$4`,
        [ctx.memberId, '修订为 ' + p.public_id, ctx.tenantId, prior.id],
      );
    return {
      proposal: {
        ...dto.proposal(
          { ...p, base_group_public_id: g?.public_id },
          req.current_artifact_group_id,
          inputs.fingerprint,
        ),
        missing: validation.missing,
      },
    };
  });
}
async function adopt(id, pid, input) {
  return mutate(
    id,
    { ...input, _target: pid },
    'proposal.adopted',
    async (client, db, ctx, req) => {
      const p = await repo.find(
        client,
        db,
        ctx,
        req.id,
        'artifact_proposals',
        pid,
      );
      if (!p) access.fail('NOT_FOUND', 404);
      if (p.state !== 'READY')
        access.fail(
          p.state === 'INCOMPLETE'
            ? 'INCOMPLETE_ARTIFACT_GROUP'
            : 'INVALID_PROPOSAL_STATE',
        );
      const old = await repo.group(client, db, ctx, req),
        inputs = await repo.inputs(client, db, ctx, req, p.inputs.explicitRefs);
      if (
        p.base_group_id !== (old?.id || null) ||
        (input.baselineGroupId ?? null) !== (old?.public_id || null) ||
        p.input_fingerprint !== inputs.fingerprint ||
        input.inputFingerprint !== inputs.fingerprint
      )
        access.fail('STALE_ARTIFACT_PROPOSAL');
      if (inputs.blockers.length)
        access.fail('STALE_REFERENCE', 409, inputs.blockers.join('；'));
      if (
        (await repo.pendingRuns(client, db, ctx, req)).some(
          (r) => r.status !== 'WAITING_APPROVAL',
        )
      )
        access.fail(
          'ACTIVE_RUN_BLOCKS_ADOPTION',
          409,
          '先停止并核验当前运行；可以继续准备候选',
        );
      const checked = policy.validateBundle(p.payload);
      if (checked.missing.length) access.fail('INCOMPLETE_ARTIFACT_GROUP');
      await repo.verifyFiles(ctx, inputs.snapshot);
      const parts = {};
      for (const kind of ['prototype', 'acceptance'])
        parts[kind] =
          old && policy.same(old[kind].content, p.payload[kind])
            ? old[kind]
            : await repo.addVersion(
                client,
                db,
                ctx,
                req,
                kind,
                p.payload[kind],
                p.source,
                old?.[kind],
              );
      const latest = (await reqs.versions(client, db, ctx, req.id))
        .filter((v) => v.stage === 'req')
        .sort((a, b) => b.version - a.version)[0];
      parts.prd =
        old && policy.same(repo.content(old).prd, p.payload.prd)
          ? old.prd
          : await reqs.appendVersion(
              client,
              db,
              ctx,
              req,
              'req',
              p.payload.prd,
              latest?.id || null,
            );
      const g = await repo.addGroup(
        client,
        db,
        ctx,
        req,
        old,
        parts,
        inputs,
        p.payload.rules,
      );
      await impact.invalidate(
        client,
        db,
        ctx,
        req,
        '采纳关联成果 ' + g.public_id,
        'business',
        g.id,
      );
      await client.query(
        `UPDATE ${repo.table(db, 'artifact_proposals')} SET state='APPLIED',result_group_id=$1,handled_by=$2,handled_at=now() WHERE tenant_id=$3 AND id=$4`,
        [g.id, ctx.memberId, ctx.tenantId, p.id],
      );
      return { group: dto.group({ ...g, ...parts }) };
    },
  );
}
async function reject(id, pid, input) {
  return mutate(
    id,
    { ...input, _target: pid },
    'proposal.rejected',
    async (client, db, ctx, req) => {
      access.text(input.reason, 4000, true);
      const p = await repo.find(
        client,
        db,
        ctx,
        req.id,
        'artifact_proposals',
        pid,
      );
      if (!p) access.fail('NOT_FOUND', 404);
      if (!['READY', 'INCOMPLETE'].includes(p.state))
        access.fail('INVALID_PROPOSAL_STATE');
      const updated = (
        await client.query(
          `UPDATE ${repo.table(db, 'artifact_proposals')} SET state='REJECTED',reason=$1,handled_by=$2,handled_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING *`,
          [input.reason, ctx.memberId, ctx.tenantId, p.id],
        )
      ).rows[0];
      return { proposal: await showProposal(client, db, ctx, req, updated) };
    },
  );
}
async function listProposals(id, input) {
  return read(id, async (client, db, ctx, req) => {
    const items = [];
    for (const p of await proposalRows(client, db, ctx, req, input)) {
      const row = await showProposal(client, db, ctx, req, p);
      delete row.content;
      items.push(row);
    }
    return { items };
  });
}
async function getProposal(id, pid) {
  return read(id, async (client, db, ctx, req) => {
    const p = await repo.find(
      client,
      db,
      ctx,
      req.id,
      'artifact_proposals',
      pid,
    );
    if (!p) access.fail('NOT_FOUND', 404);
    const base = p.base_group_id
      ? (
          await client.query(
            `SELECT public_id FROM ${repo.table(db, 'artifact_groups')} WHERE tenant_id=$1 AND req_id=$2 AND id=$3`,
            [ctx.tenantId, req.id, p.base_group_id],
          )
        ).rows[0]
      : null;
    return {
      proposal: await showProposal(client, db, ctx, req, {
        ...p,
        base_group_public_id: base?.public_id,
      }),
      baseline: base
        ? dto.group(await repo.group(client, db, ctx, req, base.public_id))
        : null,
    };
  });
}
async function getGroup(id, gid) {
  return read(id, async (c, d, x, r) => {
    const g = await repo.group(c, d, x, r, gid);
    if (!g) access.fail('NOT_FOUND', 404);
    return { group: dto.group(g) };
  });
}
async function listGroups(id, input) {
  return read(id, async (c, d, x, r) => {
    const { limit, offset } = access.page(input);
    return {
      items: (
        await c.query(
          `SELECT public_id id,version,fingerprint,created_at FROM ${repo.table(d, 'artifact_groups')} WHERE tenant_id=$1 AND req_id=$2 ORDER BY version DESC LIMIT $3 OFFSET $4`,
          [x.tenantId, r.id, limit, offset],
        )
      ).rows,
    };
  });
}
async function getArtifact(id, vid) {
  return read(id, async (c, d, x, r) => {
    const v = await repo.find(c, d, x, r.id, 'artifact_versions', vid);
    if (!v) access.fail('NOT_FOUND', 404);
    if (v.content.representation === 'file') {
      const m = (
        await c.query(
          `SELECT usage FROM ${repo.table(d, 'materials')} WHERE tenant_id=$1 AND req_id=$2 AND public_id=$3`,
          [x.tenantId, r.id, v.content.materialId],
        )
      ).rows[0];
      if (!m) access.fail('STALE_REFERENCE');
      const s = await repo.inputs(c, d, x, r, [
        { kind: m.usage, id: v.content.materialId, version: v.content.version },
      ]);
      if (s.blockers.length) access.fail('STALE_REFERENCE');
      await repo.verifyFiles(x, s.snapshot);
    }
    return { artifact: dto.version(v) };
  });
}
module.exports = {
  read,
  mutate,
  workspace,
  getWorkspace,
  createProposal,
  adopt,
  reject,
  listProposals,
  getProposal,
  getGroup,
  listGroups,
  getArtifact,
};
