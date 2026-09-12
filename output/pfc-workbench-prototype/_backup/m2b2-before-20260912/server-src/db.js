'use strict';
/* =====================================================================
 * 存储层：PostgreSQL（正式） + 内存态降级（演示，无 PG 时）
 * 桥接表 app_state：保存前端整棵状态树（P.s JSON），M1 前端 api 模式的载体；
 * 正式领域表由 m1-schema.sql 建库（M1 后段领域 API 逐个落正式表）。
 * 诚实标注：M1 以状态树快照为持久化载体，领域表已建好待领域 API 逐步接入。
 * ===================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const STATE_KEY = 'pfc.state';
let pool = null;
let mode = 'memory'; // pg | memory
const mem = new Map();

function chooseMode() {
  const want = String(process.env.PFC_DB || 'auto').toLowerCase();
  return want === 'pg' ? 'pg' : want === 'memory' ? 'memory' : 'auto';
}

async function connect() {
  const want = chooseMode();
  const url = process.env.DATABASE_URL || '';
  if (want !== 'memory' && url) {
    try {
      pool = new Pool({ connectionString: url, max: 5 });
      await pool.query('SELECT 1');
      await ensureSchema();
      mode = 'pg';
      console.log('[db] PostgreSQL 已连接，领域表已就绪（m1-schema.sql）');
      return;
    } catch (e) {
      console.warn('[db] PostgreSQL 连接失败：' + e.message + ' → 降级内存态（仅演示）');
      pool = null;
    }
  }
  mode = 'memory';
  console.log('[db] 内存态存储（无 PostgreSQL；设置 DATABASE_URL 启用正式库）');
}

async function ensureSchema() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'm1-schema.sql'),
    'utf8',
  );
  await pool.query(sql);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS app_state(
       key text PRIMARY KEY,
       value jsonb NOT NULL,
       revision bigint NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function getState() {
  if (mode === 'pg') {
    const r = await pool.query('SELECT value FROM app_state WHERE key=$1', [
      STATE_KEY,
    ]);
    return r.rows[0] ? r.rows[0].value : null;
  }
  return mem.get(STATE_KEY) || null;
}

async function saveState(value, revision = 0) {
  if (mode === 'pg') {
    await pool.query(
      `INSERT INTO app_state(key, value, revision, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value=$2, revision=$3, updated_at=now()`,
      [STATE_KEY, JSON.stringify(value), revision],
    );
    return;
  }
  mem.set(STATE_KEY, JSON.parse(JSON.stringify(value)));
}

async function removeState() {
  if (mode === 'pg') {
    await pool.query('DELETE FROM app_state WHERE key=$1', [STATE_KEY]);
    return;
  }
  mem.delete(STATE_KEY);
}

function storageMode() {
  return mode;
}

module.exports = { connect, getState, saveState, removeState, storageMode, STATE_KEY };
