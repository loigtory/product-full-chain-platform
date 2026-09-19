# 69 号：GitHub/公司 skill 实际安装与治理中心登记

> 状态：已完成并验收（本机 70 个 skill 实际落地 + 治理中心 44 条登记 + 绑定更新 + 浏览器实测）
> 日期：2026-09-19
> 前置：55 号阶段能力清单（github/company 来源为配置声明）、68 号治理中心预置

## 一、背景

55 号清单中 github/company 来源的 skill 在 68 号只是"配置声明"（治理中心 src 标注），用户要求把声明落地为本机真实 skill 文件（"skill 不能乱选、选时沟通、按 GitHub skills + 公司 ai-dev.hzins.com/categories"）。本号核验本机安装现状、补齐缺口、登记到治理中心并更新阶段绑定。

## 二、本机安装现状核验（~/.codex/skills）

```
既有 68 个 skill 目录（非 git 仓库），55 清单 github/company 来源绝大部分已实际安装：
- GitHub 生态已装：brainstorm-ideas-new、identify-assumptions-new、analyze-feature-requests、
  interview-script、frontend-design、webapp-testing、pm-go-to-market、metrics-dashboard、
  uml-and-software-architecture-visualization、d3/data-visualization 系等
- 公司已装（rdc-* 即公司 ai-dev 仓库 skill）：rdc-prd-standardizer、rdc-feature-point-split、
  rdc-prd-gateway、rdc-code-review（=代码审查）、rdc-data-analysis（=数据分析助手）、
  cha-estimate-workload（=前端工时估算）
唯一缺口：user-story-canvas（design 阶段绑定项）——无真实开源/公司仓库（经 GitHub 检索与
公司平台核验），属"声明性"能力。
```

## 三、本次改动

### 1. 公司 skill 仓库核验与补充安装

- 公司 ai-dev 平台（https://ai-dev.hzins.com/categories）分类确认：需求分析 13 / 开发工具 66 / 测试工具 29 / Git 工作流 6 / 前端开发 18 / 后端开发 23 / 文档生成 14 / 数据分析 11 / 效能工具 16 / DevOps 10；安装命令 `npx skills add https://git.hzins.com/ai-dev/skills-public.git --skill <name>`。
- 稀疏克隆 `git.hzins.com/ai-dev/skills-public.git` 确认仓库结构：11 个渠道/中心集合共 206 个 skill（rd-center 23、channel-x 22、channel-a 27、channel-b 24、channel-c 21、channel-h 15、channel-overseas 12、common-base 6、midplatform-core 14、midplatform-integration 33、midplatform-test 9）。
- **补充安装到本机 ~/.codex/skills**（公司仓库直接复制，npx 直装卡在 git clone 网络）：
  - **rdc-req-clarify**（需求找平，陆楠/研发中心）：系统化需求文档分析与标准化输出——**替代 user-story-canvas 的"用户故事/需求画布"角色**；
  - **rdc-do-unittest**（Java 单元测试生成执行，研发中心）：test 阶段真实测试能力。
- 安装后核验 SKILL.md 存在且 frontmatter 完整（name/description/metadata/工作流程）。

### 2. 治理中心登记与绑定更新（seed-69-governance-additions.cjs，幂等增量）

- 登记 + 复核 + 启用：**rdc-req-clarify（CP-43）**、**rdc-do-unittest（CP-44）**（Skill / 本机已装，描述注明已安装路径）。
- **design 绑定**：移除 user-story-canvas（无真实来源），加入 rdc-req-clarify → 6 项（原型画布 / rdc-req-clarify / figma-generate-design / uml-and-software-architecture-visualization / frontend-design / 对话生成）。
- **test 绑定**：加入 rdc-do-unittest → 7 项。
- **dev 绑定补丁**：核验时发现 dev 从 68 号的 6 项变 4 项（codex-cli/vscode/前端工时估算/开发终端），补齐 frontend-app-builder、fullstack-quality-gate、代码审查 → 7 项。
- **user-story-canvas 停用**（enabled=false，保留记录与审计；能力目录不再展示为可用，绑定视图未绑定）。

### 3. 运维：5188 启动脚本修复（.local/start-5188-current.cjs，gitignored）

- 原 start-workbench.cjs 为 007 时代脚本，且 `ops-config.environment()` 会过滤所有 PFC_* 环境变量导致 spawn 丢失 PFC_LOCAL_PROFILE_FILE → 服务器落到默认 profile → LOCAL_RUNTIME_TARGET_MISMATCH。
- 修复：复用 environment(p) 派生 base env（与 runtimeTarget 校验 100% 一致），**显式加回 PFC_LOCAL_PROFILE_FILE** + 叠加 codex exec env（PFC_CODEX_BINARY/BINARY_SHA256=be96b992…dfde/CONNECTION_SHA256=b585d723…9292/PREFLIGHT_CWD=.local\ai-tools-remediation-20260916）。
- 顺带修复：PostgreSQL（.tools\postgresql-18.6，数据 .local\postgres-data）需先于 5188 启动（pg_ctl start）。

## 四、验证结果

### 4.1 seed（HTTP 全链路 + pg 直查）

```
created: rdc-req-clarify CP-43 / rdc-do-unittest CP-44（review+enable）
design 绑定 6 caps（user-story-canvas 移除=true）
test 绑定 7 caps / dev 绑定 7 caps（补丁后）
RESULT caps total: 44 enabled+reviewed: 44  VERDICT PASS
```

### 4.2 pg 直查绑定明细

```
design: figma-generate-design / frontend-design / rdc-req-clarify / uml-and-software-architecture-visualization / 原型画布 / 对话生成（6）
dev:    codex-cli / frontend-app-builder / fullstack-quality-gate / vscode / 代码审查 / 前端工时估算 / 开发终端（7）
test:   platform-test-case-writer / platform-test-runner-reporter / frontend-testing-debugging / webapp-testing / 测试用例生成 / 测试执行记录 / rdc-do-unittest（7）
```

### 4.3 浏览器实测（bu plane，v=71/72 解锁）

- 能力目录：44 条登记，src 标注本机已装/GitHub 生态/公司 ai-dev；user-story-canvas 已停用。
- 阶段绑定：设计 6 项（含 rdc-req-clarify）、开发 7 项（含代码审查/前端工时估算）、测试 7 项（含 rdc-do-unittest）、验收 4 项等，修订号与展示一致。
- 热插拔交互：添加/解除可用（68 号已验证闭环，本次绑定数据只读复核）。

## 五、交付物

- `server/seed-69-governance-additions.cjs`（治理中心增量 seed：登记 rdc-req-clarify/rdc-do-unittest、design/test 绑定、幂等可重跑）
- `.local/start-5188-current.cjs`（当前版 5188 启动脚本，gitignored，位置与内容已在本文档记录）
- 本机 `~/.codex/skills/rdc-req-clarify`、`rdc-do-unittest`（实际安装）
- `docs/planning/prototype-v3/69-GitHub与公司skill实际安装与治理中心登记-20260919.md`（本文档）

## 六、说明与遗留

- 公司平台 206 个 skill 仅安装 55 清单所需（rdc-req-clarify/rdc-do-unittest 为替代与增强）；**其余高价值公司 skill（需求故事点拆解、需求找平、需求准入检查、需求标准功能点拆解、研发工时预估、chx-workload-estimation 等）已在仓库可见，如需扩展绑定需用户拍板后再装**（遵守"选前沟通"）。
- 能力目录"＋添加"可添加已停用项（如 user-story-canvas）——绑定停用项在启用前不可用，属预期边界；如需对停用项置灰可后续微调。
- 两套能力视图（AgentRuns stage_capabilities 与治理中心 caps+bindings）数据源统一仍未做（68 遗留），worker 装载仍读 stage_capabilities。
