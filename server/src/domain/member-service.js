'use strict';
const access = require('../access'),
  runtime = require('../runtime');
const repo = require('../persistence/members'),
  policy = require('./membership-policy');
const { command, governanceAudit } = require('../persistence/commands');
const events = require('../persistence/events');
function dto(r) {
  return {
    id: r.public_id,
    name: r.name,
    role: r.role,
    active: r.active,
    revision: r.revision,
    createdAt: r.created_at,
    disabledAt: r.disabled_at,
  };
}
function role(value) {
  if (!['owner', 'executor', 'viewer'].includes(value))
    access.fail('INVALID_ROLE', 400);
  return value;
}
async function changed(client, db, ctx, row, action) {
  await governanceAudit(
    client,
    db,
    ctx,
    'member',
    row.public_id,
    action,
    'role=' + row.role + ';active=' + row.active,
  );
  await events.append(
    client,
    db,
    ctx,
    'governance.changed',
    row.public_id,
    row.revision,
    { entityType: 'member', entityId: row.public_id },
  );
  return { member: dto(row) };
}
async function list(input) {
  const ctx = access.current(),
    db = runtime.db(),
    pagination = access.page(input);
  return policy.read(db, ctx, false, async (client) => {
    const r = await repo.list(client, db, ctx, pagination);
    return { ...r, ...pagination, items: r.items.map(dto) };
  });
}
async function create(input) {
  const ctx = access.current(true),
    db = runtime.db();
  const name = access.text(input.name, 160, true),
    requestedRole = role(input.role);
  if (
    !runtime
      .config()
      .users.some((u) => u.tenantId === ctx.tenantId && u.name === name)
  )
    access.fail('UNKNOWN_LOCAL_USER', 400, '先在本地允许名单配置此账号');
  return command(db, ctx, 'member.create', input, async (client) => {
    if (await repo.byName(client, db, { ...ctx, actor: name }))
      access.fail('MEMBER_EXISTS', 409);
    return changed(
      client,
      db,
      ctx,
      await repo.insert(client, db, ctx.tenantId, {
        name,
        role: requestedRole,
      }),
      'member.created',
    );
  });
}
async function update(id, input, disable = false) {
  const ctx = access.current(true),
    db = runtime.db();
  if (!disable) role(input.role);
  return command(
    db,
    ctx,
    (disable ? 'member.disabled:' : 'member.role:') + id,
    input,
    async (client) => {
      const row = await repo.find(client, db, ctx, id);
      if (!row) access.fail('NOT_FOUND', 404);
      access.revision(row, input.expectedRevision);
      if (!row.active) access.fail('MEMBER_INACTIVE', 409);
      const nextRole = disable ? row.role : input.role;
      if (
        row.role === 'owner' &&
        (disable || nextRole !== 'owner') &&
        (await repo.owners(client, db, ctx)).length <= 1
      )
        access.fail('LAST_OWNER_REQUIRED', 409, '至少保留一位有效负责人');
      return changed(
        client,
        db,
        ctx,
        await repo.update(client, db, ctx, row, nextRole, !disable),
        disable ? 'member.disabled' : 'member.role',
      );
    },
  );
}
module.exports = { list, create, update, dto };
