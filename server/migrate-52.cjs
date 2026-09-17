'use strict';
// 52 号：迁移 pfc_workbench 到 008（stage_plans）
const { openDatabase } = require('./src/persistence/connection');
(async () => {
  const db = await openDatabase({
    mode: 'pg',
    connectionString: 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    targetVersion: '008',
    requireReady: false,
  });
  const result = await require('./src/persistence/migrations').migrate(db, {
    targetVersion: '008',
  });
  console.log('migrate', JSON.stringify(result));
  await db.close();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
