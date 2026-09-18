'use strict';
// 55 号：worker 装载查询验证（enabledSkillsForStage 直连 DB）
const { Pool } = require('pg');
const { openDatabase } = require('./src/persistence/connection');
(async () => {
  const db = await openDatabase({
    mode: 'pg',
    connectionString:
      'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    targetVersion: '009',
    requireReady: false,
  });
  const svc = require('./src/agent/stage-capabilities-config');
  const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';
  let pass = 0, fail = 0;
  function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, JSON.stringify(extra)); }
  }
  for (const stage of ['idea', 'dev', 'observe']) {
    const names = await svc.enabledSkillsForStage(db, TENANT, stage);
    console.log('ENABLED_SKILLS', stage, '=>', names.join(', '));
    check(stage + ' returns array', Array.isArray(names));
  }
  const idea = await svc.enabledSkillsForStage(db, TENANT, 'idea');
  check('idea has grill-me', idea.includes('grill-me'), idea);
  check('idea sorted by priority', idea[0] === 'grill-me', idea);
  const dev = await svc.enabledSkillsForStage(db, TENANT, 'dev');
  check('dev has 4 skills', dev.length === 4, dev);
  await db.close();
  console.log('\nWORKER_LOAD ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
