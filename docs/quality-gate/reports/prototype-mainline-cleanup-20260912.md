# 原型主线收口与历史归档验证

当前状态：LOCAL_VERIFIED。已确认的文件整理完成，归档/完整性检查和六条交接回归全部 PASS；本报告不是 M2b-2 产品验收。

## 授权、范围与方案

用户确认 22 号方案可以执行，要求先修正源路径、21 号进度、README 入口及备份/证据/旧脚本/早期设计稿保留声明。对应修订已写入 [22 号清单](../../planning/prototype-v3/22-主线收口与历史代码整理建议-20260912.md)，随后执行唯一列明的 12 项 V3 归档。

本轮是文档、开发入口与历史文件整理，不更改业务行为。父级 POD-PFC-001；当前原型 M2b-2，后续 M2c；正式 CAP/Unit 的实施/集成/验收状态及 `.quality-gate/delivery-plan.json` 保持不变，台账下一路径仍为 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`。陈立确认整理范围；Codex 执行与验证。21 号额外 API 衔接和完整 UI 验收继续待确认，不以本次授权代替。

## 改动结果

- 根 AGENTS.md 指明当前原生 JS/Express 范围，并保留前期 apps/packages 原有技术与安全规则。
- 两个 README 顶部并列 19/20/21，显示部分实现和未验收状态；旧说明保留在历史段落。
- 12 项文件从 `output/pfc-workbench-prototype/` 归档至 `archive/prototype-v3-reference-20260912/`，保留原字节。新增归档 README、原/新路径和 SHA256 manifest。
- 两份静态检查配置仅迁移这批历史文件已有的精确排除路径，逐文件验证忽略行为一致，没有新增整目录豁免。
- `_backup/` 当前 139 个文件、`output/playwright/` 当前 47 张图片、其他旧脚本和截图、`output/pfc-design-overview.html`、业务源码与 M2b-2 草稿、根依赖和交付台账原位保留。

## 环境与数据

项目固定 Node 24.20.0 / npm 11.19.0，root/server 已装依赖离线核查通过。浏览器回归使用既有 Playwright + 独立 Edge。测试仅使用既有合成工厂、临时浏览器上下文和 loopback 内存服务；PFC_DB=memory，DATABASE_URL 置空，不调用数据库迁移、真实 Shell/Codex/Zed 工作区或外部服务。本次未新增业务测试数据场景。

源码修改前副本、1774 项初始保护哈希及归档源清单保存在 `.local/prototype-mainline-cleanup-20260912-133446/`。2 项配置转为路径维护后，完整保护比对为 1772 项。证据只保留本地合成测试输出和文件路径/哈希，供本轮复核与回退；无远程发布或 Git 提交。

## 已执行检查

以下命令在仓库根使用固定 Node / npm 执行。

| 命令 | 结果 |
| --- | --- |
| `node .local/prototype-mainline-cleanup-20260912-133446/verify-archive.mjs` | PASS，6 组：12 项归档哈希一致、1772 项保护文件不变、18 JS/20 资源可解析、4 份入口文档共 61 个链接有效、19/20/21 正确置顶、忽略行为等价 |
| `node output/pfc-workbench-prototype/verify-static.mjs` | PASS，18 脚本语法、13 模块 ESLint |
| `node output/pfc-workbench-prototype/verify-m2b2-model.mjs` | PASS，4/4 |
| `node server/verify-m2b2-domain.mjs` | PASS，7/7 |
| `npm run check:config` | PASS，BOOTSTRAP_CONFIG_OK |
| `npm run check:delivery-governance` | PASS，5 CAP / 26 Unit，原下一路径不变 |
| `node node_modules/eslint/bin/eslint.js eslint.config.js` | PASS |
| `npm run test:gate:quick -- --dry-run` | READY_TO_RUN，仅计划检查，不是 quick PASS |

首次 `node output/pfc-workbench-prototype/verify-prototype.mjs`：静态、完整性 8、模型 11、定向场景 46 通过；`verify-guide-browser.mjs` 未输出用例结果即触发父进程 180 秒 ETIMEDOUT，门禁 FAIL。源指纹 `sourceUnchanged=true`，进程审计未见测试浏览器残留；未修改代码或超时，原样重跑。首轮证据：`C:\Users\hz19114673\AppData\Local\Temp\pfc-prototype-gate-A4xNZm\report.json`，本地首轮日志在上述 `.local` 证据目录。

本轮比例检查覆盖整理影响；根工程 quick/core/full 未执行，不作生产发布或正式业务验收结论。归档内历史脚本保留旧路径，不计作当前六条门禁；当前索引链接已更新，历史 01/04 等正文原文保持，并通过归档 README/manifest 提供路径映射。

### 原样重跑结果

| 命令（仓库根，固定 Node） | 结果 |
| --- | --- |
| `node output/pfc-workbench-prototype/verify-prototype.mjs` | PASS，全部 6 组：静态、完整性 8、模型 11、定向 46、浏览器 13、scope7 12；sourceUnchanged=true |
| `node output/pfc-workbench-prototype/verify-m1-layer.mjs` | PASS，6/6 |
| `node output/pfc-workbench-prototype/verify-m1-e2e.mjs` | PASS，8/8，含恢复与 console 错误检查 |
| `node server/verify-server.mjs` | PASS，18/18 |
| `node server/verify-server-m2.mjs` | PASS，19/19 |
| `node server/verify-m2b.mjs` | PASS，7/7，收到 5 条模拟 Bridge 输出 |

六条完整输出保存为 `.local/prototype-mainline-cleanup-20260912-133446/attempt2-*.log`。本轮成功门禁证据为 `C:\Users\hz19114673\AppData\Local\Temp\pfc-prototype-gate-3FWseo\report.json`，浏览器截图位于 `pfc-guide-32DxC5` 等同批临时证据目录。持久的归档、链接与保护文件核验结果保存于同一 `.local` 下的 `verification.json`。

相同源码上的失败与重跑均保留：归档字节/保护校验失败 0 次；浏览器门禁超时 1 次，重跑通过；产品代码返工 0 次。仍待完成 21 号的新增完整 UI 链路，未借用旧回归的 PASS 代替它。

## 进程、回退和收尾

无并行代理。测试结束后关闭本轮 Edge/内存服务/模拟 Bridge，并读回临时端口。归档回退按 manifest 逐项进行，先比对哈希和原路径占用，不覆盖用户新增文件；文档/路径配置回退使用 `.local/.../before/` 的精确副本。没有递归删除、迁移、真实外部副作用、提交或推送。

2026-09-12 13:52:01（Asia/Shanghai）实际读回：5189、5191、5192、5193 均无监听；本轮测试 Node、sim-bridge 和 Playwright 根进程均无残留，记录为 `process-cleanup.json` / CLEAN。内存测试记录随临时服务退出销毁，合成截图、日志、归档及回退副本仅本地保留。用户原有应用进程未操作。

本轮整理回顾：用户审阅指出路径与保留范围表述不足，执行前已补齐；根因是初版以原则代替逐项处置名单。验证采用精确名单与文件哈希，避免仅靠目录存在性。回归出现一次尚未完全定位的浏览器进程超时，保留失败记录；不将重跑通过解释为该偶发问题已修复。
