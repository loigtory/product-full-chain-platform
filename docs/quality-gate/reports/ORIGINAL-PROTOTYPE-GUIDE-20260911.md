# 原版原型完善与开发交接验证

2026-09-11。原型模型检查 **11/11 PASS**，独立 Edge 浏览器场景 **13/13 PASS**，三档 PC 宽度通过。可用于后续方案评审、开发拆解和验收用例设计。正式平台没有恢复开发，本结果不表示 CAP 集成、业务验收或发布完成。

## 授权、范围与实现

用户要求“继续完善原型直到可以指导后续方案及开发”，此前已选择原版 `index.html`。本轮分类为独立交互原型迭代，保留原版三栏、八阶段、对话卡和双终端。采用原版扩展方案；没有重绘另一套视觉稿。设计与范围依据见 [实施检查点](../../planning/prototype-v3/原版完善检查点.md)，详细交接见 [05-原版开发交接](../../planning/prototype-v3/05-原版开发交接.md)。

| 维度                | 本轮结论                                                                             |
| ------------------- | ------------------------------------------------------------------------------------ |
| Parent POD / 里程碑 | POD-PFC-001 / M2                                                                     |
| CAP / Unit 范围     | 全部 5 CAP / 26 Unit 的交互及接入映射；不修改正式交付台账                            |
| 原型实现            | 新需求到观察复盘、材料/问题/版本/评审、作业控制、团队能力和异常场景已补齐            |
| 正式实现 / 集成     | 保持原状态；未改 apps/packages、迁移、数据库、Bridge 或真实 API                      |
| 验收                | 原型自动验证通过；陈立作为产品/视觉接受人，最终人工结论待查看本版                    |
| 发布                | 未提交、未推送、未发布、未部署                                                       |
| 延后范围            | 真正的持久化、AI/Shell/MCP、Zed 交接、身份权限、团队连接和完整 CAP-05 按正式方案接入 |
| POD 下一路由        | `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`，未替换为 UI 迭代                    |

原版单文件按数据、模型、工作区、空间、治理、各类动作和启动器分为 11 个本地脚本；样式原样提取，新增表单与状态使用独立扩展 CSS。入口路径保留。基线备份和 V3 四文件指纹全部一致。

## 环境与数据设计

Windows / 项目 Node 24.20.0 / npm 11.19 / 现有 Playwright + 无头 Edge。Browser 插件未列出，使用 frontend-testing-debugging 的 Playwright 替代路径。没有安装或升级依赖。浏览器启动曾受沙箱 `spawn EPERM` 限制，按已授权本地测试范围经过自动审批执行；页面 HTTP/HTTPS 全部阻断，最终记录没有页面错误和外发请求。

配置来源为脚本内本地 file URL、独立浏览器上下文与固定时钟，不读取 `.env.local`、凭据或真实服务配置。模型工厂创建 `CODEx_TEST_GUIDE`；浏览器 `fresh()` 在独立上下文重建原型的三条合成需求 R-1042/R-1031/R-1018，新建输入使用 `CODEx_TEST_GUIDE`。原型独立 key 为 `pfc.prototype.original.guide.v1`，测试验证重置不影响另一个 `CODEx_TEST_OTHER` key。

数据场景包括正常提醒需求、缺少必填字段、材料敏感等级/文件边界、角色只读、版本变更/并发冲突、运行和取消/未知/核验、测试失败/修复、验收拒绝、发布过期/失败/回滚和观察窗口。工厂与固定时钟使预期可重复；不使用真实客户数据，不写标准库或测试 schema。

createdIds 仅存在于独立浏览器 localStorage/模型内存，浏览器测试结束销毁；没有真实产品数据或外部数据需要清理。合成截图和报告保留在 [证据目录](../../../output/pfc-workbench-prototype/evidence-guide-20260911/report.json)，作为本轮评审基线；临时目录 `C:\Users\hz19114673\AppData\Local\Temp\pfc-guide-i2HrUZ` 有同份测试输出，可按系统临时文件策略清理。保留截图均为合成场景。

## 用例与结果

公共前置条件：上述独立本地环境、工厂初始化、固定时钟；执行人 Codex，业务/视觉接受人陈立。用例以原型源码和本轮选定范围检查；不代替正式平台测试程序。

| 用例组  | 需求 / 风险与操作                                                          | 预期                                               | 自动化 / 结果       |
| ------- | -------------------------------------------------------------------------- | -------------------------------------------------- | ------------------- |
| B01     | 原版入口、工作区、双终端                                                   | 三栏/8阶段保留，两处同一 run 的行一致              | Playwright / PASS   |
| B02     | 创建需求 → 问题/版本 → 开发 → 测试失败/修复 → 验收 → 发布 → 复盘           | 前置条件逐阶段校验，刷新保留，最终退出待办         | Playwright / PASS   |
| B03     | 运行 → 取消请求/确认 → 核验 → 新尝试 → 刷新未知                            | 取消不变100%；重试有 parentId；UNKNOWN 先核验      | Playwright / PASS   |
| B04     | 等待输入、范围授权、Web/Zed 交接                                           | 同一作业继续，控制端和镜像一致                     | Playwright / PASS   |
| B05     | 编辑确认过的产物、比较、并发保存                                           | 旧正文不变；新内容安全显示；冲突保留草稿           | Playwright / PASS   |
| B06     | 上传 MD、材料纳入影响、受限材料                                            | 归属发起需求；基线变化；受限不进入 AI              | Playwright / PASS   |
| B07     | 当前需求能力调整、切只读角色                                               | 团队及其他需求不被修改；只读拒绝写入               | Playwright / PASS   |
| B08     | 中文输入、草稿、搜索、URL 后退、Esc                                        | 组合输入不误发、草稿不丢、导航准确                 | Playwright / PASS   |
| B09     | 加载、失败重试、空空间、重置                                               | 有退出/恢复路径；只清除原型 key                    | Playwright / PASS   |
| B10     | 能力登记/复核/启用、成员、工作区、撤销/配对、审计                          | 各步骤独立，动作留痕，撤销不删历史                 | Playwright / PASS   |
| B11     | UNKNOWN 核验为未知/运行/成功；只读 MCP 与摘要                              | 不把核验等同取消；MCP 写合成新版本并可追踪         | Playwright / PASS   |
| B12     | 验收驳回 → 新开发 → 重测验收；发布过期/失败/回滚/拒绝                      | 旧成功不能跳过返工；发布状态和历史分别保留         | Playwright / PASS   |
| B13     | 5类页面与产物画布 × 1280/1440/1920                                         | 无根节点横向溢出，header52px，图标≤32px            | Playwright / PASS   |
| M01–M11 | 状态、权限、不可变版本、核验五类结果、过期、返工、并发、坏存储、旧结果迟到 | 前置拒绝、正确转移、旧数据保留，不用过期结果过门禁 | Node VM / 11组 PASS |

浏览器细节步骤与断言在 [verify-guide-browser.mjs](../../../output/pfc-workbench-prototype/verify-guide-browser.mjs)，模型覆盖在 [verify-guide-model.mjs](../../../output/pfc-workbench-prototype/verify-guide-model.mjs)。共保存 24 张截图；实际浏览了工作区、画布、汇总页、治理和发布异常代表画面，视觉基线见 [参考研究](../../design-system/PFC-ORIGINAL-PROTOTYPE-REFERENCE-20260911.md)。

## 命令与门禁

所有 npm 命令均先在 PowerShell 激活项目 `.tools/node-v24.20.0-win-x64`。从本仓库执行：

| 命令 / 检查                                                                                       | 结果                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run test:gate:quick -- --dry-run`                                                            | READY；仅启动前规划，不计 Quick PASS                                                 |
| `.\.tools\node-v24.20.0-win-x64\node.exe output/pfc-workbench-prototype/verify-guide-model.mjs`   | PASS，11组                                                                           |
| `.\.tools\node-v24.20.0-win-x64\node.exe output/pfc-workbench-prototype/verify-guide-browser.mjs` | PASS，13组，errors=[]，outbound=[]                                                   |
| `npm run check:delivery-governance`                                                               | PASS：5 CAP / 26 Unit / M2 / R3a                                                     |
| `npm run check:ui-design`                                                                         | PASS，raw_visual_values=0；此检查针对正式源码边界，不等于原型 CSS 已迁入 UI 库       |
| `node:vm.Script` 解析 `original/*.js`                                                             | PASS，11个脚本                                                                       |
| 本地资源/备份/V3 指纹校验                                                                         | PASS，13个引用均存在；5个保护文件不变；base.css 与备份 style 内容一致                |
| 定向 `prettier --check`                                                                           | PASS，仅本轮文件；原样提取的 base.css 不重排                                         |
| 文档本地链接与 26 Unit 集合校验                                                                   | PASS，原型交接的26 Unit与台账集合相同；不将外部 URL 可访问性纳入本次离线验证         |
| Edge 三档计算样式读回                                                                             | PASS，252px左栏、368px右栏、52px导航、14px正文、8px卡片圆角；见 visual-readback.json |

正式 Quick/Core/Full 未执行：本轮仅修改独立 output 原型和文档，没有恢复正式应用。此前正式 `check:types` 有5处 MCP 版本字段问题，属于旧报告结论，本轮没有修复或重新验证。没有进行标准数据库连接/迁移、真实 Codex/Bridge/MCP、多人/多设备、远程发布或生产验证。

## 审查、修复与限制

首轮浏览器检查发现测试工具定位到了弹窗遮罩而非按钮，以及未等待异步附件读取完成；已修正测试定位与等待。材料读取期间锁定发起需求，防止切换需求后归属错误。

收尾模型审查新增回归先出现预期失败：UNKNOWN 核验被统一写为 CANCELLED。随后修复为五类回传结果，并生成成功证据。另补验收驳回需新成功作业、旧基线迟到结果不覆盖当前提测、过期确认在列表和画布一致、坏存储恢复等检查。最终回归全部通过，没有用跳过断言消除失败。

本轮为独立原型迭代，采用比例验证，不将生成的测试结果当真人验收。完整多 CAP 汇总、显式多对多追踪、细粒度角色分工、测试/观察历史、完整发布快照和真实工具安全边界已列入开发交接，仍需正式产品/技术设计。只读角色是演示，不是身份安全实现。原型 localStorage 为浏览器演示记录，不具备 PostgreSQL 的产品事实保证；大量数据、磁盘配额、长期日志和真实弱网/负载未验收。

交付度量：本轮未预设独立计时起点，不给无依据工期或提效百分比；记录了首轮工具测试失败、一次新增模型回归的预期失败，以及最终 11+13 组通过。后续正式实现应复用这些场景，重点防止旧版本/旧运行证据误过门禁。没有部署，因此无发布后观察窗口或线上缺陷结论。

## 回退与进程

入口备份：[index-before-development-guide-20260911.html](../../../output/pfc-workbench-prototype/_backup/index-before-development-guide-20260911.html)。需要回退时，将其复制回 `index.html` 即恢复本轮前单文件原型；`original/` 可保留供对照，旧入口不引用它。不要误用更早的原始未修复备份。

当前入口 SHA-256：`fd3887c4447a9d7d9e0e20fb899562dd1b22da4c3cce29c7e44d1d0fc5c5821e`。入口、11个脚本、2个样式和2个检查脚本共同定义版本，完整指纹见 [source-manifest.json](../../../output/pfc-workbench-prototype/evidence-guide-20260911/source-manifest.json)。

没有启动平台服务、预览端口、子代理或测试 watcher；Playwright 浏览器在 `finally` 中关闭。通过只读进程查询确认没有 verify-guide-browser 或 Playwright Edge 测试进程残留。首次沙箱内 CIM 读取被拒，未将其空输出当成通过；自动审批后的读回为 NO_PROTOTYPE_TEST_PROCESS_REMAINING。本轮无需要保留运行的服务。恢复正式开发后仍从 POD 的 R3a 路由开始，原型状态不写入交付台账。

## 最终版回填验证（同日追加）

在上一轮 11+13 组回归之后，按 [能力缺口与补齐优先级](../../planning/prototype-v3/06-能力缺口与补齐优先级.md) 第 7 节完成最终版增量实现并回归。入口与目录不变；改动前全量备份至 `output/pfc-workbench-prototype/_backup/final-before-<时间戳>/`（14 个文件）。回归脚本：`verify-final2.cjs`（全流程）、`verify-diff.cjs`（Diff 专项）、`verify-proposal.cjs`（建议过期与重发专项）。

| 检查项 | 结果 |
| --- | --- |
| 语法（node --check，10 个 original JS） | 全部 PASS |
| 治理中心 5 Tab / 交付中心+交付包下载 / 产品空间 / 工作区入口 | PASS，0 console error |
| 附件队列（enqueueFile，文本1KB）→ 发送 → 消息内附件卡 | PASS |
| 引用材料 v1 → 引用条 → 发送 → 消息内“本轮使用”chips | PASS |
| 停止答复（保留已输出部分） | PASS |
| 引用回复 → 下一条消息引用行 | PASS |
| 工作区文件卡（成功作业3文件）→ 文件预览弹窗 | PASS |
| 产物下载 / 交付包下载（Blob） | PASS，`R-1042-dev-v1.md`、`R-1042-delivery-package.md` |
| Diff：“把 30 天改为 45 天”→ Diff 卡 → 采纳生成 `R-1042-idea-v2`，下游 7 阶段全部置 stale，画布自动切换 | PASS |
| proposal 过期：产物变化后点旧建议 → “需求、产物或作业已变化，建议过期；请重新发起对话” | PASS |
| 重发：failed 用户消息 → 重发按钮 → 形成 `resent:true` 新回合 | PASS |
| 页面错误（console.error / pageerror） | 0 |

残余限制（如实声明）：发送时仍在打字的旧答复 flush 为全文；工作区运行/文件/失败日志为合成演示数据；附件二进制不持久化（刷新需重传）；PDF/Word/XLSX 正文为演示解析。正式接入要求不变。

## UI 交互与配色复核（同日二轮）

全页面 Playwright 截图走查（首页、工作区三面板、产品空间 5 Tab、交付中心、治理中心 5 Tab、附件菜单、消息增强区）后调整：

| 项 | 调整 | 依据 |
| --- | --- | --- |
| 顶部导航高亮 | 工作区页高亮“我的工作台”而非“交付中心” | 从“我的工作台→继续作业”进入，高亮跳变不合理 |
| toast 语义色 | `P.toast(msg, type)` 支持 error（深红）/ warn（深琥珀），错误提示不再与成功同色 | 错误信息需要视觉区分 |
| 附件按钮图标 | “＋”改为回形针（clip） | 加号语义不明，回形针提示上传/附件 |
| 消息内引用 chips | 绿色底改为品牌蓝底（`--brand-soft`/`--brand-strong`） | 引用是“本轮使用”而非成功状态，避免语义错位 |
| 附件预览弹窗 | `open-attachment` 由 1120px 宽改为默认 620px | 附件预览不需要 wide 布局 |
| 搜索框 | 增加 hover 与 focus-within 反馈 | 可点击全局搜索入口需要可见交互态 |
| 附件卡/工作区文件行 | 增加 hover 边框与微阴影 | 提示可预览/可点击 |
| 引用回复目标条 | 保持消息引用行 | 复核通过，无需调整 |

复核后完整回归 `verify-final2.cjs` 仍 0 console error，下载与 Diff 链路不受影响。全站配色保持品牌蓝 `#00A0E9` + 语义色体系（绿成功/橙警告/红错误/紫 Skill/蓝 MCP/青终端工具），未引入新色系。

## 正确性修复（同日三批，生产级审查 P0/P1 优先项）

针对生产级审查报告中用户确认要修的 3 项优先缺陷（跨需求隔离、受限材料权限、Diff 采纳原子保存），另附带修复审查中的 2 个同链路问题（待发送预览、不支持类型重试）。改动文件：`model.js`（ui 状态 + `P.uiBag`）、`app.js`、`workbench.js`、`guide.css`；改动前已备份至 `_backup/fix-before-<时间戳>/`。

| 缺陷 | 修复 | 验证 |
| --- | --- | --- |
| A03/A04 附件与引用跨需求串台 | 待发送附件/引用/回复目标从全局单值改为按需求隔离的 `P.s.ui.pending[req]`（`P.uiBag()` 访问）；发送只清当前需求；`enqueueFile` 异步回调经闭包归属发起时需求，切换后仍写回原队列 | Playwright：R-1042 挂 1 附件+1 引用 → 切 R-1031 队列为空、发送消息无附件无引用 → 切回 R-1042 队列仍在 |
| A05 受限材料被引用发送 | 引用材料列表对 `allowed===false` 材料禁用并标注"仅登记 · 不可引用"；`pick-ref` 增加运行时断言"该材料仅登记、不用于 AI，不能加入本轮引用" | 双重验证：UI disabled + 直接调用 `pick-ref` 抛断言 |
| D01 Diff 采纳不原子保存 | `accept-diff` / `reject-diff` 末尾补 `P.save(); P.render()`，采纳后立即持久化并刷新画布 | 采纳"把 30 天改为 45 天"后立即读 localStorage：idea-v2 已落盘、`ui.version` 同步 |
| A02 待发送附件预览"附件不存在" | `open-attachment` 先查当前需求待发送队列，再查已发送消息 | 队列中 note.md 点预览弹出 `note.md · 预览` |
| A06 不支持类型重试变合法 | `retry-pending` 对"不支持/超过"类错误拒绝重试并提示移除后重新添加 | 代码断言 + 提示文案 |

另补：`pick-ref` 立即 `P.save()`（引用刷新不丢，对应 G06）；新增"正在回复"行（`reply-tray`，含取消按钮），回复目标在发送前可见、可撤销。

回归：`verify-fix1.cjs`（隔离/权限/原子保存/预览 4 组断言）+ `verify-final2.cjs`（完整流程 + 下载）+ `verify-ui.cjs` 全部通过，0 console error。正式路线 P0–P4 不变；审查报告中其余 P0/P1（G01 并发、D02 建议绑定、W02 runId 等）仍按生产级验收方案推进。

## 正确性修复（同日四批，剩余 P0/P1）

承接三批继续修复生产级审查剩余 4 项：G01 并发覆盖、D02 建议绑定、W02 runId 定位、A08 原图保留。改动文件：`app.js`、`workbench.js`、`actions.js`。

| 缺陷 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- |
| G01 冲突时导航覆盖共享存储 | `P.go` 无条件 `P.save()`，冲突只读下仍把旧快照写回 | 冲突中导航只更新本地视图、不写 localStorage（`if (!P.conflict) P.save()`） | 模拟另一窗口写入新 revision + 新建 R-NEW → 冲突后点导航"产品空间"：R-NEW 仍存在、revision 未被覆盖、0 console error |
| D02 连发两条建议点第一条采纳的是第二条 | Diff 按钮无消息绑定，`accept-diff` 按"最新未应用"兜底 | 采纳/拒绝按钮绑定 `mid`（消息 ID），按 ID 精确定位 | 两条建议均生成后点第一条的采纳：`firstApplied=true`、第二条未动、生成 v2 |
| W02 搜索历史 run 回退最新作业 | `data-runid` 在 dataset 中变 `runid`（全小写），`open-work` 读 `d.runId` 永远 null | `runId: d.runId \|\| d.runid \|\| null` 兼容两种取值 | 构造第二作业 R-200 后搜索 R-102 打开：`uiRunId=R-102`、`activeRun=R-102` |
| A08 截图发送后只剩 160px 缩略图 | `enqueueFile` 只生成 160px 缩略图，原图丢弃 | 新增 `P.raws` 内存映射存原图 dataURL（不持久化，刷新回退缩略图）；预览优先 `P.raws[id] \|\| thumb` | 1200×800 合成截图发送后预览 `naturalWidth=1200` |

回归：`verify-fix2.cjs`（W02/D02/A08/G01 四组断言，G01 用真实工厂数据）+ `verify-fix1.cjs` + `verify-final2.cjs` + `verify-ui.cjs` 全部通过，0 console error。审查报告 P0/P1 至此全部关闭。

## P2 修复（同日，生产级审查第 5 节剩余 4 项）

承接 P0/P1 全部关闭后，继续修复 P2：A09 引用来源视图、G02 只读拖拽粘贴反馈、G04 影响评估弹窗明细、G05 测试批次历史详情。改动文件：`workbench.js`、`app.js`、`actions.js`、`guide.css`。

| 缺陷 | 修复 | 验证 |
| --- | --- | --- |
| A09 "本轮使用"引用是不可点击标签，无法回到来源版本 | 引用 chips 改 `<button data-action="ref-source" data-idx>`；新增 `A['ref-source']` 弹窗：材料（名称/编号版本/级别使用/状态/内容前 300 字）、产物（标题/版本/状态/前 4 字段值），并带失效提示（材料已排除/待影响评估；产物有新版本/标记 stale/草稿未确认） | 发送带引用消息后点 chip：弹"引用来源 · 材料"，含名称/版本/状态 |
| G02 只读成员拖入/粘贴附件产生未处理页面异常 | paste 与 drop 监听内 `P.write()` 包 try/catch，失败时 `P.render()` + 错误 toast，不再抛未处理异常 | 只读角色模拟粘贴图片：显示"只读成员可以查看…"错误 toast、未添加附件、0 console error |
| G04 影响评估弹窗只有通用文案，无当前材料明细与队列数 | `A['material-impact']` 弹窗改 impact-card：材料名/版本/编号/级别/摘要前 200 字 + 队列剩余条数提示 | 连续两条待处理变更时打开弹窗：含名称/版本/摘要/impact-card |
| G05 测试批次历史摘要不可点，无详情 | 历史条目改为按钮 `data-action="test-batch-detail" data-id`；新增 `A['test-batch-detail']` 弹窗：时间/基线/执行人 + 用例结果表 + 按 runId 关联缺陷表 | 两批次后点历史条目：弹"测试批次 · TEST-xxxx"，含基线/用例表/关联缺陷 |

附带修复：`A['test-batch-detail']` 内 `badge` 改为 `P.badge`（app.js 模块无局部 `badge`，原写法会导致弹窗打开失败并转错误 toast）。样式：`guide.css` 新增 `.kv-row`（键值行，A09/G05 共用）、`.impact-card`（影响卡片，橙色语义）、`button.ref-chip` hover/focus。

回归：`verify-p2.cjs`（A09/G04/G05/G02 四组断言）+ `verify-fix1.cjs` + `verify-fix2.cjs` + `verify-final2.cjs` + `verify-ui.cjs` 全部通过，0 console error。生产级审查 P0/P1/P2 缺陷清单至此全部关闭；剩余为规格待设计范围（发布冻结快照、观察复盘、团队分工、长上下文压缩等），按后续迭代推进。备份：`_backup\fix-p2-before-20260911-234954`。

## 第 6 节待设计范围 7 领域改造（2026-09-12，生产级审查"剩余继续修复"）

按生产级审查报告第 6 节（§103–130）7 个待设计领域全部实现，退出条件（§119–130）逐项达标。改动文件：`model.js`、`app.js`、`actions.js`、`workbench.js`、`run-actions.js`、`spaces.js`、`governance.js`、`delivery-actions.js`、`guide.css`；改动前全量备份至 `_backup/fix-scope6-before-20260912-003428/`（14 个文件）。

| 领域 | 实现 | 验证 |
| --- | --- | --- |
| 1 文件解析与留存 | `enqueueFile` 按类型差异化：text 截断至 50,000 字符并标记 `charCount/truncated/fullInMemory`；image 原图存 `P.raws`；pdf/word/sheet 各自演示解析摘要 + 页数/段数/表数 meta。`open-attachment` 重写为"解析与原件分离"视图（类型/大小/数量、截断提示、全文下载按钮、图片原件预览、刷新失效提示），新增 `download-attachment-text` | 文本截断+60,000 字符计数、图片原件预览、PDF 12 页摘要均通过断言 |
| 2 对话与差异 | 新增 `diff-full`（字段级完整前后对照弹窗，含来源消息/时间、采纳/拒绝）、`msg-source`（引用回复定位原消息：阶段/时间/角色/正文/附件/引用上下文）；`searchResults` 扩展为产物字段值全文命中+材料内容命中+对话消息全文命中，产物命中带 version 精确跳转 | diff-full 双字段对照、引用来源弹窗含附件均通过；搜索产物/材料/消息命中已实现 |
| 3 执行与工作区 | `startRun` 作业增加 git 元数据（repo/branch/commit/dirty）、预算（8000 起）、队列（并发上限 3、排队计数）；runCard 头部显示仓库/分支提交/队列预算行；`open-ws-file` 重写为变更前/变更后双栏 code-preview（测试文件标"新增无前置版本"），头部含 branch@commit | runCard 仓库/分支/dirty 徽标/队列行断言通过；文件 before/after 双栏含新旧内容通过 |
| 4 CAP 与分工 | Unit 增加 `owner/dep`；req 阶段表与 trace 关系追踪改为 Unit 分工矩阵（Unit/负责人/依赖/状态/关联 AC/执行测试）；新增 `unit-owner`/`save-units`（成员下拉 + 状态选择，变更写 timeline 留痕）；治理中心团队页新增"角色矩阵 · 可执行动作"表（7 动作 × 负责人/执行者/只读） | 分工保存后 owner/status 落库且 timeline 留痕通过；角色矩阵 7 行渲染通过 |
| 5 发布快照 | `releaseAction` approve 时冻结快照（stamp+8 阶段产物版本+作业+测试+验收+目标+冻结时间）；execute 前断言快照与当前一致，审批后产物变化使发布置 STALE 并提示"原审批已失效"（由 `P.invalidate` 实现）；releaseCard 显示冻结行+失效提示+历史发布记录（`release-snapshot` 弹窗可按历史包生成交付） | approve 生成快照、execute 成功进入观察、产物变更后 STALE+失效提示+无执行按钮，全部断言通过 |
| 6 观察复盘 | observation 增加 `entries`（每次保存追加一条：时间/指标/来源/发布版本）、`anomaly`（回滚记异常）、`followups`（后续事项：文本\|负责人\|状态）、`releaseSnapshot`；observeCard 展示多轮观测表+异常+后续事项表；窗口未结束 finish 被拒；rollback 记录 anomaly | 两次观测 entries=2、后续事项 2 条含负责人、窗口门禁拒绝与完成均通过 |
| 7 文档与门禁 | 交付中心增加"当前结论"列（唯一口径：已复盘/观察中/已验收·发布态/待验收/测试待通过/阶段）；修复验收卡矛盾：factory 对 accept 及以上阶段创建验收记录（R-1031 由"状态卡已通过/验收卡待验收"统一为 ACCEPTED）且验收产物标记已确认；acceptCard 增加不一致防御（验收通过但无测试/缺陷未关闭时提示补门禁证据）；`deliver-package` 重写：支持按冻结快照/历史发布生成、产物版本标注草稿、新增"当前结论"节、结尾声明"草稿/缺失内容不冒充正式交付" | 交付中心 3 行唯一结论通过；R-1031 验收/测试一致无矛盾；伪造"无测试已通过"触发防御提示 |

回归：新增 `verify-scope6.cjs`（7 领域 20+ 断言）全绿 0 console error；历史基线 `verify-fix1/fix2/final2/ui/p2` + `check-g01/check-reply-tray/check-w02` 全绿 0 console error（verify-fix2 手造 R-200 补 `lines:[]` 等完整字段，属脚本构造修正）。截图存 `ui-review/s6-01~12.png`。残余限制不变：文件二进制不持久化、运行/文件/解析为演示数据、正式接入要求不变。
