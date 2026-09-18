'use strict';
const fs = require('node:fs');
const { resolve, relative, isAbsolute, sep } = require('node:path');
const repo = resolve(__dirname, '../../..');
const prefix = 'CODEx_TEST_M2C_20260913_localuse';
const remediationPrefix = 'CODEx_TEST_AI_FIX_20260916';
const hostPrefix = 'CODEx_TEST_AI_HOST_20260917';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fault(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}
function layout({
  scope = 'personal',
  runId,
  sourceScope,
  targetVersion = '006',
  fixtureScope = 'ops',
} = {}) {
  if (!['006', '007', '008', '009'].includes(targetVersion))
    throw fault('LOCAL_VERSION_INVALID');
  const host = typeof runId === 'string' && runId.startsWith(hostPrefix + '_');
  const remediation =
    host ||
    (typeof runId === 'string' && runId.startsWith(remediationPrefix + '_'));
  const activePrefix = host
    ? hostPrefix
    : remediation
      ? remediationPrefix
      : prefix;
  if (
    !['api', 'ops', 'browser'].includes(fixtureScope) ||
    (remediation && scope === 'restore' && fixtureScope !== 'ops')
  )
    throw fault('LOCAL_TARGET_NOT_AUTHORIZED');
  if (!['personal', 'source', 'restore'].includes(scope))
    throw fault('LOCAL_PROFILE_INVALID');
  if (
    scope !== 'personal' &&
    (typeof runId !== 'string' ||
      !runId.startsWith(activePrefix + '_') ||
      !uuid.test(runId.slice(activePrefix.length + 1)))
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
      : remediation
        ? resolve(
            repo,
            host
              ? '.local/ai-tools-host-exec-20260917'
              : '.local/ai-tools-remediation-20260916',
            runId,
            scope === 'source' ? fixtureScope : 'restore/app',
          )
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
    targetVersion,
    remediation,
    host,
    fixtureScope,
    ...(sourceScope ? { sourceScope } : {}),
    schema:
      scope === 'personal' || sourceScope === 'personal'
        ? 'pfc_workbench'
        : remediation
          ? 'codex_test_ai_fix_20260916_' + fixtureScope
          : 'codex_test_m2c_20260913_localuse',
    apiPort:
      scope === 'personal'
        ? 5188
        : scope === 'source'
          ? remediation
            ? fixtureScope === 'browser'
              ? 5204
              : 5203
            : 5197
          : remediation
            ? 5205
            : 5198,
    dbPort: scope === 'restore' ? (remediation ? 5549 : 5548) : 5432,
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
  const hostRel = relative(
    resolve(repo, '.local/ai-tools-host-exec-20260917'),
    full,
  );
  const host = !hostRel.startsWith('..') && !isAbsolute(hostRel);
  const fix = relative(
    resolve(
      repo,
      host
        ? '.local/ai-tools-host-exec-20260917'
        : '.local/ai-tools-remediation-20260916',
    ),
    full,
  ).split(sep);
  if (
    fix.length === 3 &&
    ['api', 'ops', 'browser'].includes(fix[1]) &&
    fix[2] === 'profile.json'
  )
    return layout({ scope: 'source', runId: fix[0], fixtureScope: fix[1] });
  if (
    fix.length === 4 &&
    fix[1] === 'restore' &&
    fix[2] === 'app' &&
    fix[3] === 'profile.json'
  )
    return layout({ scope: 'restore', runId: fix[0] });
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
  if (data.sourceScope !== undefined || data.targetVersion !== undefined)
    target = layout({
      scope: target.scope,
      runId: target.runId,
      sourceScope: data.sourceScope,
      targetVersion: data.targetVersion ?? '006',
      fixtureScope: target.fixtureScope,
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
  if (
    target.schema !== 'pfc_workbench' &&
    !data.ownerName.startsWith(
      target.host
        ? hostPrefix
        : target.remediation
          ? remediationPrefix
          : prefix,
    )
  )
    throw fault('SYNTHETIC_IDENTITY_REQUIRED');
  if (
    data.marker !==
      (target.schema === 'pfc_workbench'
        ? 'PFC_WORKBENCH_M2C_002'
        : (target.remediation ? 'CODEx_TEST_M2C_AI_FIX_20260916' : prefix) +
          ':' +
          data.attemptId) ||
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
  remediationPrefix,
  layout,
  location,
  read,
  current,
  noLinks,
  fault,
};
