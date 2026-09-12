'use strict';
const { allocateIdentifier } = require('./identifiers');
async function list(client, db, ctx, reqId) {
  return (
    await client.query(
      `SELECT m.*,v.content,v.file_id,v.mime_type,f.hash,f.size FROM "${db.schema}".materials m JOIN "${db.schema}".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.version=m.version LEFT JOIN "${db.schema}".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 ORDER BY m.created_at,m.public_id`,
      [ctx.tenantId, reqId],
    )
  ).rows;
}
async function create(client, db, ctx, reqId, input) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'materials');
  const row = (
    await client.query(
      `INSERT INTO "${db.schema}".materials(id,tenant_id,req_id,public_id,name,classification,allowed,usage,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        id.id,
        ctx.tenantId,
        reqId,
        id.publicId,
        input.name,
        input.classification,
        input.allowed,
        input.usage,
        input.status,
      ],
    )
  ).rows[0];
  await addVersion(client, db, ctx, row, input);
  return row;
}
async function addVersion(client, db, ctx, material, input) {
  const id = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'material_versions',
  );
  await client.query(
    `INSERT INTO "${db.schema}".material_versions(id,tenant_id,material_id,public_id,version,content,file_id,mime_type,name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id.id,
      ctx.tenantId,
      material.id,
      id.publicId,
      material.version,
      input.content || '',
      input.fileId || null,
      input.mimeType || 'text/plain',
      input.name,
    ],
  );
}
async function fileObject(client, db, ctx, stored) {
  let row = (
    await client.query(
      `SELECT * FROM "${db.schema}".file_objects WHERE tenant_id=$1 AND hash=$2`,
      [ctx.tenantId, stored.hash],
    )
  ).rows[0];
  if (!row) {
    const id = await allocateIdentifier(
      client,
      db,
      ctx.tenantId,
      'file_objects',
    );
    row = (
      await client.query(
        `INSERT INTO "${db.schema}".file_objects(id,tenant_id,public_id,hash,size,file_ref,status) VALUES($1,$2,$3,$4,$5,$6,'READY') RETURNING *`,
        [
          id.id,
          ctx.tenantId,
          id.publicId,
          stored.hash,
          stored.size,
          stored.ref,
        ],
      )
    ).rows[0];
  }
  return row;
}
module.exports = { list, create, addVersion, fileObject };
