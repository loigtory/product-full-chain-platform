'use strict';
/* =====================================================================
 * PFC Server · M1 单机闭环入口
 * 运行：npm start（环境变量见 .env.example；默认内存态降级，配置 DATABASE_URL 启用 PostgreSQL）
 * 契约：《13-M1接口清单与开发说明》；领域 API 骨架 + state/batch 桥接。
 * ===================================================================== */
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { authMiddleware } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/* 健康检查（无需鉴权） */
app.get('/api/health', (req, res) =>
  res.json({ ok: true, storage: db.storageMode(), at: new Date().toISOString() }),
);

/* 开放路由 */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contract', authMiddleware, require('./routes/contract'));

/* 受保护路由（M1 全部需 Bearer token） */
app.use('/api/state', authMiddleware, require('./routes/state'));
app.use('/api/batch', authMiddleware, require('./routes/batch'));
app.use('/api/reqs', authMiddleware, require('./routes/reqs'));
app.use('/api/runs', authMiddleware, require('./routes/runs'));
app.use('/api/leases', authMiddleware, require('./routes/leases'));
app.use('/api/bridges', authMiddleware, require('./routes/bridges'));
app.use('/api/notices', authMiddleware, require('./routes/notices'));

/* 未注册路由 → 404 */
app.use((req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', msg: '接口不存在：' + req.method + ' ' + req.path } }),
);

/* 统一错误处理（不泄漏堆栈） */
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: { code: 'INTERNAL', msg: '服务内部错误' } });
});

const PORT = Number(process.env.PORT || 5188);
async function main() {
  await db.connect();
  const server = app.listen(PORT, '127.0.0.1', () =>
    console.log('[pfc-server] http://127.0.0.1:' + PORT + ' · storage=' + db.storageMode()),
  );
  require('./ws').init(server); // /ws/bridge + /ws/web（M2b）
}
main().catch((e) => {
  console.error('[pfc-server] 启动失败：' + e.message);
  process.exit(1);
});
