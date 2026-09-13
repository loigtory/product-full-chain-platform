'use strict';
const access = require('../access'),
  { fingerprint } = require('../persistence/commands'),
  prototype = require('./prototype-spec');
function bounded(value, limit = 524288) {
  if (Buffer.byteLength(JSON.stringify(value)) > limit)
    access.fail('ARTIFACT_LIMIT_EXCEEDED', 413);
  return value;
}
function object(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    access.fail('INVALID_ARTIFACT', 400);
}
function stableId(value) {
  if (typeof value !== 'string' || !/^[-A-Za-z0-9_]{1,80}$/.test(value))
    access.fail('INVALID_ARTIFACT', 400);
}
function validateBundle(input) {
  object(input, ['prototype', 'prd', 'acceptance', 'rules']);
  bounded(input);
  const missing = [];
  for (const kind of ['prototype', 'prd', 'acceptance'])
    if (!input[kind]) missing.push(kind);
  if (input.prototype) {
    const p = input.prototype;
    object(p, ['representation', 'spec', 'materialId', 'version']);
    if (p.representation === 'spec') {
      if (p.materialId !== undefined || p.version !== undefined)
        access.fail('INVALID_ARTIFACT', 400);
      prototype.validate(p.spec);
    } else if (p.representation === 'file') {
      access.text(p.materialId, 160, true);
      if (!Number.isInteger(p.version) || p.version < 1 || p.spec !== undefined)
        access.fail('INVALID_ARTIFACT', 400);
    } else access.fail('INVALID_ARTIFACT', 400);
  }
  if (input.prd) {
    object(input.prd, ['title', 'fields']);
    access.text(input.prd.title, 160, true);
    const fields = input.prd.fields;
    if (!Array.isArray(fields) || !fields.length || fields.length > 40)
      access.fail('INVALID_ARTIFACT', 400);
    for (const f of fields) {
      object(f, ['name', 'value']);
      access.text(f.name, 160, true);
      access.text(f.value, 16000, true);
    }
  }
  const rules = input.rules || [];
  if (!Array.isArray(rules) || rules.length > 100)
    access.fail('INVALID_ARTIFACT', 400);
  const ruleIds = new Set();
  for (const r of rules) {
    object(r, ['ruleId', 'fieldIndex']);
    stableId(r.ruleId);
    if (
      ruleIds.has(r.ruleId) ||
      !Number.isInteger(r.fieldIndex) ||
      r.fieldIndex < 0 ||
      (input.prd && r.fieldIndex >= input.prd.fields.length)
    )
      access.fail('INVALID_RULE_REFERENCE', 400);
    ruleIds.add(r.ruleId);
  }
  if (input.acceptance) {
    object(input.acceptance, ['items']);
    const items = input.acceptance.items;
    if (!Array.isArray(items) || !items.length || items.length > 100)
      access.fail('INVALID_ARTIFACT', 400);
    const ids = new Set();
    for (const a of items) {
      object(a, [
        'acId',
        'ruleId',
        'scenario',
        'precondition',
        'steps',
        'expected',
      ]);
      stableId(a.acId);
      stableId(a.ruleId);
      if (ids.has(a.acId)) access.fail('INVALID_ARTIFACT', 400);
      ids.add(a.acId);
      for (const k of ['scenario', 'precondition', 'expected'])
        access.text(a[k], 4000, true);
      if (!Array.isArray(a.steps) || !a.steps.length || a.steps.length > 40)
        access.fail('INVALID_ARTIFACT', 400);
      a.steps.forEach((s) => access.text(s, 2000, true));
      if (input.prd && !ruleIds.has(a.ruleId))
        access.fail('INVALID_RULE_REFERENCE', 400);
    }
    if (
      input.prd &&
      rules.some((r) => !items.some((a) => a.ruleId === r.ruleId))
    )
      access.fail('INVALID_RULE_REFERENCE', 400);
  }
  if (input.prototype?.representation === 'spec' && input.prd)
    for (const p of input.prototype.spec.pages)
      for (const n of p.nodes)
        if (n.ruleId && !ruleIds.has(n.ruleId))
          access.fail('INVALID_RULE_REFERENCE', 400);
  if (!rules.length) missing.push('rules');
  return {
    missing,
    content: structuredClone(input),
    status: missing.length ? 'INCOMPLETE' : 'READY',
  };
}
function scope(input) {
  object(input, [
    'goal',
    'files',
    'capabilityIds',
    'validation',
    'exit',
    'rollback',
  ]);
  for (const key of ['goal', 'files', 'validation', 'exit', 'rollback'])
    access.text(input[key], 8000, true);
  if (
    !Array.isArray(input.capabilityIds) ||
    input.capabilityIds.length > 100 ||
    new Set(input.capabilityIds).size !== input.capabilityIds.length
  )
    access.fail('INVALID_SCOPE', 400);
  input.capabilityIds.forEach((x) => access.text(x, 160, true));
  return structuredClone(input);
}
module.exports = {
  bounded,
  object,
  validateBundle,
  scope,
  same: (a, b) => fingerprint(a) === fingerprint(b),
};
