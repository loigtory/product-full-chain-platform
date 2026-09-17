'use strict';
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { extname } = require('node:path');
const { fail } = require('../access');
const { fingerprint } = require('../persistence/commands');
const extractions = require('../persistence/material-extractions');
const stages = [
  'idea',
  'req',
  'design',
  'dev',
  'test',
  'accept',
  'release',
  'observe',
];
function normalizeStageContext(values = [], stage, trusted = false) {
  if (!Array.isArray(values) || values.length > 7)
    fail('AGENT_CONTEXT_LIMIT', 413);
  const current = stages.indexOf(stage);
  let chars = 0;
  const result = values.map((c) => {
    if (
      !c ||
      typeof c.text !== 'string' ||
      !c.text.trim() ||
      !stages.includes(c.stage) ||
      stages.indexOf(c.stage) >= current
    )
      fail('INVALID_STAGE_CONTEXT', 400);
    const text = c.text.trim();
    chars += text.length;
    if (text.length > 30000 || chars > 180000) fail('AGENT_CONTEXT_LIMIT', 413);
    return {
      stage: c.stage,
      title: String(c.title || c.stage).slice(0, 200),
      text,
      provenance: trusted ? c.provenance : 'USER_SUPPLIED',
      ...(trusted ? { sources: c.sources } : {}),
    };
  });
  if (new Set(result.map((c) => c.stage)).size !== result.length)
    fail('INVALID_STAGE_CONTEXT', 400);
  return result;
}
async function stageSnapshot(client, db, ctx, req, stage, selectors = []) {
  const preceding = stages.slice(0, stages.indexOf(stage));
  if (!stages.includes(stage)) fail('INVALID_STAGE', 400);
  if (!Array.isArray(selectors) || selectors.length > 7)
    fail('INVALID_STAGE_CONTEXT', 400);
  const versions = (
    await client.query(
      `SELECT DISTINCT ON (stage) * FROM "${db.schema}".req_versions WHERE tenant_id=$1 AND req_id=$2 AND stage=ANY($3) ORDER BY stage,version DESC`,
      [ctx.tenantId, req.id, preceding],
    )
  ).rows;
  const messages = (
    await client.query(
      `SELECT DISTINCT ON (stage) id,stage,content,revision FROM "${db.schema}".messages WHERE tenant_id=$1 AND req_id=$2 AND stage=ANY($3) AND role='ai' AND status='ok' ORDER BY stage,created_at DESC,id DESC`,
      [ctx.tenantId, req.id, preceding],
    )
  ).rows;
  for (const selected of selectors) {
    if (!selected || !preceding.includes(selected.stage))
      fail('INVALID_STAGE_CONTEXT', 400);
    if (
      selected.messageId &&
      !messages.some(
        (m) =>
          m.stage === selected.stage &&
          m.id === selected.messageId &&
          (selected.revision === undefined || m.revision === selected.revision),
      )
    )
      fail('STALE_REFERENCE');
    if (
      selected.versionId &&
      !versions.some(
        (v) =>
          v.stage === selected.stage &&
          v.public_id === selected.versionId &&
          !v.stale,
      )
    )
      fail('STALE_REFERENCE');
  }
  const blocks = preceding.flatMap((s) => {
    const v = versions.find((v) => v.stage === s),
      m = messages.find((m) => m.stage === s);
    if (!v && !m) return [];
    const confirmed = !!(v?.confirmed_by && v.confirmed_at && !v.stale);
    return [
      {
        stage: s,
        title: s,
        provenance: 'SERVER_SNAPSHOT',
        sources: {
          versionId: v?.public_id ?? null,
          version: v?.version ?? null,
          confirmed,
          stale: !!v?.stale,
          messageId: m?.id ?? null,
          messageRevision: m?.revision ?? null,
        },
        text: [
          v
            ? `【${confirmed ? '已确认版本' : '未确认或失效版本'} ${v.public_id}】\n${JSON.stringify(v.content)}`
            : '',
          m ? `【AI候选，未经业务确认 ${m.id}】\n${m.content}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
  });
  const snapshot = {
    reqId: req.id,
    stage,
    name: req.name,
    goal: req.goal,
    scope: req.scope,
    artifactGroupId: req.current_artifact_group_id ?? null,
    blocks: normalizeStageContext(blocks, stage, true),
  };
  return { snapshot, hash: fingerprint(snapshot) };
}
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
  normalizeStageContext,
  stageSnapshot,
};
