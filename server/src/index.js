'use strict';
/* =====================================================================
 * PFC Server · M1 单机闭环入口
 * 运行：npm start（显式 PFC_DB=memory|pg；PG 必须先迁移，禁止自动降级）
 * 契约：《13-M1接口清单与开发说明》；领域 API 骨架 + state/batch 桥接。
 * ===================================================================== */
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { authMiddleware } = require('./auth');

const app = express();
app.use(cors());
const runtime = require('./runtime');
app.use((req, res, next) =>
  express.json({
    limit: runtime.isPg()
      ? /\/materials(?:\/[^/]+\/versions)?$/.test(req.path)
        ? '16mb'
        : '1mb'
      : '50mb',
  })(req, res, next),
);
app.use('/api', (req, res, next) => {
  if (!runtime.isPg() || /^\/(health|auth)(\/|$)/.test(req.path)) return next();
  authMiddleware(req, res, (error) => {
    if (error) return next(error);
    try {
      require('./access').current(
        !['GET', 'HEAD'].includes(req.method) &&
          !req.path.startsWith('/notices') &&
          !req.path.endsWith('/verify'),
      );
      if (
        (req.path === '/state' && req.method !== 'GET') ||
        req.path === '/batch'
      )
        require('./access').fail(
          'DOMAIN_WRITE_REQUIRED',
          409,
          '请使用领域接口保存，PG 不接受整树快照',
        );
      next();
    } catch (e) {
      next(e);
    }
  });
});

/* 健康检查（无需鉴权） */
app.get('/api/health', async (req, res, next) => {
  try {
    res.json({ ...(await runtime.health()), at: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

/* 开放路由 */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contract', authMiddleware, require('./routes/contract'));

/* 受保护路由（M1 全部需 Bearer token） */
app.use('/api/state', authMiddleware, require('./routes/state'));
app.use('/api/batch', authMiddleware, require('./routes/batch'));
app.use('/api/reqs', authMiddleware, require('./routes/artifacts'));
app.use('/api/reqs', authMiddleware, require('./routes/reqs'));
app.use('/api/runs', authMiddleware, require('./routes/runs'));
app.use('/api/leases', authMiddleware, require('./routes/leases'));
app.use('/api/bridges', authMiddleware, require('./routes/bridges'));
app.use('/api/notices', authMiddleware, require('./routes/notices'));

if (runtime.isPg()) app.use('/api/members', require('./routes/members'));
if (runtime.isPg()) app.use('/api/caps', require('./routes/caps'));
if (runtime.isPg()) app.use('/api/bindings', require('./routes/bindings'));
if (runtime.isPg()) app.use('/api/projects', require('./routes/projects'));
if (runtime.isPg()) app.use('/api/knowledge', require('./routes/knowledge'));
if (runtime.isPg()) app.use('/api', require('./routes/governance-read'));

/* 未注册路由 → 404 */
app.use((req, res) =>
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      msg: '接口不存在：' + req.method + ' ' + req.path,
    },
  }),
);

/* 统一错误处理（不泄漏堆栈） */
app.use((err, req, res, next) => {
  const unavailable = runtime.isPg() && !err.status;
  const status = err.status || (unavailable ? 503 : 500);
  const code =
    err.type === 'entity.too.large'
      ? 'PAYLOAD_TOO_LARGE'
      : err.type === 'entity.parse.failed'
        ? 'INVALID_JSON'
        : err.code && err.status
          ? err.code
          : unavailable
            ? 'STORAGE_UNAVAILABLE'
            : 'INTERNAL';
  console.error('[error]', code);
  res.status(status).json({
    error: {
      code,
      msg:
        err.status && err.code
          ? err.message
          : err.status && err.status < 500
            ? '请求格式或大小无效'
            : unavailable
              ? '存储暂不可用，请保留输入并重试原命令'
              : '服务内部错误',
    },
  });
});

const PORT = Number(process.env.PORT || 5188);
async function main() {
  await db.connect();
  if (runtime.isPg()) {
    await require('./domain/execution-service').recover();
    await require('./domain/conversation-service').recover();
  }
  const server = app.listen(PORT, '127.0.0.1', () =>
    console.log(
      '[pfc-server] http://127.0.0.1:' +
        PORT +
        ' · storage=' +
        db.storageMode(),
    ),
  );
  require('./ws').init(server);
  if (runtime.isPg()) require('./domain/events').start();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    require('./ws').close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await runtime.stop();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
main().catch((e) => {
  console.error(
    '[pfc-server] 启动失败：' +
      (/^[A-Z_0-9]+$/.test(e.code || '') ? e.code : 'STARTUP_FAILED'),
  );
  void runtime.stop().finally(() => process.exit(1));
});
