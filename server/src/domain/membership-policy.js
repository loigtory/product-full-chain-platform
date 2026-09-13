'use strict';
const access = require('../access');
const repo = require('../persistence/members');
const { withTransaction } = require('../persistence/transaction');
async function member(client, db, ctx) {
  const row = await repo.byName(client, db, ctx);
  if (!row)
    access.fail('MEMBER_NOT_CONFIGURED', 403, '本地账号尚未登记团队成员');
  if (!row.active) access.fail('MEMBER_INACTIVE', 403, '成员已停用');
  return row;
}
function requireRole(row, ownerOnly = false, write = false) {
  if (
    ownerOnly
      ? row.role !== 'owner'
      : write && !['owner', 'executor'].includes(row.role)
  )
    access.fail('FORBIDDEN', 403, '当前成员没有此操作权限');
}
async function authorizeCommand(client, db, ctx, operation) {
  if (ctx.role === 'bridge') {
    if (access.isInternal(ctx) && operation.startsWith('bridge.event:')) return;
    access.fail('FORBIDDEN', 403);
  }
  await repo.lockTenant(client, db, ctx.tenantId);
  const row = await member(client, db, ctx);
  const ownerOnly =
    /^(?:member\.|cap\.|binding\.|audit\.|productAcceptance\.)/.test(operation);
  requireRole(row, ownerOnly, !operation.startsWith('notice.'));
  Object.assign(ctx, {
    role: row.role,
    memberId: row.id,
    memberPublicId: row.public_id,
    memberRevision: row.revision,
  });
  return row;
}
async function identity(db, claims, users) {
  if (
    !users.some(
      (u) => u.name === claims?.sub && u.tenantId === claims?.tenant,
    ) ||
    claims?.role === 'bridge'
  )
    access.fail('FORBIDDEN', 403);
  const ctx = { tenantId: claims.tenant, actor: claims.sub };
  const row = await member(db.pool, db, ctx);
  return {
    ...ctx,
    role: row.role,
    memberId: row.id,
    memberPublicId: row.public_id,
    memberRevision: row.revision,
  };
}
async function authorizePush(db, ctx, callback) {
  return withTransaction(db, async (client) => {
    await repo.lockTenant(client, db, ctx.tenantId);
    const row = await member(client, db, ctx);
    if (ctx.memberRevision !== row.revision)
      access.fail('MEMBERSHIP_CHANGED', 403);
    return callback();
  });
}
async function assertOwners(db, users) {
  for (const tenantId of new Set(users.map((u) => u.tenantId))) {
    const owners = await repo.owners(db.pool, db, { tenantId });
    if (
      !owners.some((o) =>
        users.some((u) => u.tenantId === tenantId && u.name === o.name),
      )
    )
      access.fail('MEMBER_INITIALIZATION_REQUIRED', 503);
  }
}
async function read(db, ctx, ownerOnly, work) {
  return withTransaction(db, async (client) => {
    await repo.lockTenant(client, db, ctx.tenantId);
    const row = await member(client, db, ctx);
    requireRole(row, ownerOnly);
    Object.assign(ctx, { role: row.role, memberId: row.id });
    return work(client);
  });
}
module.exports = {
  member,
  requireRole,
  authorizeCommand,
  identity,
  authorizePush,
  assertOwners,
  read,
};
