import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
export async function initializeMembers(db, users) {
  if (db.targetVersion !== '003')
    throw Object.assign(Error(), { code: 'MIGRATION_VERSION_INVALID' });
  if (
    !Array.isArray(users) ||
    !users.length ||
    users.some(
      (u) =>
        !/^[-a-f0-9]{36}$/.test(u.tenantId || '') ||
        typeof u.name !== 'string' ||
        !u.name.trim() ||
        u.name !== u.name.trim() ||
        u.name.length > 160 ||
        !['owner', 'executor', 'viewer'].includes(u.role),
    ) ||
    new Set(users.map((u) => u.tenantId + ':' + u.name)).size !== users.length
  )
    throw Object.assign(Error(), { code: 'LOCAL_USERS_CONFIG_REQUIRED' });
  const repo = require('../src/persistence/members'),
    { withTransaction } = require('../src/persistence/transaction');
  await require('../src/persistence/migrations').assertReady(db);
  return withTransaction(db, async (client) => {
    const result = [];
    for (const tenantId of [...new Set(users.map((u) => u.tenantId))].sort()) {
      await repo.lockTenant(client, db, tenantId);
      for (const u of users.filter((u) => u.tenantId === tenantId)) {
        const previous = await repo.byName(client, db, {
          tenantId,
          actor: u.name,
        });
        const row = previous || (await repo.insert(client, db, tenantId, u));
        result.push({ id: row.public_id, created: !previous });
      }
      if (
        !(await repo.owners(client, db, { tenantId })).some((o) =>
          users.some((u) => u.tenantId === tenantId && u.name === o.name),
        )
      )
        throw Object.assign(Error(), { code: 'LAST_OWNER_REQUIRED' });
    }
    return result;
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let db;
  try {
    if (
      process.argv.length !== 6 ||
      process.argv[2] !== '--schema' ||
      process.argv[4] !== '--users'
    )
      throw Object.assign(Error(), { code: 'BAD_ARGUMENTS' });
    const file = resolve(process.argv[5]),
      rel = relative(resolve(import.meta.dirname, '../../.local'), file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw Object.assign(Error(), { code: 'LOCAL_USERS_CONFIG_REQUIRED' });
    db = await require('../src/persistence/connection').openDatabase({
      mode: 'pg',
      connectionString: process.env.DATABASE_URL,
      schema: process.argv[3],
      authorizedSchema: process.env.PFC_M2C_AUTHORIZED_SCHEMA,
      targetVersion: '003',
    });
    console.log(
      JSON.stringify({
        status: 'PASS',
        members: await initializeMembers(
          db,
          JSON.parse(readFileSync(file, 'utf8')),
        ),
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        status: 'FAIL',
        code: /^[A-Z_0-9]+$/.test(e.code || '')
          ? e.code
          : 'INITIALIZATION_FAILED',
      }),
    );
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
