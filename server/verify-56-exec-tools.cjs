// 56 号验收：EXEC 工具热插拔 —— host 工具注册表白名单 + hostThreadParams 装配 + 配置装载
// 用法：node verify-56-exec-tools.cjs
// 依赖：PG 运行中、迁移到 009、seed-55 已执行（dev 阶段 tool 配置存在）
'use strict';
const { resolve } = require('node:path');
const projectRoot = __dirname;
const registry = require(resolve(projectRoot, 'src/agent/host-tools-registry.js'));
const config = require(resolve(projectRoot, 'src/agent/config.js'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
};

console.log('A. host-tools-registry 白名单');
{
  // 核心 5 工具恒在
  t('core 5 READY', registry.coreToolNames().length === 5, registry.coreToolNames());
  // resolveHostTools(core) 返回 5 个函数定义
  const coreDefs = registry.resolveHostTools(registry.coreToolNames());
  t('core resolve=5', coreDefs.length === 5 && coreDefs.every((d) => d.type === 'function' && d.inputSchema?.type === 'object'));
  // PENDING 工具不注入
  const pendingDefs = registry.resolveHostTools(['codex-cli', 'zed', 'vscode']);
  t('pending 不注入', pendingDefs.length === 0, pendingDefs);
  // 未知名过滤
  t('未知名过滤', registry.resolveHostTools(['nope', '随便']).length === 0);
  // 别名解析 + 去重
  t('别名+去重', registry.resolveHostTools(['codex-cli', 'codex', 'pfc_read_file']).length === 1);
  // 状态查询
  t('statusOf', registry.statusOf('codex-cli') === 'PENDING_HOST_SUPPORT' && registry.statusOf('pfc_read_file') === 'READY' && registry.statusOf('x') === 'UNKNOWN');
}

console.log('B. hostThreadParams 装配（无 DB）');
{
  const inventory = {
    data: [{ skills: [{ path: 'C:/x/SKILL.md' }], errors: [] }],
  };
  // 不带 extraTools：5 个核心工具
  const p0 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory);
  t('默认=5 核心工具', p0.dynamicTools.length === 5, p0.dynamicTools.map((d) => d.name));
  t('guide 引用 PFC host tools', /PFC host tools/.test(p0.baseInstructions));
  // 带 READY extra：5+1=6；带 PENDING：仍 5
  const p1 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['pfc_read_file']);
  t('重复 core 不重复注入', p1.dynamicTools.length === 5);
  const p2 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['codex-cli']);
  t('PENDING 不注入=5', p2.dynamicTools.length === 5);
  const p3 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['nope']);
  t('未知名=5', p3.dynamicTools.length === 5);
}

console.log('C. 配置装载（PG，迁移 009 + seed-55）');
(async () => {
  const { openDatabase } = require('./src/persistence/connection');
  const db = await openDatabase({
    mode: 'pg',
    connectionString:
      'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
    schema: 'pfc_workbench',
    authorizedSchema: 'pfc_workbench',
    targetVersion: '009',
    requireReady: false,
  });
  const cfg = require('./src/agent/stage-capabilities-config.js');
  const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';
  try {
    const names = await cfg.enabledHostToolsForStage(db, TENANT, 'dev');
    t('dev 阶段 tool 名称读取', Array.isArray(names));
    const resolved = registry.resolveHostTools(names);
    t('dev 配置经白名单解析无注入（终端类 PENDING）', resolved.length === 0, resolved);
    // 模拟注册 READY 工具在配置里 → 可注入（白名单语义单测）
    const mock = registry.resolveHostTools(['pfc_read_file', 'codex-cli', 'codex-cli']);
    t('混合配置仅注入 READY', mock.length === 1, mock.map((d) => d.name));
  } catch (e) {
    t('DB 装载', false, e.message);
  } finally {
    await db.close();
    console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
