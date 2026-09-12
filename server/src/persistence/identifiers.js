'use strict';
const { randomUUID } = require('node:crypto');
const entities = Object.freeze({
  reqs: { prefix: 'R', initial: 1040 },
  req_versions: { prefix: 'SV', initial: 0 },
  audit_logs: { prefix: 'A', initial: 0 },
});
const error = (code) => Object.assign(new Error(code), { code });
function entityInfo(entity) {
  if (!Object.hasOwn(entities, entity)) throw error('UNKNOWN_ENTITY');
  return entities[entity];
}
async function allocateIdentifier(client, db, tenantId, entity) {
  const { prefix, initial } = entityInfo(entity);
  const counter = (
    await client.query(
      `INSERT INTO "${db.schema}".id_counters(tenant_id,entity,value)
    VALUES($1,$2,$3) ON CONFLICT(tenant_id,entity) DO UPDATE SET value=id_counters.value+1 RETURNING value`,
      [tenantId, entity, initial + 1],
    )
  ).rows[0].value;
  return { id: randomUUID(), publicId: prefix + '-' + counter };
}
async function resolveIdentifier(client, db, tenantId, entity, publicId) {
  entityInfo(entity);
  return (
    (
      await client.query(
        `SELECT id FROM "${db.schema}"."${entity}" WHERE tenant_id=$1 AND public_id=$2`,
        [tenantId, publicId],
      )
    ).rows[0]?.id || null
  );
}
module.exports = { allocateIdentifier, resolveIdentifier };
