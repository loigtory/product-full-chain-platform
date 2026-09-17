const { readFileSync } = require('fs');
const { parseEnv } = require('util');
const { Pool } = require('pg');
const conn = parseEnv(readFileSync('../.env.local', 'utf8')).DATABASE_URL;
(async () => {
  const p = new Pool({ connectionString: conn, max: 1 });
  const schemas = (
    await p.query(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'codex_test_ai_tools_20260914_%'",
    )
  ).rows;
  console.log('残留 schemas:', schemas.map((r) => r.nspname));
  for (const s of schemas) {
    const marker = (
      await p.query(
        "SELECT obj_description(oid,'pg_namespace') m FROM pg_namespace WHERE nspname=$1",
        [s.nspname],
      )
    ).rows[0]?.m;
    const allowed = [
      'CODEx_TEST_M2C_AI_TOOLS_20260914_',
      'CODEx_TEST_M2C_AI_HOST_',
      'CODEx_TEST_M2C_AI_TOOLS_20260916_',
    ];
    if (marker && allowed.some((a) => String(marker).startsWith(a))) {
      await p.query(`DROP SCHEMA "${s.nspname}" CASCADE`);
      console.log('已删除:', s.nspname);
    } else {
      console.log('跳过（marker 不匹配）:', s.nspname, marker);
    }
  }
  await p.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
