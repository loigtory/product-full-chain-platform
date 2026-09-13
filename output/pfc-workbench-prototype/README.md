# PFC 原版交互原型

> 当前授权：用户已确认d4641b8的35号A方案（D1-D7、59文件、五隔离目标、26闸）；当前在feat/r3-test-acceptance实施，状态见[36号](../../docs/planning/prototype-v3/36-R3测试验收实施与验收-20260913.md)。之前“方案待确认”是历史记录；本轮连续执行C1-C4，源码交付后仍需人工验收，不合并main/部署。

> 当前交付：R2源提交e5dcd31已由陈立验收，验收收尾138258f、main合并2afce7a均已推送并独立读回。35号R3方案已形成可评审包：测试前移、版本化结果、缺陷回归、Owner产品验收及只读发布输入；当前仅文档，新实现待确认。

> 当前方案入口：[35-R3测试验收与发布承接方案及范围确认-20260913](../../docs/planning/prototype-v3/35-R3测试验收与发布承接方案及范围确认-20260913.md)。R2已披露的标准业务PG、正式CAP/Unit、真实AI/工具/CI与生产边界保持；35号具体方案与范围需确认后才实施。

> 已验收治理基线：M2c-3（ce2c44c）已获陈立确认，验收收尾d252761、main合并04fd81a均已推送。R2源e5dcd31已验收并合并main 2afce7a，验收/实测见34；当前方案见35。

当前 R1 连续协作演练已实现并通过本地验证，入口仍是 [index.html](index.html)。打开后使用“交互原型 · 场景切换 → 连续协作演练”；需处于“本地存储”模式。已在隔离 Edge 验证直接打开此文件，也已验证本地 HTTP 路径。

体验顺序：输入目标 → 原型/PRD/验收项共同生成 → 在对话输入“提醒时间改成提前 3 天” → 比较并采纳关联差异 → 确认业务与设计 → 沿当前主动作完成开发、测试、验收、发布与观察演练。右侧可展开体验；异常与角色演练可验证部分失败、等待决定、只读和未知结果。退出保留进度，在场景窗口点击“恢复”；“清除此演练”只删除当前记录。

R1交付2cf9a3f已于2026-09-13经陈立视觉/业务评审确认，已合并推送main c3f6c18。原九条+新三条门禁通过，验收收尾复核源码未变。固定业务模板、角色、AI回复、测试、终端、发布与观察均为合成演练；不写原需求/API/PG。设计见29第九节，完整证据见30。

当前主线为原生JS前端及server/Express后端。治理配置、项目、知识、审计和作业上下文已按31/32验收合并；R2按33号实现原型/PRD/验收项关联版本，结果见34。测试验收域与发布输入拟按35号实施（待确认），发布评审/执行及观察继续留在后续路线。先读AGENTS/19/20/21/23/35，R2证据见33/34，再按29–32追溯；业务PG启用和真实工具接入仍为独立范围。

| 当前入口                                                                                                      | 用途                                                                              |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [19 · 开发路线图](../../docs/planning/prototype-v3/19-开发路线图-20260912.md)                                 | 确认的阶段范围与 M2c 后续路径                                                     |
| [20 · 可复用交接任务](../../docs/planning/prototype-v3/20-Codex交接提示词-20260912.md)                        | 当前35号方案轮；实现包待用户确认                                                  |
| [21 · 实施中检查点](../../docs/planning/prototype-v3/21-M2b-2前端切领域API-20260912.md)                       | 历史实施草稿：当时模型 4/4、领域 7/7；后续收尾结果转 24 号                        |
| [22 · 主线收口清单](../../docs/planning/prototype-v3/22-主线收口与历史代码整理建议-20260912.md)               | 归档路径、保留资产、整理结果                                                      |
| [23 · Codex 防走偏协议](../../docs/planning/prototype-v3/23-Codex防走偏协议-20260912.md)                      | 每轮 Codex 会话的固定开局、范围锁、提交纪律、验收闸、差异评审、文档续编           |
| [24 · M2b-2 验收收尾](../../docs/planning/prototype-v3/24-M2b-2验收收尾-20260912.md)                          | M2b-2 本地协议/UI 已人工验收；保留验证输出与范围边界                              |
| [25 · M2c 方案与范围确认](../../docs/planning/prototype-v3/25-M2c方案与范围确认-20260912.md)                  | 已确认分轮和 M2c-1 隔离测试；后续契约缺口保留                                     |
| [26 · M2c-1 实施与验收](../../docs/planning/prototype-v3/26-M2c-1存储基础实施与验收-20260912.md)              | 存储组件交付已人工验收（af709eb），已授权合并推送 main；业务 API 未切换 PG        |
| [27 · M2c-2 接入方案](../../docs/planning/prototype-v3/27-M2c-2接入方案与范围确认-20260912.md)                | 已确认的 schema、空库、权限、文件/会话/执行持久化及测试范围                       |
| [28 · M2c-2 实施与验收](../../docs/planning/prototype-v3/28-M2c-2实施与验收-20260912.md)                      | 13 闸通过，11d1fdf 原型交付已人工验收并合并推送 main（a9eec73），业务 PG 尚未启用 |
| [29 · M2c-3 治理与项目方案](../../docs/planning/prototype-v3/29-M2c-3治理与项目方案及范围确认-20260912.md)    | 第九节R1已验收；治理规则已由31补充确认                                            |
| [30 · 连续协作原型实施与验收](../../docs/planning/prototype-v3/30-连续协作原型实施与验收-20260912.md)         | 当前 R1 交付、差异、实测证据、限制与后续输入                                      |
| [31 · R1后续治理衔接方案](../../docs/planning/prototype-v3/31-R1后续治理衔接方案与范围确认-20260913.md)       | 已验收治理设计：63项白名单、隔离目标与18条闸                                      |
| [32 · M2c-3实施与验收](../../docs/planning/prototype-v3/32-M2c-3实施与验收-20260913.md)                       | 已验收治理基线：18闸PASS；main 04fd81a；业务PG和正式CAP/Unit仍独立                |
| [33 · R2关联产物方案](../../docs/planning/prototype-v3/33-R2关联产物与阶段承接方案及范围确认-20260913.md)     | 已确认A方案、52项范围（含commands.js补充）及22闸                                  |
| [34 · R2实施与验收](../../docs/planning/prototype-v3/34-R2关联产物实施与验收-20260913.md)                     | R2已验收，22闸PASS，main 2afce7a；历史证据                                        |
| [35 · R3测试验收承接方案](../../docs/planning/prototype-v3/35-R3测试验收与发布承接方案及范围确认-20260913.md) | 当前方案：测试前移、结果/缺陷/Owner验收、只读发布输入；59文件/五目标/26闸待确认   |

打开 [当前原型](index.html)，保留同目录 `original/`。local/mock 模式使用浏览器数据；API 模式连接 `server/`，默认 `127.0.0.1:5188`。当前已验证的联调路径明确设置 `PFC_DB=memory` 并清空 `DATABASE_URL`；模拟 Bridge 只验证协议与输出，不执行真实 Shell、Codex 或 Zed 工作区命令。服务端进程重启会丢失内存领域数据。

前期 `apps/`、`packages/` 及根工程脚本原位保留，适用其原有规则；它们不是本次交接的默认开发入口。根依赖继续为当前原型提供 ESLint、Playwright 等测试工具。旧 V3 已移至 [历史参考归档](../../archive/prototype-v3-reference-20260912/README.md)，不再作为当前入口；`_backup/`、其他历史验证脚本和截图保留原位。

当前原型读取 32 个 JS，包含既有领域适配和新增共享框架、演练工厂/模型/视图/动作模块。21 号保留草稿历史，24 号记录 M2b-2 已合并（12d1733），26 号记录 M2c-1 已验收并合并推送 main（05af5de）。M2c-2 的 PG 路径已实现，设计见 27 号，本轮原型交付验收、Git 授权和实测见 28 号。PG 显式配置并预迁移后才可启动，文件原件可恢复；日常业务区未启用，对话与执行仍是模拟。

当前回归命令（仓库根目录，使用已安装依赖）：

```powershell
$env:Path="$PWD\.tools\node-v24.20.0-win-x64;$env:Path"
node output/pfc-workbench-prototype/verify-prototype.mjs
node output/pfc-workbench-prototype/verify-m1-layer.mjs
node output/pfc-workbench-prototype/verify-m1-e2e.mjs
node server/verify-server.mjs
node server/verify-server-m2.mjs
node server/verify-m2b.mjs
node output/pfc-workbench-prototype/verify-m2b2-model.mjs
node server/verify-m2b2-domain.mjs
node output/pfc-workbench-prototype/verify-m2b2-browser.mjs
```

R1 另运行 `node output/pfc-workbench-prototype/verify-flow-model.mjs`、`node output/pfc-workbench-prototype/verify-flow-browser.mjs`、`node output/pfc-workbench-prototype/verify-flow-architecture.mjs`，共 12 条。测试服务和浏览器按 finally 关闭。

上面是既有九条入口；M2c-2 另有 verify-m2c-pg、verify-m2c-architecture、verify-m2c-domain 和 verify-m2c-browser，完整 13 闸原文见 28 号。本地隔离 PG 验证、日常业务集成、真实工具、业务验收与发布分别记录。

<details>
<summary>历史记录：09 号修复后的说明（仅适用于当时范围）</summary>

最新修复（2026-09-12）：本轮复核中的附件归属/恢复、跨窗口覆盖、引用权限与来源、重发、差异采纳、版本/文件下载、AC关联、冻结交付及多附件布局已修复。见 [修复报告](../../docs/quality-gate/reports/PROTOTYPE-REMEDIATION-20260912.md) 和 [当前开发交接](../../docs/planning/prototype-v3/09-原型修复后开发交接-20260912.md)。旧复核报告保留失败证据，不再作为当前未修复清单。

当前入口：[index.html](index.html)。这是用户选定的原版，已在原版三栏、阶段卡片和双终端上补齐主流程及异常处理；V3 文件仅保留作对照。

直接用浏览器打开，保留同目录 `original/` 文件夹。不需要运行 npm、平台或数据库。演示记录按浏览器保留；右上角“交互原型 · 场景切换”可查看异常路径或重置本原型记录。

先从“我的工作台 → 创建需求”走查：问题澄清 → 需求/方案确认 → 开发作业 → 测试与缺陷复测 → 产品验收 → 发布审批/执行 → 观察复盘。也可直接打开 R-1042 查看开发终端，R-1031 查看验收，R-1018 查看观察。

作业、终端、MCP、配对、测试、发布和预览均为模拟，不会执行真实 Shell、上传材料或修改项目文件。后续正式平台通过本地 Bridge 使用 Shell、文件、Git 和开发工具。

- [产品与开发交接](../../docs/planning/prototype-v3/05-原版开发交接.md)：页面、字段、状态、26 Unit、动作契约、真实接入边界。
- [最新修复复核](../../docs/quality-gate/reports/PROTOTYPE-RECHECK-20260912.md)：原24场景、11个补充场景及问题关闭清单。
- [上轮实测报告](../../docs/quality-gate/reports/PROTOTYPE-PRODUCTION-READINESS-REVIEW-20260911.md)：原问题复现与退出条件，当前状态见修复复核。
- [产品方案 / 技术架构 / 路线图](../../docs/planning/prototype-v3/README.md)。
- [此前验证报告](../../docs/quality-gate/reports/ORIGINAL-PROTOTYPE-GUIDE-20260911.md)：当时模型11组、浏览器13组，三档宽度和24张截图；不覆盖最新识别的缺口。
- [视觉与交互基线](../../docs/design-system/PFC-ORIGINAL-PROTOTYPE-REFERENCE-20260911.md)。

正式系统开发仍暂停；原型用于评审与拆解，不代表数据库集成、业务验收或发布已经完成。

原型独立检查（仓库根目录）：

```powershell
.tools/node-v24.20.0-win-x64/node.exe output/pfc-workbench-prototype/verify-prototype.mjs
```

覆盖静态检查、8项完整性、11项模型、46项问题/边界和13项原有浏览器主流程。项目Quick另有lint失败，人工产品/视觉接受及完整生产能力尚未完成。刷新已打开的原型即可加载修复；无需重置已有演示数据。原文件重选恢复、旧冻结包缺少内容等边界见当前开发交接。

</details>
