'use strict';
const { readFileSync } = require('node:fs');
const { resolve, relative, isAbsolute } = require('node:path');
const { openDatabase } = require('./persistence/connection');
const { fail } = require('./access');
let database,
  config,
  closing = false,
  workspaceLock,
  stopPromise;
const isPg = () => process.env.PFC_DB === 'pg';
const cleanups = new Set();
async function start() {
  const mode = process.env.PFC_DB || 'memory';
  const personal = require('./local/profile').current();
  if (process.env.PFC_DB_SCHEMA === 'pfc_workbench' && !personal)
    fail('LOCAL_PROFILE_REQUIRED', 503);
  if (personal) require('./local/ops-config').runtimeTarget(personal);
  if (!['pg', 'memory'].includes(mode)) fail('MODE_REQUIRED', 500);
  if (mode === 'memory') return;
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET === 'pfc-dev-secret-change-me'
  )
    fail('JWT_CONFIG_REQUIRED', 500);
  const root = resolve(__dirname, '../..');
  const usersPath = resolve(process.env.PFC_LOCAL_USERS_FILE || '');
  const rel = relative(resolve(root, '.local'), usersPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    fail('LOCAL_USERS_CONFIG_REQUIRED', 500);
  let users;
  try {
    users = JSON.parse(readFileSync(usersPath, 'utf8'));
  } catch {
    fail('LOCAL_USERS_CONFIG_REQUIRED', 500);
  }
  if (
    !Array.isArray(users) ||
    !users.length ||
    users.some(
      (u) =>
        typeof u.name !== 'string' ||
        !u.name.trim() ||
        u.name !== u.name.trim() ||
        u.name.length > 160 ||
        !['owner', 'executor', 'viewer'].includes(u.role) ||
        !/^[-a-f0-9]{36}$/.test(u.tenantId || ''),
    )
  )
    fail('LOCAL_USERS_CONFIG_REQUIRED', 500);
  if (new Set(users.map((u) => u.name)).size !== users.length)
    fail('LOCAL_USERS_CONFIG_REQUIRED', 500);
  const quota = Number(process.env.PFC_FILE_QUOTA_BYTES);
  if (!Number.isSafeInteger(quota) || quota < 1 || quota > 104857600)
    fail('FILE_QUOTA_CONFIG_REQUIRED', 500);
  const filesRoot = resolve(process.env.PFC_FILES_ROOT || '');
  const fileRel = relative(
    resolve(
      root,
      process.env.PFC_DB_SCHEMA === 'codex_test_m2c_20260913_release'
        ? '.local/m2c-4-release-observation-20260913/files'
        : process.env.PFC_DB_SCHEMA === 'codex_test_m2c_20260913_verification'
          ? '.local/r3-test-acceptance-20260913/files'
          : process.env.PFC_DB_SCHEMA === 'codex_test_m2c_20260913_artifacts'
            ? '.local/r2-artifacts-20260913/files'
            : process.env.PFC_DB_SCHEMA === 'codex_test_m2c_20260913_governance'
              ? '.local/m2c-3-governance-20260913/files'
              : '.local/m2c-2-domain-20260912/files',
    ),
    filesRoot,
  );
  const workbenchTarget =
    process.env.PFC_DB_SCHEMA === 'pfc_workbench' &&
    process.env.PFC_AUTHORIZED_SCHEMA === 'pfc_workbench';
  const validFiles = personal
    ? filesRoot === personal.filesRoot
    : workbenchTarget
      ? filesRoot === resolve(root, '.local/pfc-workbench-files')
      : !!fileRel && !fileRel.startsWith('..') && !isAbsolute(fileRel);
  if (!validFiles) fail('FILES_TARGET_NOT_AUTHORIZED', 500);
  if (
    personal &&
    (users.length !== 1 ||
      users[0].name !== personal.ownerName ||
      users[0].tenantId !== personal.tenantId ||
      users[0].role !== 'owner')
  )
    fail('LOCAL_USERS_CONFIG_REQUIRED', 503);
  config = { users, quota, filesRoot, personal };
  database = await openDatabase({
    mode: 'pg',
    connectionString: process.env.DATABASE_URL,
    schema: process.env.PFC_DB_SCHEMA,
    authorizedSchema: process.env.PFC_AUTHORIZED_SCHEMA,
    targetVersion: '006',
  });
  const tenants = (
    await database.pool.query(`SELECT id FROM "${database.schema}".tenants`)
  ).rows.map((t) => t.id);
  if (users.some((u) => !tenants.includes(u.tenantId))) {
    await database.close();
    fail('TENANT_NOT_READY', 500);
  }
  await require('./domain/membership-policy').assertOwners(database, users);
  if (personal) {
    const owned = (
      await database.pool.query(
        "SELECT oid,obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
        [database.schema],
      )
    ).rows[0];
    if (
      !owned ||
      owned.oid !== personal.ownedOid ||
      owned.marker !== personal.marker
    )
      fail('LOCAL_OWNERSHIP_MISMATCH', 503);
    workspaceLock = await require('./local/workspace-lock').acquire(
      personal,
      () => {
        closing = true;
        process.emit('SIGTERM');
      },
    );
    onClose(() => require('./local/session-store').current()?.close());
  }
}
function db() {
  if (!database || closing) fail('STORAGE_UNAVAILABLE', 503);
  return database;
}
async function health() {
  if (!isPg()) return { ok: true, storage: 'memory', domainPersistence: false };
  await require('./persistence/migrations').assertReady(db());
  return {
    ok: true,
    readiness: true,
    storage: 'pg',
    domainPersistence: true,
    schemaVersion: '006',
    ...(config.personal
      ? { profile: 'personal', identityMode: 'local-session', realTools: false }
      : {}),
    supportedActions: [
      'releaseObservation',
      'testing',
      'productAcceptance',
      'releaseInputs',
      'linkedArtifacts',
      'requirements',
      'versions',
      'questions',
      'materials',
      'messages',
      'simulatedRuns',
      'leases',
      'notices',
      'members',
      'caps',
      'bindings',
      'projects',
      'knowledge',
      'audit',
      'budgets',
      'planContext',
    ],
    unsupportedReason:
      '测试、发布、回退与观察为具名人工登记；平台未执行或核验真实工具及外部效果',
  };
}
async function stop() {
  if (stopPromise) return stopPromise;
  closing = true;
  stopPromise = (async () => {
    try {
      for (const fn of cleanups) await fn();
      cleanups.clear();
      await database?.close();
    } finally {
      await workspaceLock?.release();
    }
  })();
  return stopPromise;
}
function onClose(fn) {
  cleanups.add(fn);
}
module.exports = {
  start,
  stop,
  health,
  db,
  isPg,
  config: () => config,
  onClose,
};
