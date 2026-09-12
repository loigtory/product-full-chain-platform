'use strict';
const access = require('../access'),
  runtime = require('../runtime'),
  policy = require('./membership-policy'),
  repo = require('../persistence/knowledge');
const {
    command,
    fingerprint,
    governanceAudit,
  } = require('../persistence/commands'),
  events = require('../persistence/events');
const types = ['复盘结论', '组件规范', '接口契约', '踩坑记录', 'Playbook'];
function dto(k) {
  return {
    id: k.public_id,
    title: k.title,
    type: k.type,
    content: k.content,
    tags: k.tags,
    version: k.version,
    at: k.created_at,
    source: '手工登记',
  };
}
async function list(input = {}) {
  const ctx = access.current(),
    db = runtime.db(),
    query = {
      ...access.page(input),
      q: access.text(input.q || '', 160),
      type: input.type || null,
    };
  if (query.type && !types.includes(query.type))
    access.fail('INVALID_INPUT', 400);
  return policy.read(db, ctx, false, async (c) => {
    const r = await repo.list(c, db, ctx, query);
    return { ...r, items: r.items.map(dto) };
  });
}
async function create(input) {
  const ctx = access.current(true),
    db = runtime.db();
  if (
    !types.includes(input.type) ||
    !Array.isArray(input.tags) ||
    input.tags.length > 20
  )
    access.fail('INVALID_INPUT', 400);
  const v = {
    title: access.text(input.title, 160, true),
    type: input.type,
    content: access.text(input.content || '', 32000),
    tags: [...new Set(input.tags.map((t) => access.text(t, 40, true)))],
  };
  return command(db, ctx, 'knowledge.create', input, async (c) => {
    const k = await repo.insert(c, db, ctx, v);
    await governanceAudit(
      c,
      db,
      ctx,
      'knowledge',
      k.public_id,
      'knowledge.created',
      'version=1',
    );
    await events.append(c, db, ctx, 'governance.changed', k.public_id, 1, {
      entityType: 'knowledge',
      entityId: k.public_id,
    });
    return { knowledge: dto(k) };
  });
}
async function capture(c, db, ctx, req) {
  const source = [req.name, req.goal, req.scope].join('\n');
  for (const k of await repo.matches(c, db, ctx, source)) {
    const words = [k.title, ...k.tags].filter((w) =>
      source.toLowerCase().includes(w.toLowerCase()),
    );
    const snapshot = {
      id: k.public_id,
      version: k.version,
      title: k.title,
      type: k.type,
      reason: '关键词：' + words.join('、'),
      summary: k.content.slice(0, 1000),
      fingerprint: fingerprint({
        title: k.title,
        type: k.type,
        content: k.content,
        tags: k.tags,
        version: k.version,
      }),
      source: '需求创建时关键词匹配',
    };
    await repo.link(c, db, ctx, req.id, k, snapshot);
  }
  return repo.refs(c, db, ctx, req.id);
}
module.exports = { list, create, capture, dto };
