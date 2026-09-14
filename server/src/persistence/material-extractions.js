'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../access');
async function save(client, db, job, source, parsed) {
  if (
    parsed.sourceHash !== source.hash ||
    !['READY', 'PARTIAL', 'NEEDS_VISION'].includes(parsed.status)
  )
    fail('EXTRACTION_SOURCE_CHANGED');
  const id = randomUUID();
  const { segments, ...details } = parsed;
  if (
    !Array.isArray(segments) ||
    segments.length > 20000 ||
    segments.reduce((n, s) => n + s.text.length, 0) > 200000
  )
    fail('EXTRACTION_LIMIT');
  await client.query(
    `INSERT INTO "${db.schema}".material_extractions(id,tenant_id,req_id,material_version_id,job_id,source_hash,state,parser_version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      job.tenant_id,
      job.req_id,
      source.versionId,
      job.id,
      source.hash,
      parsed.status,
      parsed.parser,
      JSON.stringify(details),
    ],
  );
  if (segments.length)
    await client.query(
      `INSERT INTO "${db.schema}".material_segments(tenant_id,req_id,extraction_id,ordinal,location,text,hash) SELECT $1,$2,$3,x.ordinal,x.location,x.text,x.hash FROM jsonb_to_recordset($4::jsonb) AS x(ordinal int,location jsonb,text text,hash text)`,
      [
        job.tenant_id,
        job.req_id,
        id,
        JSON.stringify(
          segments.map((s, i) => ({
            ordinal: i + 1,
            location: s.location,
            text: s.text,
            hash: s.id,
          })),
        ),
      ],
    );
  return id;
}
async function latest(client, db, ctx, reqId, versionId, hash) {
  const row = (
    await client.query(
      `SELECT * FROM "${db.schema}".material_extractions WHERE tenant_id=$1 AND req_id=$2 AND material_version_id=$3 AND source_hash=$4 ORDER BY created_at DESC,id DESC LIMIT 1`,
      [ctx.tenantId, reqId, versionId, hash],
    )
  ).rows[0];
  if (!row) return null;
  row.segments = (
    await client.query(
      `SELECT ordinal,location,text,hash FROM "${db.schema}".material_segments WHERE tenant_id=$1 AND req_id=$2 AND extraction_id=$3 ORDER BY ordinal`,
      [ctx.tenantId, reqId, row.id],
    )
  ).rows;
  return row;
}
module.exports = { save, latest };
