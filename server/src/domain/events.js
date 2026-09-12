'use strict';
const runtime = require('../runtime');
const repository = require('../persistence/events');
let active = false,
  scheduled = false,
  stopped = false,
  cursor = 0;
async function drain() {
  if (active || stopped || !runtime.isPg()) return;
  active = true;
  try {
    const rows = await repository.after(runtime.db(), cursor);
    for (const row of rows) {
      await require('../ws').broadcast(
        row.type,
        {
          ...row.payload,
          eventId: row.public_id,
          seq: Number(row.seq),
          revision: row.revision,
        },
        row.tenant_id,
      );
      cursor = Number(row.seq);
    }
    if (rows.length === 50) kick();
  } catch {
    /* Durable rows remain for retry; no business rollback or memory fallback. */
  } finally {
    active = false;
  }
}
function kick() {
  if (scheduled || stopped) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    void drain();
  });
}
function start() {
  const timer = setInterval(kick, 500);
  timer.unref();
  runtime.onClose(() => {
    stopped = true;
    clearInterval(timer);
  });
  kick();
}
module.exports = { start, kick };
