'use strict';
const { allocateIdentifier } = require('./identifiers');
const { fail } = require('../access');
async function append(client, db, ctx, type, aggregateId, revision, payload) {
  if (Buffer.byteLength(JSON.stringify(payload)) > 60000)
    fail('EVENT_TOO_LARGE', 413);
  const id = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'domain_events',
  );
  return (
    await client.query(
      `INSERT INTO "${db.schema}".domain_events(id,tenant_id,public_id,type,aggregate_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        id.publicId,
        type,
        aggregateId,
        revision,
        JSON.stringify(payload),
      ],
    )
  ).rows[0];
}
async function after(db, seq) {
  return (
    await db.pool.query(
      `SELECT * FROM "${db.schema}".domain_events WHERE seq>$1 ORDER BY seq LIMIT 50`,
      [seq],
    )
  ).rows;
}
module.exports = { append, after };
