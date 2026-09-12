'use strict';
const { S, seedFromState } = require('./store');
const runtime = require('../runtime'),
  access = require('../access'),
  repo = require('../persistence/notices');
const memory = {
  async listNotices() {
    await seedFromState();
    return {
      items: S.notices,
      unread: S.notices.filter((n) => !n.read).length,
    };
  },
  async readNotice(id) {
    await seedFromState();
    const n = S.notices.find((n) => n.id === id);
    if (!n) access.fail('NOT_FOUND', 404);
    n.read = true;
    return { ok: true };
  },
  async readAllNotices() {
    await seedFromState();
    S.notices.forEach((n) => (n.read = true));
    return { ok: true };
  },
};
async function listNotices() {
  const ctx = access.current(),
    db = runtime.db(),
    items = await repo.list(db.pool, db, ctx);
  return { items, unread: items.filter((n) => !n.read).length };
}
async function readNotice(id, input = {}) {
  const ctx = access.current(),
    db = runtime.db();
  return require('../persistence/commands').command(
    db,
    ctx,
    'notice.read:' + id,
    input,
    async (client) => {
      if (!(await repo.list(client, db, ctx)).some((n) => n.id === id))
        access.fail('NOT_FOUND', 404);
      await repo.mark(client, db, ctx, id);
      return { ok: true };
    },
  );
}
async function readAllNotices(input = {}) {
  const ctx = access.current(),
    db = runtime.db();
  return require('../persistence/commands').command(
    db,
    ctx,
    'notice.readAll',
    input,
    async (client) => {
      await repo.mark(client, db, ctx);
      return { ok: true };
    },
  );
}
module.exports = { memory, listNotices, readNotice, readAllNotices };
