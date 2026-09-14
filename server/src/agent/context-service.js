'use strict';
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { extname } = require('node:path');
const { fail } = require('../access');
const { fingerprint } = require('../persistence/commands');
const extractions = require('../persistence/material-extractions');
async function materialSource(client, db, ctx, req, selector) {
  if (
    !selector ||
    typeof selector.id !== 'string' ||
    !Number.isInteger(selector.version)
  )
    fail('INVALID_REFERENCE', 400);
  const row = (
    await client.query(
      `SELECT m.public_id,m.version,m.allowed,m.status,m.classification,v.id version_id,v.content,v.name,v.file_id,f.hash FROM "${db.schema}".materials m JOIN "${db.schema}".material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.version=m.version LEFT JOIN "${db.schema}".file_objects f ON f.tenant_id=v.tenant_id AND f.id=v.file_id WHERE m.tenant_id=$1 AND m.req_id=$2 AND m.public_id=$3`,
      [ctx.tenantId, req.id, selector.id],
    )
  ).rows[0];
  if (
    !row ||
    !row.allowed ||
    row.status !== '已纳入' ||
    row.classification === '受限' ||
    row.version !== selector.version
  )
    fail('STALE_REFERENCE');
  if (
    /(^|[\\/])(?:\.env(?:\.|$)|\.git(?:[\\/]|$)|node_modules(?:[\\/]|$))|(?:^|[._-])(?:credentials?|tokens?|secrets?)(?:[._-]|$)/i.test(
      row.name,
    )
  )
    fail('MATERIAL_SENSITIVE', 403);
  const hash =
    row.hash || createHash('sha256').update(row.content).digest('hex');
  if (selector.hash && selector.hash !== hash) fail('STALE_REFERENCE');
  return {
    id: row.public_id,
    version: row.version,
    versionId: row.version_id,
    hash,
    name: row.name,
    content: row.content,
    file: !!row.file_id,
  };
}
async function sourceBytes(ctx, source) {
  const bytes = source.file
    ? await require('../files/local-files').read(ctx.tenantId, source.hash)
    : Buffer.from(source.content);
  if (createHash('sha256').update(bytes).digest('hex') !== source.hash)
    fail('FILE_CORRUPT', 503);
  return bytes;
}
function extension(source) {
  return source.file ? extname(source.name).slice(1).toLowerCase() : 'txt';
}
async function build(client, db, ctx, req, input, connectionHash) {
  const selections = input.materials ?? [];
  if (
    !Array.isArray(selections) ||
    selections.length > 10 ||
    new Set(selections.map((s) => s.id)).size !== selections.length
  )
    fail('AGENT_MATERIAL_LIMIT', 400);
  const materials = [];
  let chars = 0;
  for (const selected of selections) {
    const source = await materialSource(client, db, ctx, req, selected);
    const parsed = await extractions.latest(
      client,
      db,
      ctx,
      req.id,
      source.versionId,
      source.hash,
    );
    if (!parsed || parsed.state === 'FAILED')
      fail('MATERIAL_EXTRACTION_REQUIRED');
    if (parsed.state === 'NEEDS_VISION') fail('MATERIAL_VISION_UNVERIFIED');
    if (
      parsed.state === 'PARTIAL' &&
      (!Array.isArray(selected.segments) || !selected.segments.length)
    )
      fail('MATERIAL_SEGMENT_SELECTION_REQUIRED');
    const ordinals = selected.segments ?? parsed.segments.map((s) => s.ordinal);
    if (
      !Array.isArray(ordinals) ||
      !ordinals.length ||
      new Set(ordinals).size !== ordinals.length ||
      ordinals.some(
        (n) =>
          !Number.isSafeInteger(n) ||
          !parsed.segments.some((s) => s.ordinal === n),
      )
    )
      fail('MATERIAL_SEGMENT_INVALID', 400);
    const segments = parsed.segments.filter((s) =>
      ordinals.includes(s.ordinal),
    );
    chars += segments.reduce((n, s) => n + s.text.length, 0);
    if (chars > 200000) fail('AGENT_CONTEXT_LIMIT', 413);
    materials.push({
      id: source.id,
      version: source.version,
      hash: source.hash,
      name: source.name,
      extractionId: parsed.id,
      segments,
    });
  }
  const snapshot = {
    reqId: req.public_id,
    requirementId: req.id,
    revision: req.revision,
    materialRevision: req.material_revision,
    name: req.name,
    goal: req.goal,
    scope: req.scope,
    currentArtifactGroupId: req.current_artifact_group_id ?? null,
    materials,
    connectionHash,
  };
  return { snapshot, hash: fingerprint(snapshot) };
}
async function assertCurrent(client, db, ctx, req, jobInput, connectionHash) {
  const current = await build(
    client,
    db,
    ctx,
    req,
    jobInput.selection,
    connectionHash,
  );
  if (
    current.hash !== jobInput.contextHash ||
    jobInput.consentHash !== current.hash
  )
    fail('AGENT_CONTEXT_CHANGED');
  for (const selected of current.snapshot.materials)
    await sourceBytes(
      ctx,
      await materialSource(client, db, ctx, req, selected),
    );
  return current;
}
module.exports = {
  materialSource,
  sourceBytes,
  extension,
  build,
  assertCurrent,
};
