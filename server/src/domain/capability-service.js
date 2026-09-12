'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  policy = require('./membership-policy');
const repo = require('../persistence/caps'),
  bindings = require('../persistence/bindings'),
  reqRepo = require('../persistence/requirements');
const {
    command,
    fingerprint,
    governanceAudit,
  } = require('../persistence/commands'),
  events = require('../persistence/events');
const protocols = {
  Skill: '原生 Skill',
  MCP: 'MCP',
  ACP: 'ACP',
  终端工具: '终端',
};
const stages = [
  'idea',
  'req',
  'design',
  'dev',
  'test',
  'accept',
  'release',
  'observe',
];
function dto(c) {
  return {
    id: c.public_id,
    name: c.name,
    type: c.type,
    protocol: c.protocol,
    endpoint: c.endpoint,
    src: c.src,
    ver: c.ver,
    desc: c.description,
    fingerprint: c.fingerprint,
    pending: !c.reviewed_at,
    enabled: c.enabled,
    revision: c.revision,
    reviewedAt: c.reviewed_at,
    perm: '仅登记，未调用',
  };
}
async function available(client, db, ctx, id, requireEnabled = true) {
  const c = await repo.find(client, db, ctx, id);
  if (!c) access.fail('NOT_FOUND', 404);
  if (requireEnabled && !c.reviewed_at)
    access.fail('CAP_NOT_REVIEWED', 409, '能力尚未复核');
  if (requireEnabled && !c.enabled)
    access.fail('CAP_DISABLED', 409, '团队已停用此能力');
  return c;
}
async function changed(client, db, ctx, c, action) {
  await governanceAudit(
    client,
    db,
    ctx,
    'cap',
    c.public_id,
    action,
    'revision=' + c.revision,
  );
  await events.append(
    client,
    db,
    ctx,
    'governance.changed',
    c.public_id,
    c.revision,
    { entityType: 'cap', entityId: c.public_id },
  );
  return { cap: dto(c) };
}
async function list(input = {}) {
  const ctx = access.current(),
    db = runtime.db(),
    page = access.page(input),
    q = access.text(input.q || '', 160);
  if (
    input.pending !== undefined &&
    !['true', 'false'].includes(String(input.pending))
  )
    access.fail('INVALID_INPUT', 400);
  return policy.read(db, ctx, false, async (client) => {
    const r = await repo.list(client, db, ctx, {
      ...page,
      q,
      pending:
        input.pending === undefined ? null : String(input.pending) === 'true',
    });
    return { ...r, ...page, items: r.items.map(dto) };
  });
}
async function create(input) {
  const ctx = access.current(true),
    db = runtime.db();
  if (
    !Object.hasOwn(protocols, input.type) ||
    (input.protocol && input.protocol !== protocols[input.type])
  )
    access.fail('INVALID_PROTOCOL', 400);
  const value = {
    name: access.text(input.name, 80, true),
    type: input.type,
    protocol: protocols[input.type],
    endpoint: access.safeEndpoint(input.endpoint),
    src: access.text(input.src || '', 160),
    ver: access.text(input.ver, 100, true),
    desc: access.text(input.desc || '', 4000),
  };
  value.fingerprint = fingerprint(value);
  return command(db, ctx, 'cap.create', input, async (client) => {
    if (await repo.duplicate(client, db, ctx, value.name, value.ver))
      access.fail('CAP_VERSION_EXISTS', 409);
    return changed(
      client,
      db,
      ctx,
      await repo.insert(client, db, ctx, value),
      'cap.created',
    );
  });
}
async function update(id, input, review = false) {
  const ctx = access.current(true),
    db = runtime.db();
  if (!review && typeof input.enabled !== 'boolean')
    access.fail('INVALID_INPUT', 400);
  return command(
    db,
    ctx,
    (review ? 'cap.review:' : 'cap.toggle:') + id,
    input,
    async (client) => {
      const c = await available(client, db, ctx, id, false);
      access.revision(c, input.expectedRevision);
      if (!review && input.enabled && !c.reviewed_at)
        access.fail('CAP_NOT_REVIEWED');
      const row = review
        ? c.reviewed_at
          ? c
          : await repo.review(client, db, ctx, c)
        : await repo.toggle(client, db, ctx, c, input.enabled);
      return changed(
        client,
        db,
        ctx,
        row,
        review ? 'cap.reviewed' : 'cap.toggled',
      );
    },
  );
}
function bindingDto(row) {
  return { stage: row.stage, revision: row.revision, capIds: row.capIds };
}
async function listBindings() {
  const ctx = access.current(),
    db = runtime.db();
  return policy.read(db, ctx, false, async (client) => {
    const items = [];
    for (const st of stages)
      items.push(bindingDto(await bindings.get(client, db, ctx, st)));
    return { items };
  });
}
function bounded(items, key) {
  if (
    !Array.isArray(items) ||
    items.length > 100 ||
    new Set(items.map(key)).size !== items.length
  )
    access.fail('INVALID_BINDINGS', 400);
}
async function saveBindings(input) {
  const ctx = access.current(true),
    db = runtime.db(),
    stage = access.stage(input.stage);
  bounded(input.capIds, (x) => x);
  if (input.capIds.some((x) => typeof x !== 'string'))
    access.fail('INVALID_BINDINGS', 400);
  return command(db, ctx, 'binding.save:' + stage, input, async (client) => {
    const current = await bindings.get(client, db, ctx, stage);
    access.revision(current, input.expectedRevision);
    const caps = [];
    for (const id of input.capIds)
      caps.push(await available(client, db, ctx, id));
    const saved = await bindings.save(
      client,
      db,
      ctx,
      stage,
      current.revision,
      caps,
    );
    await governanceAudit(
      client,
      db,
      ctx,
      'binding',
      stage,
      'binding.updated',
      'count=' + caps.length,
    );
    await events.append(
      client,
      db,
      ctx,
      'governance.changed',
      stage,
      saved.revision,
      { entityType: 'binding', stage },
    );
    return { binding: bindingDto(saved) };
  });
}
async function context(client, db, ctx, req, stage = req.stage) {
  const defaults = await bindings.get(client, db, ctx, stage),
    overrides = await bindings.overrides(client, db, ctx, req.id, stage),
    selected = new Map(defaults.caps.map((c) => [c.public_id, c]));
  for (const o of overrides) {
    if (o.override_enabled) selected.set(o.public_id, o);
    else selected.delete(o.public_id);
  }
  const effective = [...selected.values()]
    .filter((c) => c.enabled && c.reviewed_at)
    .sort((a, b) => a.public_id.localeCompare(b.public_id));
  if (effective.length > 100) access.fail('CONTEXT_LIMIT_EXCEEDED', 409);
  return {
    stage,
    revision: req.revision,
    bindingRevision: defaults.revision,
    overrides: overrides.map((c) => ({
      capId: c.public_id,
      enabled: c.override_enabled,
    })),
    effectiveCaps: effective.map(dto),
  };
}
async function getOverrides(id, input = {}) {
  const ctx = access.current(),
    db = runtime.db();
  return policy.read(db, ctx, false, async (client) => {
    const req = await reqRepo.lock(client, db, ctx, id);
    return context(
      client,
      db,
      ctx,
      req,
      access.stage(input.stage || req.stage),
    );
  });
}
async function setOverrides(id, input) {
  const ctx = access.current(true),
    db = runtime.db(),
    stage = access.stage(input.stage);
  bounded(input.overrides, (x) => x?.capId);
  if (
    input.overrides.some(
      (x) => typeof x?.capId !== 'string' || typeof x.enabled !== 'boolean',
    )
  )
    access.fail('INVALID_BINDINGS', 400);
  return command(db, ctx, 'req.overrides:' + id, input, async (client) => {
    const req = await reqRepo.lock(client, db, ctx, id);
    access.revision(req, input.expectedRevision);
    const items = [];
    for (const item of input.overrides)
      items.push({
        cap: await available(client, db, ctx, item.capId, item.enabled),
        enabled: item.enabled,
      });
    await bindings.saveOverrides(client, db, ctx, req.id, stage, items);
    const updated = await reqRepo.touch(
      client,
      db,
      ctx,
      req,
      'req.cap-overrides',
    );
    return context(client, db, ctx, updated, stage);
  });
}
module.exports = {
  list,
  create,
  update,
  listBindings,
  saveBindings,
  getOverrides,
  setOverrides,
  context,
  available,
  dto,
};
