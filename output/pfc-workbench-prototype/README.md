# PFC 原版交互原型

当前主线（2026-09-12）：`index.html` + `original/` 原生 JS 前端，以及仓库根 `server/` Express 后端。后续开发按以下三份交接资料一起阅读：

| 当前入口 | 用途 |
| --- | --- |
| [19 · 开发路线图](../../docs/planning/prototype-v3/19-开发路线图-20260912.md) | 确认的阶段范围与 M2c 后续路径 |
| [20 · M2b-2 交接任务](../../docs/planning/prototype-v3/20-Codex交接提示词-20260912.md) | 本轮动作切 API、实时终端与验收标准 |
| [21 · 实施中检查点](../../docs/planning/prototype-v3/21-M2b-2前端切领域API-20260912.md) | 已有部分实现；模型 4/4、领域 7/7 通过，完整 UI 验收和额外接口范围待确认 |
| [22 · 主线收口清单](../../docs/planning/prototype-v3/22-主线收口与历史代码整理建议-20260912.md) | 归档路径、保留资产、整理结果 |
| [23 · Codex 防走偏协议](../../docs/planning/prototype-v3/23-Codex防走偏协议-20260912.md) | 每轮 Codex 会话的固定开局、范围锁、提交纪律、验收闸、差异评审、文档续编 |

打开 [当前原型](index.html)，保留同目录 `original/`。local/mock 模式使用浏览器数据；API 模式连接 `server/`，默认 `127.0.0.1:5188`。本轮联调明确设置 `PFC_DB=memory` 并清空 `DATABASE_URL`；模拟 Bridge 只验证协议与输出，不执行真实 Shell、Codex 或 Zed 工作区命令。服务端进程重启会丢失内存领域数据。

前期 `apps/`、`packages/` 及根工程脚本原位保留，适用其原有规则；它们不是本次交接的默认开发入口。根依赖继续为当前原型提供 ESLint、Playwright 等测试工具。旧 V3 已移至 [历史参考归档](../../archive/prototype-v3-reference-20260912/README.md)，不再作为当前入口；`_backup/`、其他历史验证脚本和截图保留原位。

当前原型读取 18 个 JS，包含 21 号的 `domain-client.js` 实施草稿。本次目录整理没有批准额外 API 范围或完成 M2b-2 验收；进度以 21 号为准，不能只读取历史 PASS 或“完成”标记。

当前回归命令（仓库根目录，使用已安装依赖）：

```powershell
$env:Path="$PWD\.tools\node-v24.20.0-win-x64;$env:Path"
node output/pfc-workbench-prototype/verify-prototype.mjs
node output/pfc-workbench-prototype/verify-m1-layer.mjs
node output/pfc-workbench-prototype/verify-m1-e2e.mjs
node server/verify-server.mjs
node server/verify-server-m2.mjs
node server/verify-m2b.mjs
```

独立浏览器与内存测试只证明对应交互/协议。PostgreSQL 集成、真实工具执行、业务验收与发布分别需要自己的证据。

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
