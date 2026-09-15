'use strict';
// 各阶段 AI 能力（非终端环节）定义：想法→需求→设计→开发→测试→验收→发布→观察。
// 供三处消费：
//  1) worker.runTextJob 按 job.input.stage 取 guide 注入 TEXT prompt（模型按阶段工作法产出）；
//  2) worker 按 stage.skills 从 codex skills/list inventory 中匹配 → text 线程 skills.config enabled:true
//     （匹配不到不报错：期望能力，非硬依赖）；
//  3) GET /api/agent/stage-capabilities 暴露给前端"本阶段启用能力"面板真实展示。
// tools/mcps 为声明性清单（前端展示），TEXT 会话无工具不实际挂载；EXEC 会话仍走受控 exec-control。
const STAGES = [
  'idea',
  'req',
  'design',
  'dev',
  'test',
  'accept',
  'release',
  'observe',
];

const CAPABILITIES = [
  {
    stage: 'idea',
    name: '想法',
    goal: '把模糊想法澄清为目标、边界、用户与验收标准的可作业输入',
    guide:
      '你处于【想法】阶段。任务是把模糊的产品想法澄清为可作业的输入：先提炼目标（解决谁的什么问题、期望结果），再列出边界（本次覆盖/不覆盖），然后给出必须回答的澄清问题（用户与范围、异常与退出、验收边界）。输出简洁结构化，不编造成品。',
    skills: ['product-manager', 'product-idea'],
    tools: ['对话澄清', '材料提取'],
    mcps: [],
  },
  {
    stage: 'req',
    name: '需求',
    goal: '从材料提炼用户故事、范围、非功能需求与澄清问题，形成需求草案',
    guide:
      '你处于【需求】阶段。基于已确认材料与用户故事输出需求草案：范围（in/out）、用户角色、核心流程、非功能需求（性能/安全/合规）、待澄清问题。区分事实与推断，不编造用户未表达的需求。',
    skills: ['product-requirement', 'requirement-analyze'],
    tools: ['对话生成', '材料提取'],
    mcps: [],
  },
  {
    stage: 'design',
    name: '设计',
    goal: '产出候选方案、实施设计、原型要点与 PRD 结构',
    guide:
      '你处于【设计】阶段。基于需求草案产出：候选方案（至少 2 个，含取舍）、实施设计（模块/数据/接口要点）、原型要点、PRD 结构。标注不确定项，不默认技术栈。',
    skills: ['product-prd', 'solution-design'],
    tools: ['对话生成', '原型画布'],
    mcps: [],
  },
  {
    stage: 'dev',
    name: '开发',
    goal: '把设计拆成可执行实现计划；实际修码走受控 EXEC 作业（codex exec）',
    guide:
      '你处于【开发】阶段。先把设计拆成可执行实现计划（步骤、涉及文件、验证方式），再交由受控 EXEC 作业在指定工作区真实实现。不臆造已完成动作；结果以作业回写为准。',
    skills: ['codex-exec', 'code-review'],
    tools: ['开发终端（Zed/Codex/VSCode，EXEC 受控执行）'],
    mcps: ['codex-cli'],
  },
  {
    stage: 'test',
    name: '测试',
    goal: '从需求与验收项生成测试矩阵并回填测试记录',
    guide:
      '你处于【测试】阶段。对照需求草案与验收项生成测试矩阵（场景、步骤、预期、级别：单元/集成/验收），标注可自动化项；不替代真实执行结果。',
    skills: ['test-case', 'qa'],
    tools: ['测试用例生成', '测试执行记录'],
    mcps: [],
  },
  {
    stage: 'accept',
    name: '验收',
    goal: '对照验收项核对证据，输出通过/缺口清单',
    guide:
      '你处于【验收】阶段。对照验收项逐条核对证据（测试记录、执行结果），输出通过项、缺口项与阻塞项清单；证据不足标注待补，不下无据结论。',
    skills: ['acceptance-check', 'product-qa'],
    tools: ['验收核对', '证据清单'],
    mcps: [],
  },
  {
    stage: 'release',
    name: '发布',
    goal: '生成发布检查清单、回滚方案与灰度建议',
    guide:
      '你处于【发布】阶段。基于验收结论生成：发布检查清单、回滚方案、灰度/放量建议、发布后监控点。不虚构环境信息。',
    skills: ['release-checklist', 'ops'],
    tools: ['发布清单', '回滚方案'],
    mcps: [],
  },
  {
    stage: 'observe',
    name: '观察',
    goal: '生成指标埋点、复盘模板与异常分析引导',
    guide:
      '你处于【观察复盘】阶段。基于发布范围生成：关键指标与埋点建议、复盘模板（目标/结果/归因/下一步）、异常分析引导。区分数据假设与事实。',
    skills: ['metric-design', 'retro'],
    tools: ['指标设计', '复盘模板'],
    mcps: [],
  },
];

const BY_STAGE = Object.freeze(
  Object.fromEntries(CAPABILITIES.map((c) => [c.stage, Object.freeze(c)])),
);

function forStage(stage) {
  return BY_STAGE[stage] || null;
}

function all() {
  return CAPABILITIES;
}

module.exports = { STAGES, CAPABILITIES, forStage, all };
