'use strict';
const { S, seedFromState, pushAudit, pushNotice, nextId } = require('./store');
const sm = require('./state-machine');
const wsBridge = require('../ws');
// Existing memory demonstration adapter; no PG caller may enter this block.
async function addMaterial(id, { name, content, cls }) {
  await seedFromState();
  const req = S.reqs.get(id);
  if (!req) return { error: 'NOT_FOUND' };
  const m = {
    id: 'SM-' + S.seq.mat,
    reqId: id,
    name: name || '材料' + S.seq.mat,
    content: content || '',
    cls: cls || '内部',
    type: '文本',
    status: '已纳入',
    createdAt: new Date().toISOString(),
  };
  S.seq.mat++;
  S.materials.set(m.id, m);
  pushAudit('陈立', '登记材料', id + ' ' + m.name);
  return { material: m, quota: { used: S.materials.size, limit: 100 } };
}
const memory = { addMaterial };
module.exports = { memory };

const runtime = require('../runtime'),
  access = require('../access'),
  dto = require('./dto');
const repository = require('../persistence/materials'),
  reqRepo = require('../persistence/requirements'),
  files = require('../files/local-files');
const { mutate } = require('./requirement-service');
async function prepare(client, db, ctx, input) {
  const classification = input.classification || input.cls || '内部',
    allowed = input.allowed !== false,
    usage = input.usage || 'material';
  if (
    !['公开', '内部', '受限'].includes(classification) ||
    !['material', 'attachment'].includes(usage) ||
    (classification === '受限' && allowed)
  )
    access.fail('MATERIAL_RESTRICTED', 400);
  access.text(input.name || input.file?.name || '材料', 240, true);
  access.text(input.content || '', 200000);
  const value = {
    name: input.name || input.file?.name || '材料',
    content: input.content || '',
    classification,
    allowed,
    usage,
    status: allowed ? '已纳入' : '只登记',
  };
  if (input.file) {
    const decoded = files.decode(input.file);
    value.mimeType = decoded.mimeType;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      ctx.tenantId + ':files',
    ]);
    const used = Number(
      (
        await client.query(
          'SELECT coalesce(sum(size),0) n FROM "' +
            db.schema +
            '".file_objects WHERE tenant_id=$1',
          [ctx.tenantId],
        )
      ).rows[0].n,
    );
    const exists = (
      await client.query(
        'SELECT 1 FROM "' +
          db.schema +
          '".file_objects WHERE tenant_id=$1 AND hash=$2',
        [ctx.tenantId, decoded.hash],
      )
    ).rowCount;
    if (used + (exists ? 0 : decoded.size) > runtime.config().quota)
      access.fail('FILE_QUOTA_EXCEEDED', 413);
    const stored = await files.save(ctx.tenantId, decoded);
    client.rollbackTasks.push(() => files.rollback(client, db, ctx, stored));
    value.fileId = (await repository.fileObject(client, db, ctx, stored)).id;
    value.content = /^text\/|application\/json/.test(decoded.mimeType)
      ? decoded.bytes.subarray(0, 200000).toString('utf8')
      : '';
  }
  return value;
}
async function quota(client, db, ctx) {
  return {
    used: Number(
      (
        await client.query(
          'SELECT coalesce(sum(size),0) n FROM "' +
            db.schema +
            '".file_objects WHERE tenant_id=$1',
          [ctx.tenantId],
        )
      ).rows[0].n,
    ),
    limit: runtime.config().quota,
  };
}
module.exports.addMaterial = (id, input) =>
  mutate(id, input, 'material.created', async (client, db, ctx, row) => {
    const value = await prepare(client, db, ctx, input),
      m = await repository.create(client, db, ctx, row.id, value);
    if (value.usage === 'material' && value.allowed) {
      await client.query(
        'UPDATE "' +
          db.schema +
          '".reqs SET material_revision=material_revision+1 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, row.id],
      );
      await reqRepo.staleAfter(client, db, ctx, row.id, 'idea');
    }
    return {
      material: dto.material(
        (await repository.list(client, db, ctx, row.id)).find(
          (x) => x.id === m.id,
        ),
        id,
      ),
      quota: await quota(client, db, ctx),
    };
  });
module.exports.replaceMaterial = (id, mid, input) =>
  mutate(id, input, 'material.replaced', async (client, db, ctx, row) => {
    const material = (await repository.list(client, db, ctx, row.id)).find(
      (x) => x.public_id === mid,
    );
    if (!material) access.fail('NOT_FOUND', 404);
    const value = await prepare(client, db, ctx, {
      ...input,
      name: input.name || material.name,
      classification: material.classification,
      allowed: material.allowed,
      usage: material.usage,
    });
    const next = (
      await client.query(
        'UPDATE "' +
          db.schema +
          '".materials SET version=version+1,name=$1,status=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *',
        [value.name, '待确认影响', ctx.tenantId, material.id],
      )
    ).rows[0];
    await repository.addVersion(client, db, ctx, next, value);
    await client.query(
      'UPDATE "' +
        db.schema +
        '".reqs SET material_revision=material_revision+1 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, row.id],
    );
    await reqRepo.staleAfter(client, db, ctx, row.id, 'idea');
    return {
      impact: '新版本待确认纳入或排除',
      quota: await quota(client, db, ctx),
    };
  });
module.exports.materialImpact = (id, mid, input) =>
  mutate(id, input, 'material.impact', async (client, db, ctx, row) => {
    if (!['include', 'exclude'].includes(input.decision))
      access.fail('INVALID_INPUT', 400);
    const material = (await repository.list(client, db, ctx, row.id)).find(
      (x) => x.public_id === mid,
    );
    if (!material) access.fail('NOT_FOUND', 404);
    if (input.decision === 'include' && material.classification === '受限')
      access.fail('MATERIAL_RESTRICTED', 403);
    await client.query(
      'UPDATE "' +
        db.schema +
        '".materials SET allowed=$1,status=$2 WHERE tenant_id=$3 AND id=$4',
      [
        input.decision === 'include',
        input.decision === 'include' ? '已纳入' : '只登记',
        ctx.tenantId,
        material.id,
      ],
    );
    await client.query(
      'UPDATE "' +
        db.schema +
        '".reqs SET material_revision=material_revision+1 WHERE tenant_id=$1 AND id=$2',
      [ctx.tenantId, row.id],
    );
    await reqRepo.staleAfter(client, db, ctx, row.id, 'idea');
    return {};
  });
module.exports.materialContent = async (id, mid, version) => {
  const ctx = access.current(),
    db = runtime.db();
  if (
    version !== undefined &&
    (!Number.isInteger(Number(version)) || Number(version) < 1)
  )
    access.fail('INVALID_VERSION', 400);
  const row = (
    await db.pool.query(
      'SELECT v.*,f.hash FROM "' +
        db.schema +
        '".reqs r JOIN "' +
        db.schema +
        '".materials m ON m.tenant_id=r.tenant_id AND m.req_id=r.id JOIN "' +
        db.schema +
        '".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.version=coalesce($4::int,m.version) LEFT JOIN "' +
        db.schema +
        '".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE r.tenant_id=$1 AND r.public_id=$2 AND m.public_id=$3',
      [ctx.tenantId, id, mid, version || null],
    )
  ).rows[0];
  if (!row) access.fail('NOT_FOUND', 404);
  return {
    name: row.name,
    mimeType: row.mime_type,
    bytes: row.hash
      ? await files.read(ctx.tenantId, row.hash)
      : Buffer.from(row.content),
    hash: row.hash,
  };
};
