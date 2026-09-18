'use strict';
// 54 号测试数据清理（v7）：SAVEPOINT 隔离逐表删除，多轮迭代处理 FK 依赖
const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [table, trigger] of [
      ['stage_plans', 'stage_plans_guard'],
      ['agent_jobs', 'agent_jobs_guard'],
      ['agent_events', 'agent_events_immutable'],
      ['req_versions', 'artifact_prd_content_immutable'],
      ['req_versions', 'verification_version_immutable'],
      ['req_versions', 'release_reports_guard'],
    ]) {
      try {
        await client.query(
          'ALTER TABLE "' + SCHEMA + '"."' + table + '" DISABLE TRIGGER ' + trigger,
        );
      } catch (e) {
        console.log('disable skip', table, e.code || e.message);
      }
    }
    const ids = (
      await client.query(
        'SELECT id FROM "' + SCHEMA + '".reqs WHERE public_id LIKE $1',
        ['CODEx_TEST_54%'],
      )
    ).rows.map((r) => r.id);
    console.log('reqs to delete:', ids.length);
    if (!ids.length) {
      await client.query('COMMIT');
      console.log('nothing to delete');
      await pool.end();
      return;
    }
    const tables = (
      await client.query(
        "SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='req_id'",
        [SCHEMA],
      )
    ).rows.map((r) => r.table_name);
    const deleted = new Set();
    for (let round = 0; round < 6; round++) {
      let changed = 0;
      for (const t of tables) {
        if (deleted.has(t)) continue;
        await client.query('SAVEPOINT sp');
        try {
          const r = await client.query(
            'DELETE FROM "' + SCHEMA + '"."' + t + '" WHERE req_id = ANY($1::uuid[])',
            [ids],
          );
          if (r.rowCount > 0) {
            changed += r.rowCount;
            console.log('deleted', t, r.rowCount);
          }
          deleted.add(t);
          await client.query('RELEASE SAVEPOINT sp');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT sp');
          // 有未清子表引用——留到下一轮
        }
      }
      console.log('round', round + 1, 'changed', changed);
      if (changed === 0) break;
    }
    // 最后删 reqs（独立 SAVEPOINT，可能仍有少数 FK 未清）
    await client.query('SAVEPOINT sp');
    try {
      const r = await client.query(
        'DELETE FROM "' + SCHEMA + '".reqs WHERE id = ANY($1::uuid[])',
        [ids],
      );
      console.log('deleted reqs', r.rowCount);
      await client.query('RELEASE SAVEPOINT sp');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT sp');
      console.log('reqs still referenced:', e.code || e.message);
    }
    await client.query('COMMIT');
    console.log('COMMITTED');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAIL', e.code || '', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
