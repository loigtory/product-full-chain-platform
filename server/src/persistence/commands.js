'use strict';
const { createHash } = require('node:crypto');
const { withTransaction } = require('./transaction');
const { fail } = require('../access');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const fingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
async function command(db, ctx, operation, input, work) {
  const key = input?.commandId;
  if (typeof key !== 'string' || !key.trim() || key.length > 160)
    fail('COMMAND_ID_REQUIRED', 400);
  const hash = fingerprint(input);
  const result = await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      ctx.tenantId + ctx.actor + operation + key,
    ]);
    const previous = (
      await client.query(
        `SELECT fingerprint,result FROM "${db.schema}".command_receipts WHERE tenant_id=$1 AND actor=$2 AND operation=$3 AND command_id=$4`,
        [ctx.tenantId, ctx.actor, operation, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== hash) fail('COMMAND_CONFLICT');
      return previous.result;
    }
    const value = await work(client);
    await client.query(
      `INSERT INTO "${db.schema}".command_receipts(tenant_id,actor,operation,command_id,fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)`,
      [ctx.tenantId, ctx.actor, operation, key, hash, JSON.stringify(value)],
    );
    return value;
  });
  require('../domain/events').kick(); // Only after COMMIT. Event failure must not rewrite command outcome.
  return result;
}
module.exports = { command, fingerprint };
