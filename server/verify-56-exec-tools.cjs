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
  t('core 2 READY（58-C：命令工具移交 codex_cli）', registry.coreToolNames().length === 2, registry.coreToolNames());
  // resolveHostTools(core) 返回 5 个函数定义
  const coreDefs = registry.resolveHostTools(registry.coreToolNames());
  t('core resolve=2', coreDefs.length === 2 && coreDefs.every((d) => d.type === 'function' && d.inputSchema?.type === 'object'));
  // 60 号后：zed/vscode 已提升 READY（terminal 语义），PENDING 语义暂无承载工具
  const pendingDefs = registry.resolveHostTools(['zed', 'vscode']);
  t('READY(zed/vscode) 注入=2', pendingDefs.length === 2 && pendingDefs.every((d) => ['zed_terminal', 'vscode_terminal'].includes(d.name)), pendingDefs.map((d) => d.name));
  // 未知名过滤
  t('未知名过滤', registry.resolveHostTools(['nope', '随便']).length === 0);
  // 别名解析 + 去重（codex-cli/codex 同一工具；与 READY core 可并存）
  const alias = registry.resolveHostTools(['codex-cli', 'codex', 'pfc_read_file']);
  t('别名+去重', alias.length === 2 && alias.some((d) => d.name === 'codex_cli'), alias.map((d) => d.name));
  // 状态查询
  t('statusOf', registry.statusOf('codex-cli') === 'READY' && registry.statusOf('zed') === 'READY' && registry.statusOf('vscode') === 'READY' && registry.statusOf('x') === 'UNKNOWN');
}

console.log('B. hostThreadParams 装配（无 DB）');
{
  const inventory = {
    data: [{ skills: [{ path: 'C:/x/SKILL.md' }], errors: [] }],
  };
  // 不带 extraTools：5 个核心工具
  const p0 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory);
  t('默认=2 核心工具', p0.dynamicTools.length === 2, p0.dynamicTools.map((d) => d.name));
  t('guide 引用 PFC host tools', /PFC host tools/.test(p0.baseInstructions));
  // 带 READY extra：5+1=6；重复 core 不重复注入
  const p1 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['pfc_read_file']);
  t('重复 core 不重复注入', p1.dynamicTools.length === 2);
  const p2 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['zed']);
  t('READY(zed) 注入=3', p2.dynamicTools.length === 3 && p2.dynamicTools.some((d) => d.name === 'zed_terminal'), p2.dynamicTools.map((d) => d.name));
  const p3 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['nope']);
  t('未知名=2', p3.dynamicTools.length === 2);
  const p4 = config.hostThreadParams({ model: 'codex' }, process.cwd(), inventory, ['codex-cli']);
  t('codex-cli(READY) 注入=3', p4.dynamicTools.length === 3 && p4.dynamicTools.some((d) => d.name === 'codex_cli'), p4.dynamicTools.map((d) => d.name));
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
    // 57 号后：dev 配置含 codex-cli（README 工具）→ 白名单解析注入 1 个；zed/vscode 不注入
    const resolved = registry.resolveHostTools(names);
    t('dev 配置经白名单解析（codex-cli 注入）', resolved.some((d) => d.name === 'codex_cli') && resolved.every((d) => d.name !== 'zed_terminal'), resolved.map((d) => d.name));
    // 模拟混合配置（READY 重复去重 + PENDING 过滤）
    const mock = registry.resolveHostTools(['pfc_read_file', 'codex-cli', 'codex-cli', 'zed']);
    t('混合配置：READY 去重注入（60 号 zed 已 READY）', mock.length === 3 && mock.some((d) => d.name === 'codex_cli') && mock.some((d) => d.name === 'zed_terminal'), mock.map((d) => d.name));
  } catch (e) {
    t('DB 装载', false, e.message);
  } finally {
    await db.close();
    console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
