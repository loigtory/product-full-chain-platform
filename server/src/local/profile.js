'use strict';
const fs = require('node:fs');
const { resolve, relative, isAbsolute, sep } = require('node:path');
const repo = resolve(__dirname, '../../..');
const prefix = 'CODEx_TEST_M2C_20260913_localuse';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fault(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}
function layout({ scope = 'personal', runId, sourceScope } = {}) {
  if (!['personal', 'source', 'restore'].includes(scope))
    throw fault('LOCAL_PROFILE_INVALID');
  if (
    scope !== 'personal' &&
    (typeof runId !== 'string' ||
      !runId.startsWith(prefix + '_') ||
      !uuid.test(runId.slice(prefix.length + 1)))
  )
    throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
  if (scope === 'personal' && runId !== undefined)
    throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
  if (
    sourceScope !== undefined &&
    (scope !== 'restore' || !['source', 'personal'].includes(sourceScope))
  )
    throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
  const root =
    scope === 'personal'
      ? resolve(repo, '.local/pfc-workbench')
      : resolve(
          repo,
          '.local/local-use-baseline-20260913',
          scope,
          runId,
          ...(scope === 'restore' ? ['app'] : []),
        );
  return Object.freeze({
    scope,
    runId,
    root,
    ...(sourceScope ? { sourceScope } : {}),
    schema:
      scope === 'personal' || sourceScope === 'personal'
        ? 'pfc_workbench'
        : 'codex_test_m2c_20260913_localuse',
    apiPort: scope === 'personal' ? 5188 : scope === 'source' ? 5197 : 5198,
    dbPort: scope === 'restore' ? 5548 : 5432,
    filesRoot:
      scope === 'personal'
        ? resolve(repo, '.local/pfc-workbench-files')
        : resolve(root, 'blobs'),
    backupsRoot:
      scope === 'personal'
        ? resolve(repo, '.local/pfc-workbench-backups')
        : resolve(root, 'backups'),
    profileFile: resolve(root, 'profile.json'),
    usersFile: resolve(root, 'users.json'),
    instanceFile: resolve(root, 'instance.json'),
  });
}
function noLinks(path) {
  const full = resolve(path),
    rel = relative(repo, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw fault('LOCAL_PATH_NOT_AUTHORIZED');
  let current = repo;
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw fault('LOCAL_PATH_LINK');
  }
  return full;
}
function location(file) {
  const full = noLinks(file);
  if (full === layout().profileFile) return layout();
  const rel = relative(
    resolve(repo, '.local/local-use-baseline-20260913'),
    full,
  ).split(sep);
  if (rel[0] === 'source' && rel.length === 3 && rel[2] === 'profile.json')
    return layout({ scope: 'source', runId: rel[1] });
  if (
    rel[0] === 'restore' &&
    rel.length === 4 &&
    rel[2] === 'app' &&
    rel[3] === 'profile.json'
  )
    return layout({ scope: 'restore', runId: rel[1] });
  throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
}
function read(file, ready = true) {
  let target = location(file);
  let data;
  try {
    if (fs.statSync(file).size > 16384) throw Error();
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw fault('LOCAL_PROFILE_REQUIRED');
  }
  if (data.sourceScope !== undefined)
    target = layout({
      scope: target.scope,
      runId: target.runId,
      sourceScope: data.sourceScope,
    });
  if (
    data.format !== 1 ||
    data.scope !== target.scope ||
    data.runId !== target.runId ||
    !uuid.test(data.attemptId || '') ||
    !uuid.test(data.tenantId || '') ||
    !uuid.test(data.memberId || '') ||
    typeof data.ownerName !== 'string' ||
    !data.ownerName.trim() ||
    data.ownerName.length > 160 ||
    !data.verifier ||
    !/^[a-f0-9]{32}$/.test(data.verifier.salt || '') ||
    !/^[a-f0-9]{64}$/.test(data.verifier.digest || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.jwtSecret || '')
  )
    throw fault('LOCAL_PROFILE_INVALID');
  if (target.schema !== 'pfc_workbench' && !data.ownerName.startsWith(prefix))
    throw fault('SYNTHETIC_IDENTITY_REQUIRED');
  if (
    data.marker !==
      (target.schema === 'pfc_workbench'
        ? 'PFC_WORKBENCH_M2C_002'
        : prefix + ':' + data.attemptId) ||
    ![
      'PREPARED',
      'SCHEMA_CREATED',
      'MIGRATED',
      'OWNER_CREATED',
      'READY',
    ].includes(data.state) ||
    (data.ownedOid !== undefined &&
      (!Number.isSafeInteger(data.ownedOid) || data.ownedOid < 1))
  )
    throw fault('LOCAL_PROFILE_INVALID');
  if (ready && data.state !== 'READY') throw fault('INITIALIZATION_INCOMPLETE');
  return Object.freeze({ ...data, ...target });
}
let loaded;
function current() {
  if (!process.env.PFC_LOCAL_PROFILE_FILE) return null;
  if (!loaded) loaded = read(process.env.PFC_LOCAL_PROFILE_FILE);
  return loaded;
}
module.exports = {
  repo,
  prefix,
  layout,
  location,
  read,
  current,
  noLinks,
  fault,
};
