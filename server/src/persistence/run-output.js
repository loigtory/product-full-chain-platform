'use strict';
const { allocateIdentifier } = require('./identifiers');
async function lines(client, db, ctx, run, afterSeq, limit = 200) {
  const tail = afterSeq === undefined;
  const rows = (
    await client.query(
      `SELECT seq,cls,text,created_at at,source FROM "${db.schema}".run_lines WHERE tenant_id=$1 AND run_id=$2 AND seq>$3 ORDER BY seq ${tail ? 'DESC' : 'ASC'} LIMIT $4`,
      [
        ctx.tenantId,
        run.id,
        Number(afterSeq) || 0,
        Math.min(200, Math.max(1, Number(limit) || 200)),
      ],
    )
  ).rows;
  return tail ? rows.reverse() : rows;
}
async function appendLine(client, db, ctx, run, event) {
  const seq = Number(
    (
      await client.query(
        `SELECT coalesce(max(seq),0)+1 n FROM "${db.schema}".run_lines WHERE tenant_id=$1 AND run_id=$2`,
        [ctx.tenantId, run.id],
      )
    ).rows[0].n,
  );
  await client.query(
    `INSERT INTO "${db.schema}".run_lines(tenant_id,run_id,seq,event_id,cls,text) VALUES($1,$2,$3,$4,$5,$6)`,
    [ctx.tenantId, run.id, seq, event.eventId, event.cls || 'info', event.text],
  );
  return seq;
}
async function replay(client, db, ctx, run, offset = 0, limit = 200) {
  return (
    await client.query(
      `SELECT step_no "stepNo",label,snapshot_ref "snapshotRef",source FROM "${db.schema}".replays WHERE tenant_id=$1 AND run_id=$2 ORDER BY step_no OFFSET $3 LIMIT $4`,
      [
        ctx.tenantId,
        run.id,
        Math.max(0, Number(offset) || 0),
        Math.min(200, Math.max(1, Number(limit) || 200)),
      ],
    )
  ).rows;
}
async function snapshot(client, db, ctx, run, event) {
  const id = await allocateIdentifier(client, db, ctx.tenantId, 'replays');
  await client.query(
    `INSERT INTO "${db.schema}".replays(id,tenant_id,run_id,public_id,step_no,label,snapshot_ref) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_id,step_no) DO NOTHING`,
    [
      id.id,
      ctx.tenantId,
      run.id,
      id.publicId,
      event.stepNo,
      event.label,
      event.snapshotRef,
    ],
  );
}
async function gates(client, db, ctx, run) {
  return (
    await client.query(
      `SELECT gate_id "gateId",name,status,evidence_ref "evidenceRef",source FROM "${db.schema}".quality_gates WHERE tenant_id=$1 AND run_id=$2 ORDER BY public_id`,
      [ctx.tenantId, run.id],
    )
  ).rows;
}
async function saveGate(client, db, ctx, run, g) {
  const id = await allocateIdentifier(
    client,
    db,
    ctx.tenantId,
    'quality_gates',
  );
  await client.query(
    `INSERT INTO "${db.schema}".quality_gates(id,tenant_id,run_id,public_id,gate_id,name,status,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(run_id,gate_id) DO UPDATE SET name=excluded.name,status=excluded.status,evidence_ref=excluded.evidence_ref`,
    [
      id.id,
      ctx.tenantId,
      run.id,
      id.publicId,
      g.gateId,
      g.name,
      g.status,
      g.evidenceRef || null,
    ],
  );
}
module.exports = { lines, appendLine, replay, snapshot, gates, saveGate };
