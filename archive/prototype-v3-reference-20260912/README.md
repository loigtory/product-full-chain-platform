# 历史 V3 原型归档

本目录是历史对照资料，不是当前开发入口。当前主线为 [原版 index.html](../../output/pfc-workbench-prototype/index.html) 与根 `server/`；继续开发先读 [19 · 路线图](../../docs/planning/prototype-v3/19-开发路线图-20260912.md)、[20 · 交接任务](../../docs/planning/prototype-v3/20-Codex交接提示词-20260912.md)、[21 · 实施中检查点](../../docs/planning/prototype-v3/21-M2b-2前端切领域API-20260912.md)。

2026-09-12 按用户确认的 [22 号清单](../../docs/planning/prototype-v3/22-主线收口与历史代码整理建议-20260912.md)，从 `output/pfc-workbench-prototype/` 逐项移动 12 个文件至本目录，未修改文件内容。原路径、目标路径、字节数及 SHA256 见 [manifest.json](manifest.json)。

| 原目录中的文件名 | 当前归档文件 |
| --- | --- |
| index-v3.html | [页面](index-v3.html) |
| prototype-v3.js | [交互脚本](prototype-v3.js) |
| prototype-v3.css | [样式](prototype-v3.css) |
| prototype-v3-data.js | [演示数据](prototype-v3-data.js) |
| verify-v3.mjs | [历史验证](verify-v3.mjs) |
| verify-v3-check.cjs | [历史页面检查](verify-v3-check.cjs) |
| verify-v3-gov.cjs | [历史治理检查](verify-v3-gov.cjs) |
| debug-gov-v3.cjs | [历史调试脚本](debug-gov-v3.cjs) |
| V3-说明.md | [当时说明](V3-说明.md) |
| V3-验证报告.md | [当时验证报告](V3-验证报告.md) |
| v3-baseline.json | [当时基线](v3-baseline.json) |
| v3-check-shot.png | [当时截图](v3-check-shot.png) |

历史说明中的“当前”“正式系统暂停”、原版/V3 选择与 PASS 均按原记录日期和范围理解。说明、报告和脚本内的旧相对/绝对路径原样保留；其中使用旧工作目录或 `index.html` 基线的验证命令需按 manifest 恢复环境或单独适配后复核，不能当作当前可直接运行的门禁。上表和本 README 提供现有位置；历史 01/04 号文档里的 V3 原路径也对应此映射。

当前六条回归入口见 [原版 README](../../output/pfc-workbench-prototype/README.md)。本次只沿用这些历史文件原有的 ESLint/Prettier 排除结果并同步精确路径，没有增加对应用源码的整目录豁免。

`output/pfc-workbench-prototype/_backup/`、`output/playwright/`、其他原型旧脚本与图片、`output/pfc-design-overview.html`、`apps/`、`packages/` 和根依赖均原位保留。M2b-2 的源码草稿、定向测试和备份也保留，不属于此归档。

恢复时以 manifest 为准：先核实目标文件哈希与原路径是否被重新使用，再逐项恢复。若原路径已有文件，不得覆盖；先核实新文件归属。此次仓库没有提交快照可用于直接 Git 回退。文档与路径配置修改前副本位于 `.local/prototype-mainline-cleanup-20260912-133446/before/`。
