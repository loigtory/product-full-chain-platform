'use strict';
// 55 号：迁移 pfc_workbench 到 009（stage_capabilities 阶段能力配置中心）
const { openDatabase } = require('./src/persistence/connection');
(async () => {
  const db = await openDatabase({
    mode: 'pg',
    connectionString: 'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    targetVersion: '009',
    requireReady: false,
  });
  const result = await require('./src/persistence/migrations').migrate(db, {
    targetVersion: '009',
  });
  console.log('migrate', JSON.stringify(result));
  await db.close();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
