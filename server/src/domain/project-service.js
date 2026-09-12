'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  policy = require('./membership-policy'),
  repo = require('../persistence/projects');
const { command, governanceAudit } = require('../persistence/commands'),
  events = require('../persistence/events');
function dto(p) {
  return {
    id: p.public_id,
    name: p.name,
    path: p.path,
    repo: p.repo,
    branch: p.branch,
    tech: p.tech,
    source: p.source,
    revision: p.revision,
    loadedAt:
      p.loaded_at instanceof Date ? p.loaded_at.toISOString() : p.loaded_at,
    scanned: false,
    status: '已登记，未扫描',
  };
}
async function required(client, db, ctx, id) {
  const p = await repo.find(client, db, ctx, id);
  if (!p) access.fail('NOT_FOUND', 404);
  return p;
}
async function list(input = {}) {
  const ctx = access.current(),
    db = runtime.db(),
    query = { ...access.page(input), q: access.text(input.q || '', 160) };
  return policy.read(db, ctx, false, async (c) => {
    const r = await repo.list(c, db, ctx, query);
    return { ...r, items: r.items.map(dto) };
  });
}
async function get(id) {
  const ctx = access.current(),
    db = runtime.db();
  return policy.read(db, ctx, false, async (c) => ({
    project: dto(await required(c, db, ctx, id)),
  }));
}
async function create(input) {
  const ctx = access.current(true),
    db = runtime.db(),
    tech = input.tech || [];
  if (!Array.isArray(tech) || tech.length > 20)
    access.fail('INVALID_INPUT', 400);
  const v = {
    name: access.text(input.name, 160, true),
    path: access.text(input.path, 2048, true),
    repo: access.safeEndpoint(input.repo || ''),
    branch: access.text(input.branch || '', 160),
    source: access.text(input.source || 'existing', 40),
    tech: [...new Set(tech.map((t) => access.text(t, 80, true)))],
  };
  return command(db, ctx, 'project.create', input, async (c) => {
    const p = await repo.insert(c, db, ctx, v);
    await governanceAudit(
      c,
      db,
      ctx,
      'project',
      p.public_id,
      'project.registered',
      'metadata only',
    );
    await events.append(
      c,
      db,
      ctx,
      'governance.changed',
      p.public_id,
      p.revision,
      { entityType: 'project', entityId: p.public_id },
    );
    return { project: dto(p) };
  });
}
module.exports = { dto, required, list, get, create };
