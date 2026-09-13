'use strict';
const { randomUUID } = require('node:crypto');
const entities = Object.freeze({
  artifact_versions: { prefix: 'AV', initial: 0 },
  artifact_groups: { prefix: 'AG', initial: 0 },
  artifact_group_sources: { prefix: 'AS', initial: 0 },
  artifact_proposals: { prefix: 'AP', initial: 0 },
  artifact_confirmations: { prefix: 'ACF', initial: 0 },
  artifact_impacts: { prefix: 'AI', initial: 0 },
  members: { prefix: 'MEM', initial: 0 },
  caps: { prefix: 'CP', initial: 0 },
  projects: { prefix: 'PRJ', initial: 0 },
  knowledge: { prefix: 'KN', initial: 0 },
  reqs: { prefix: 'R', initial: 1040 },
  req_versions: { prefix: 'SV', initial: 0 },
  audit_logs: { prefix: 'A', initial: 0 },
  questions: { prefix: 'SQ', initial: 0 },
  materials: { prefix: 'SM', initial: 0 },
  material_versions: { prefix: 'MV', initial: 0 },
  file_objects: { prefix: 'FO', initial: 0 },
  messages: { prefix: 'SMSG', initial: 0 },
  runs: { prefix: 'R', initial: 100 },
  run_plans: { prefix: 'PLAN', initial: 0 },
  notices: { prefix: 'N', initial: 0 },
  domain_events: { prefix: 'EV', initial: 0 },
  req_version_reviews: { prefix: 'RV', initial: 0 },
  replays: { prefix: 'RP', initial: 0 },
  quality_gates: { prefix: 'QG', initial: 0 },
  leases: { prefix: 'L', initial: 0 },
  message_references: { prefix: 'MR', initial: 0 },
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
