'use strict';
// 55 号诊断：定位 migrate-55 MIGRATION_NOT_READY 的具体失败检查
const { openDatabase } = require('./src/persistence/connection');
const { withTransaction } = require('./src/persistence/transaction');
const migrations = require('./src/persistence/migrations');
(async () => {
  const db = await openDatabase({
    mode: 'pg',
    connectionString: 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    targetVersion: '009',
    requireReady: false,
  });
  await withTransaction(db, async (client) => {
    console.log('search_path', (await client.query('SHOW search_path')).rows[0].search_path);
    const rows = (
      await client.query('SELECT version,checksum FROM "pfc_workbench".schema_migrations ORDER BY version')
    ).rows;
    console.log('versions', rows.map((r) => r.version).join(','));
    try {
      await migrations.assertReady(db, client, '008');
      console.log('ASSERT_008_OK');
    } catch (e) {
      console.log('ASSERT_008_FAIL', e.code, e.message);
    }
    try {
      await migrations.assertReady(db, client, '009');
      console.log('ASSERT_009_OK');
    } catch (e) {
      console.log('ASSERT_009_FAIL', e.code, e.message);
    }
  });
  await db.close();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
