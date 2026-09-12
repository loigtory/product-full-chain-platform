# R1 连续协作原型 · 本地验证报告

结论：**LOCAL_VERIFIED**。2026-09-12，POD-PFC-001 / 原型 M2 / R1；正式 CAP/Unit 不升级，真实集成和发布 NOT_EXECUTED，陈立视觉/业务验收 PENDING。唯一 POD next route 为 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`。授权、逐文件差异及后续设计输入见 [30 号](../../planning/prototype-v3/30-连续协作原型实施与验收-20260912.md)。

## 执行环境与数据

Windows / 固定 Node 24.20.0、npm 11.19.0 / 已安装 Playwright 与隔离 Edge。采用原版 HTML/JS 入口，无安装或外部资产。原九条使用临时 `PFC_DB=memory` 服务，`DATABASE_URL` 为空；R1 工厂只使用 `CODEx_TEST_FLOW_20260912_*` 合成数据、独立 localStorage 键和 sessionStorage 视图。没有 PostgreSQL 写入或真实模型/工具/CI 调用。

数据设计覆盖两个需求、7→3→5 天边界、0 天负例、owner/viewer 演练身份、并发/旧基线、部分生成、存储失败、UNKNOWN、测试/发布失败与恶意文本。模型工厂有 20 需求、200 产物版本、10 MiB 上限。业务意义、步骤/预期与 owner 均按 29 的 F01–F07/U01–U08；执行者 Codex，最终接受人陈立。浏览器 createdIds、请求、状态、清理回读保存在下列 JSON。

## 命令与结果

以下从仓库根通过固定 Node 执行。完整 stdout/stderr、时间和退出码见 [gate-commands.json](flow-prototype-20260912/gate-commands.json)。最终 12 条批次共 127,523 ms，全部退出 0。

| 命令 | 实测结果 |
| --- | --- |
| node output/pfc-workbench-prototype/verify-prototype.mjs | PASS，6 子闸：静态及 8/11/46/13/12 组检查 |
| node output/pfc-workbench-prototype/verify-m1-layer.mjs | PASS，6 组 |
| node output/pfc-workbench-prototype/verify-m1-e2e.mjs | PASS，8 组 |
| node server/verify-server.mjs | PASS，18 组 |
| node server/verify-server-m2.mjs | PASS，19 组 |
| node server/verify-m2b.mjs | PASS，7 组，模拟 Bridge |
| node output/pfc-workbench-prototype/verify-m2b2-model.mjs | PASS，6 组 |
| node server/verify-m2b2-domain.mjs | PASS，8 组 |
| node output/pfc-workbench-prototype/verify-m2b2-browser.mjs | PASS，19 组，临时 memory 服务 |
| node output/pfc-workbench-prototype/verify-flow-model.mjs | PASS，11 组 |
| node output/pfc-workbench-prototype/verify-flow-browser.mjs | PASS，11 组 |
| node output/pfc-workbench-prototype/verify-flow-architecture.mjs | PASS，4 组，包含 24 个原工作台组合 |
| node output/pfc-workbench-prototype/verify-static.mjs | PASS，26 脚本语法、21 模块 lint、0 外部入口资产 |
| npm run check:config | PASS，BOOTSTRAP_CONFIG_OK node=24.20.0 |
| npm run check:delivery-governance | PASS，5 CAP / 26 Unit / M2 / next route 未变 |

[原六子闸原文](flow-prototype-20260912/original-prototype-subgates.json)、[附加检查](flow-prototype-20260912/additional-checks.json)、[浏览器记录](flow-prototype-20260912/browser-report.json)、[架构/指纹记录](flow-prototype-20260912/architecture-report.json)可独立核查。旧工程 Quick 只做启动 dry-run，不作为 PASS；Core/Full 和真实 PG 13 闸不在此 R1 测试包内。

## 风险覆盖与截图

| 场景 | 步骤与关键断言 | 结果/证据 |
| --- | --- | --- |
| U01–U03 / F01 | 无完整 PRD 先生成可点击模板；0 天错误、开关/空态；关联修改一起变为 v2，v1 不变 | PASS；[原型 1280](flow-prototype-20260912/prototype-1280.png)、[1440](flow-prototype-20260912/prototype-1440.png)、[1920](flow-prototype-20260912/prototype-1920.png)、[PRD](flow-prototype-20260912/prd.png)、[关联差异](flow-prototype-20260912/related-diff.png) |
| F03 / F06 | 保存故障不产生半组版本；恢复后同一命令重试；两窗口旧写失败，另一需求不受污染 | PASS，模型与浏览器状态断言，普通存储值前后严格相同 |
| U04–U05 / F02 / F04 | 等待决定期间先做独立准备；业务/设计分开确认；切阶段只查看 | PASS；角色演练只读禁写；键盘确认后焦点转到下一主动作 |
| U06 / F05 | 双终端同一运行；暂停/恢复；UNKNOWN 先核验；测试失败保留历史、修复后重验 | PASS；[双终端与 UNKNOWN](flow-prototype-20260912/unknown.png) |
| U07–U08 | 测试通过不自动验收；批准不等于执行；发布失败可重试；观察须主动采集合成数据 | PASS；[验收](flow-prototype-20260912/acceptance.png)、[观察](flow-prototype-20260912/observation.png) |
| F07 | 刷新草稿/版本恢复，退出再恢复同一演练，清理当前记录，恶意输入以文本显示 | PASS；无脚本执行、无 API/外部请求、无原需求保存 |
| 视觉/兼容 | 三种 PC 宽度不遮挡输入；展开保留草稿；原框架边界/样式与改前一致 | 自动验证 PASS；[展开体验](flow-prototype-20260912/expanded.png)、[改前样式](flow-prototype-20260912/reference-shell.json)；人工视觉待评审 |
| PG 前端边界 | 合成 PG DTO 普通画布可读、只读禁写；领域源码不变 | PASS；[PG DTO](flow-prototype-20260912/pg-dto-view.png)，不代表真实 PG 集成回归 |

另用隔离 Edge 验证直接打开 index.html 的 file URL：secureContext/locks 均为 true，演练入口可用，浏览器关闭；见 [file-entry-check.json](flow-prototype-20260912/file-entry-check.json)。移动端不在 PC 范围；其他浏览器、完整读屏、弱网真实集成及生产性能未作覆盖。

## 缺陷、复核与剩余风险

模型先经历缺模块的预期红灯。自审再用失败测试复现验收退回后单项仍全 PASS，修正为指定去重项 FAIL、历史结果保留；损坏产物在加载时阻断。修正下游建议无采纳主动作、退出恢复入口和键盘焦点承接，均有后续实际验证。首次浏览器入口检查过早，失败截图显示页面已进入演练，改为等待异步保存结束。最终 12 条批次未失败。

附加配置检查曾由测试驱动错误构造 PATH 引入系统 Node18，仓库检查按预期阻断。按规定激活 Node24 后通过，[失败输出](flow-prototype-20260912/additional-checks-first-attempt.json)保留；没有修改版本门禁。一次自动审批超时依其返回指示重试后执行成功，不构成风险豁免。

原型是确定性样板。自由输入不代表真实 AI 已理解；演练身份不是服务端权限，Web Locks 不是 PostgreSQL 事务，模拟终端不是 Shell，模拟发布/观察不是生产证据。真实 PG 会话尚未回归，后续需单独授权相应实库测试包。没有生产部署、观察窗口或发布后 smoke，不能声明生产就绪或全平台完成。

## 清理与交付

新增浏览器最终执行 PID 43612、临时端口 58426，finally 关闭服务和隔离 context；原领域浏览器 PID 21760/11604、端口 5194 和 M1 联调 PID 8868、端口 5191 均报告关闭/可用。独立进程与端口回查见 [process-cleanup.json](flow-prototype-20260912/process-cleanup.json)。测试合成数据随进程/context 丢弃，原需求前后读回一致；本轮合成 PNG/JSON 留库用于评审，原临时目录/.local 证据原位保留，不含真实材料或凭据。

无并行代理；原有 PostgreSQL 未操作。准确源码清单/哈希见 [source-manifest.json](flow-prototype-20260912/source-manifest.json)。功能结果以最终验证源码为准；feature 提交推送后仍待陈立视觉/业务评审，main 合并需独立授权。回退按已审查文件差异，不清空用户数据。
