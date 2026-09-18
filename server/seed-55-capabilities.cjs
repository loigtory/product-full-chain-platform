'use strict';
// 55 号：阶段能力配置中心默认清单 seed（幂等 upsert）。
// 用法：node seed-55-capabilities.cjs
// 前提：PG 运行 + 已迁移 009（migrate-55.cjs）
const { Pool } = require('pg');
const crypto = require('node:crypto');
const pool = new Pool({
  connectionString:
    'postgresql://pfc_app_local:a93IUha8RtaV-l-dJ_vJ3FIKWm_j7kWL2la9vfDM09c@127.0.0.1:5432/pfc_local',
});
const SCHEMA = 'pfc_workbench';
const TENANT = 'a8dc197a-8b20-4831-ad93-c7d20ae77050';

// v2 定稿默认清单：来源 local(本机已装) / github(GitHub 生态) / company(公司 ai-dev 市场)
const DEFAULT = [
  // ---- idea ----
  ['idea', 'skill', 'grill-me', 'local', null, '对想法做尖锐拷问，澄清盲区', 10],
  ['idea', 'skill', 'brainstorm-ideas-new', 'github', 'https://github.com/phuryn/pm-skills', '多视角（PM/设计/工程）头脑风暴', 20],
  ['idea', 'skill', 'identify-assumptions-new', 'github', 'https://github.com/phuryn/pm-skills', '识别 8 类高风险假设', 30],
  ['idea', 'tool', '对话澄清', 'local', null, '对话式澄清想法', 10],
  ['idea', 'tool', '材料提取', 'local', null, '从材料提取要点', 20],
  // ---- req ----
  ['req', 'skill', 'rdc-prd-standardizer', 'local', null, 'PRD 标准化', 10],
  ['req', 'skill', 'rdc-feature-point-split', 'local', null, '功能点拆分', 20],
  ['req', 'skill', 'rdc-prd-gateway', 'local', null, 'PRD 质量门（完整性/一致性）', 30],
  ['req', 'skill', 'analyze-feature-requests', 'github', 'https://github.com/phuryn/pm-skills', '特性请求聚类/优先级', 40],
  ['req', 'skill', 'interview-script', 'github', 'https://github.com/phuryn/pm-skills', '用户访谈脚本（JTBD）', 50],
  ['req', 'tool', '对话生成', 'local', null, '对话式生成需求草案', 10],
  ['req', 'tool', '材料提取', 'local', null, '从材料提取需求', 20],
  // ---- design ----
  ['design', 'skill', 'figma-generate-design', 'local', null, '生成设计稿', 10],
  ['design', 'skill', 'uml-and-software-architecture-visualization', 'local', null, 'UML/架构图（时序图/流程图/状态机）', 20],
  ['design', 'skill', 'frontend-design', 'github', 'https://github.com/anthropics/skills', '低保真原型快速产出', 30],
  ['design', 'skill', 'user-story-canvas', 'github', 'https://github.com/voltagent/awesome-agent-skills', '用户故事地图（Epic→Feature→Story）', 40],
  ['design', 'tool', '对话生成', 'local', null, '对话式设计方案', 10],
  ['design', 'tool', '原型画布', 'local', null, '原型画布', 20],
  // ---- dev ----
  ['dev', 'skill', 'frontend-app-builder', 'local', null, '前端应用构建', 10],
  ['dev', 'skill', 'fullstack-quality-gate', 'local', null, '全栈质量门（修码前自检）', 20],
  ['dev', 'skill', '代码审查', 'company', 'https://ai-dev.hzins.com/categories', '提交前安全/逻辑/规范审查', 30],
  ['dev', 'skill', '前端工时估算', 'company', 'https://ai-dev.hzins.com/categories', '需求→工时评估', 40],
  ['dev', 'tool', '开发终端', 'local', null, '开发终端（Zed/Codex/VSCode，EXEC 受控执行）', 10],
  ['dev', 'mcp', 'codex-cli', 'local', null, 'codex CLI 会话', 10],
  // ---- test ----
  ['test', 'skill', 'platform-test-case-writer', 'local', null, '平台测试用例编写', 10],
  ['test', 'skill', 'platform-test-runner-reporter', 'local', null, '测试运行与报告', 20],
  ['test', 'skill', 'frontend-testing-debugging', 'local', null, '前端测试调试', 30],
  ['test', 'skill', 'webapp-testing', 'github', 'https://github.com/anthropics/skills', 'Web 应用系统测试', 40],
  ['test', 'tool', '测试用例生成', 'local', null, '生成测试矩阵', 10],
  ['test', 'tool', '测试执行记录', 'local', null, '回填测试记录', 20],
  // ---- accept ----
  ['accept', 'skill', 'open-code-review-delegate', 'local', null, '代码评审代理（产出评审结论）', 10],
  ['accept', 'skill', '代码审查', 'company', 'https://ai-dev.hzins.com/categories', '验收对照（与 dev 复用）', 20],
  ['accept', 'tool', '验收核对', 'local', null, '对照验收项核对证据', 10],
  ['accept', 'tool', '证据清单', 'local', null, '通过/缺口/阻塞清单', 20],
  // ---- release ----
  ['release', 'skill', 'release-checklist', 'local', null, '发布检查清单', 10],
  ['release', 'skill', 'release-ops', 'local', null, '发布运维/回滚/灰度', 20],
  ['release', 'skill', 'pm-go-to-market', 'github', 'https://github.com/phuryn/pm-skills', '上市/发布计划', 30],
  ['release', 'tool', '发布清单', 'local', null, '发布检查清单', 10],
  ['release', 'tool', '回滚方案', 'local', null, '回滚方案', 20],
  // ---- observe ----
  ['observe', 'skill', 'statistical-and-uncertainty-visualization', 'local', null, '统计与不确定性可视化', 20],
  ['observe', 'skill', 'metrics-dashboard', 'github', 'https://github.com/phuryn/pm-skills', '指标看板（北极星+输入+健康）', 30],
  ['observe', 'skill', '数据分析助手', 'company', 'https://ai-dev.hzins.com/categories', '端到端 EDA', 40],
  ['observe', 'tool', '指标设计', 'local', null, '关键指标与埋点建议', 10],
  ['observe', 'tool', '复盘模板', 'local', null, '复盘模板', 20],
];

(async () => {
  const owner = (
    await pool.query(
      `SELECT id FROM "${SCHEMA}".members WHERE tenant_id=$1 AND role='owner' ORDER BY created_at LIMIT 1`,
      [TENANT],
    )
  ).rows[0];
  if (!owner) {
    console.error('OWNER_MEMBER_MISSING');
    process.exit(1);
  }
  // 010 号：公司市场 skill 的装载名 slug（worker 按真实 codex 目录名匹配）
  const SLUG_BY_NAME = {
    '代码审查': 'rdc-code-review',
    '前端工时估算': 'cha-estimate-workload',
    '数据分析助手': 'rdc-data-analysis',
  };
  let upserted = 0;
  for (const [stage, kind, name, source, sourceUrl, description, priority] of DEFAULT) {
    const slug = SLUG_BY_NAME[name] || null;
    await pool.query(
      `INSERT INTO "${SCHEMA}".stage_capabilities
         (id,tenant_id,stage,kind,name,slug,source,source_url,description,enabled,priority,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)
       ON CONFLICT (tenant_id,stage,kind,name) DO UPDATE SET
         slug=EXCLUDED.slug,source=EXCLUDED.source,source_url=EXCLUDED.source_url,
         description=EXCLUDED.description,enabled=EXCLUDED.enabled,
         priority=EXCLUDED.priority,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [crypto.randomUUID(), TENANT, stage, kind, name, slug, source, sourceUrl, description, priority, owner.id],
    );
    upserted++;
  }
  const total = (
    await pool.query(
      `SELECT stage,kind,count(*)::int n FROM "${SCHEMA}".stage_capabilities WHERE tenant_id=$1 GROUP BY stage,kind ORDER BY stage,kind`,
      [TENANT],
    )
  ).rows;
  console.log('SEED_55_UPSERTED=' + upserted);
  for (const row of total) console.log(`SEED_55 ${row.stage} ${row.kind}=${row.n}`);
  await pool.end();
})().catch((e) => {
  console.error('FAIL', e.code || '', e.message);
  process.exit(1);
});
