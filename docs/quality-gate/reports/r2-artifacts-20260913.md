# R2关联产物与阶段承接 · 质量报告

当前结论：LOCAL_VERIFIED。同批22/22门禁全部PASS，52项源码指纹前后一致；附加静态、格式、配置、台账、历史和清理检查通过。003/004公共命令成员复核已按用户明确同意的单文件补充修复。人工业务/视觉/工程/测试/安全验收仍待陈立针对具体交付确认。

## 范围与环境

父POD-PFC-001/M2；影响CAP-PFC-01/02/03、UNIT-PFC-01-01～05、02-01～05、03-01～03，不提高正式完成度。implementation=LOCAL_VERIFIED，integration=ISOLATED_PG_VERIFIED（标准业务PG未启用），acceptance=PENDING。唯一POD next route保持POD-PFC-001/M2/R3a/artifact-collaboration-tdd。

用户确认33号A方案及原51项文件/四个隔离schema/22闸，并明确同意仅补commands.js至52项。M2c-3已验收合并推送main04fd81a；R2分支feat/r2-artifacts，开工2ea9ecd。详细设计、差异、问题和已批准最小补丁见[34号](../../planning/prototype-v3/34-R2关联产物实施与验收-20260913.md)。

固定Node24.20.0/npm11.19.0、既有Express/pg/Playwright/Edge，配置来自忽略的.env.local；无依赖变更。测试以PFC_DB=memory和空DATABASE_URL运行旧memory套件，PG工厂只在本机127.0.0.1:5432/pfc_local四个精确codex_test_m2c目标内建立合成对象。PFC_M2C_EVIDENCE_DIR=docs/quality-gate/reports/r2-artifacts-20260913/domain；PFC_FLOW_EVIDENCE_DIR=docs/quality-gate/reports/r2-artifacts-20260913/flow。需传这两个相对路径，脚本对其他路径失败关闭。

未提供Browser插件，沿用已有Playwright/Edge。PC宽度1280/1440/1920，关键按钮键盘和聊天焦点有验证；移动端不在范围，非Edge兼容未验证。原型入口仍为output/pfc-workbench-prototype/index.html。

## 改动及回归覆盖

| 场景 | 已执行覆盖                                                              | 限制或结论                                 |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------ |
| A01  | 未回答问题时部分候选保存、不可采纳、真实服务重启恢复                    | 固定模板/手工/文件模式，无真实AI           |
| A02  | 三产物组、只改验收项复用版本、历史hash保持                              | PRD沿用req_versions                        |
| A03  | 同基线并发采纳、同命令重放、改URL目标/载荷冲突                          | SQL独立读回有效组不重复                    |
| A04  | 版本/组/事件三处失败注入                                                | 事务、收据、审计、指针共同回滚             |
| A05  | 跨需求/租户、撤销原件allowed、损坏文件读/导入、恢复字节                 | 历史成果保留不等于继续消费撤销材料         |
| A06  | 两次确认并推进、旧PRD写入阻断                                           | 业务/设计与阶段同事务                      |
| A07  | 只改设计、问题变化、组采纳的影响                                        | 结合旧领域材料/评审回归；历史确认保留      |
| A08  | 旧待批计划失效；RUNNING/UNKNOWN阻止采纳                                 | 协议模拟，无真实工具                       |
| A09  | v2重启、确认人撤权后批准受阻                                            | v1只读/取消，不能新启动                    |
| A10  | JSON两页导航、表单校验、表格、弹窗、状态、PRD规则定位                   | 当前为限定组件JSON，不是自由拖拽设计器     |
| A11  | 不安全属性拒绝、HTML源码转义、原件下载字节一致、opaque-origin与伪消息   | 不执行上传HTML；外发请求列表为空           |
| A12  | 409/503、写后读失败、原commandId重试、刷新/重开/显式换基线、A/B晚到响应 | 读回竞态、重绘手势和聊天焦点另有确定性回归 |
| A13  | owner/executor/viewer/撤权、确认后撤权；公共命令复核前置                | PASS：003/004均在收据重放前复核当前成员    |
| A14  | 节点100/101、页数10/11、表格500/501、JSON超限、候选20/21                | 沿用旧上传/上下文上限回归；非真实容量压测  |
| A15  | 原18条回归和4条新增专项                                                 | 当前以最终完整批次为准                     |

新API13项、新浏览器10项；旧领域36项、旧PG浏览器15项定向通过。模型6/6，A13失败后通过同批完整回归。自动化场景、构造与断言详见33第六/七节和四个verify-r2入口；验收人为陈立，Codex执行自动化和自审。

## 已复现并修复的问题

004公共命令漏当前成员复核、幂等载荷漏URL目标、旧领域前置/开发入口/R1模拟DTO适配、预览重绘丢输入、按钮按下后节点替换丢click、成功提交读回被后台请求取代、旧领域写入后关联基线未同步、重绘时聊天焦点恢复判断失效。测试脚本中故障注入、列表/详情断言、滚动绘制、超时和证据路径口径问题也已修正；失败记录保留，不删除以凑PASS。

## 数据、清理和留存

所有业务样本为CODEx_TEST_合成数据，由确定性工厂产生，覆盖租户/需求/角色/状态/版本/边界/并发。每次attempt记录OID/marker、合成ID和文件hash，限制3000行/100MiB（storage200行），finally清理并独立SQL/文件读回。授权只覆盖33号四个精确目标，不写pfc/public/pfc_workbench。

本轮一次浏览器测试缺超时而中断，已核验并清理该attempt的124行与文件，证据为[中断清理](r2-artifacts-20260913/artifacts/aborted-browser-cleanup-1789261500.json)。该次不计PASS，完整运行前外部元数据指纹不可恢复；后续正常attempt均完成常规前后核验。报告/截图仅合成内容，保留供本次评审；真实上传、JWT和本地配置不入Git。

477份历史报告/截图与Git blob一致，见[历史报告指纹](r2-artifacts-20260913/artifacts/historical-report-integrity-commands.json)。164项历史源码/备份/SQL/原R1保护指纹由新架构专项验证。未重拍旧基线来代替差异。

## 人工验收、发布与风险

业务/视觉/工程/测试/安全验收待陈立针对具体交付确认；同人承担角色已获接受，各结论独立。三档[候选比较1440截图](r2-artifacts-20260913/artifacts/candidate-compare-1440.png)及1280/1920同目录可评审，自审看到原版三栏与比较弹窗保持。完整原始JSON编辑和文件原件预览限制已在UI说明，尚未实现真实模型自动生成、任意HTML执行或真实本地工具。

未部署/发布/启用业务PG，release、发布后smoke、观察窗口和监控为NOT_EXECUTED。长期版本增长、多人负载、非Edge、真实AI延迟/成本未实测；局部请求耗时/响应大小只反映本机合成功能测试。未来业务PG启用需单独确认迁移、数据库/文件同点备份、回滚、readiness和观察包。

## 验证原文与下一步

每条命令使用.tools/node-v24.20.0-win-x64/node.exe；原文包含退出码、耗时和stdout/stderr。最终同批为[gates-1789265262932](r2-artifacts-20260913/gates-1789265262932.json)，2026-09-13T02:07:42.932Z至2026-09-13T02:11:37.169Z，52项源码前后指纹相同。此前20/22及其他失败批次保留。

| #   | 固定Node执行的命令                                                      | 结果 | 原文与耗时                                                         |
| --- | ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| 1   | `node output/pfc-workbench-prototype/verify-prototype.mjs`              | PASS | [81.35秒](r2-artifacts-20260913/legacy/gate-1789265262932-01.json) |
| 2   | `node output/pfc-workbench-prototype/verify-m1-layer.mjs`               | PASS | [4.62秒](r2-artifacts-20260913/legacy/gate-1789265262932-02.json)  |
| 3   | `node output/pfc-workbench-prototype/verify-m1-e2e.mjs`                 | PASS | [4.31秒](r2-artifacts-20260913/legacy/gate-1789265262932-03.json)  |
| 4   | `node server/verify-server.mjs`                                         | PASS | [0.63秒](r2-artifacts-20260913/legacy/gate-1789265262932-04.json)  |
| 5   | `node server/verify-server-m2.mjs`                                      | PASS | [0.75秒](r2-artifacts-20260913/legacy/gate-1789265262932-05.json)  |
| 6   | `node server/verify-m2b.mjs`                                            | PASS | [6.82秒](r2-artifacts-20260913/legacy/gate-1789265262932-06.json)  |
| 7   | `node output/pfc-workbench-prototype/verify-m2b2-model.mjs`             | PASS | [0.11秒](r2-artifacts-20260913/legacy/gate-1789265262932-07.json)  |
| 8   | `node server/verify-m2b2-domain.mjs`                                    | PASS | [0.20秒](r2-artifacts-20260913/legacy/gate-1789265262932-08.json)  |
| 9   | `node output/pfc-workbench-prototype/verify-m2b2-browser.mjs`           | PASS | [13.29秒](r2-artifacts-20260913/legacy/gate-1789265262932-09.json) |
| 10  | `node server/verify-m2c-pg.mjs`                                         | PASS | [1.93秒](r2-artifacts-20260913/legacy/gate-1789265262932-10.json)  |
| 11  | `node server/verify-m2c-architecture.mjs`                               | PASS | [0.13秒](r2-artifacts-20260913/legacy/gate-1789265262932-11.json)  |
| 12  | `node server/verify-m2c-domain.mjs`                                     | PASS | [14.93秒](r2-artifacts-20260913/legacy/gate-1789265262932-12.json) |
| 13  | `node output/pfc-workbench-prototype/verify-m2c-browser.mjs`            | PASS | [20.11秒](r2-artifacts-20260913/legacy/gate-1789265262932-13.json) |
| 14  | `node server/verify-m2c-governance.mjs`                                 | PASS | [9.99秒](r2-artifacts-20260913/legacy/gate-1789265262932-14.json)  |
| 15  | `node output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs` | PASS | [18.41秒](r2-artifacts-20260913/legacy/gate-1789265262932-15.json) |
| 16  | `node output/pfc-workbench-prototype/verify-flow-model.mjs`             | PASS | [0.11秒](r2-artifacts-20260913/legacy/gate-1789265262932-16.json)  |
| 17  | `node output/pfc-workbench-prototype/verify-flow-browser.mjs`           | PASS | [15.39秒](r2-artifacts-20260913/legacy/gate-1789265262932-17.json) |
| 18  | `node output/pfc-workbench-prototype/verify-flow-architecture.mjs`      | PASS | [2.83秒](r2-artifacts-20260913/legacy/gate-1789265262932-18.json)  |
| 19  | `node server/verify-r2-artifact-model.mjs`                              | PASS | [0.10秒](r2-artifacts-20260913/legacy/gate-1789265262932-19.json)  |
| 20  | `node server/verify-r2-artifacts.mjs`                                   | PASS | [6.85秒](r2-artifacts-20260913/legacy/gate-1789265262932-20.json)  |
| 21  | `node server/verify-r2-architecture.mjs`                                | PASS | [16.58秒](r2-artifacts-20260913/legacy/gate-1789265262932-21.json) |
| 22  | `node output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs`    | PASS | [14.75秒](r2-artifacts-20260913/legacy/gate-1789265262932-22.json) |

附加检查：50个JS/MJS的node --check、51项已授权JS/MJS/HTML的Prettier、verify-static（32脚本语法/29模块lint）、npm run check:config、npm run check:delivery-governance均PASS。台账仍5CAP/26Unit/M2及原next route。原文见[supplemental-final](r2-artifacts-20260913/artifacts/supplemental-final.json)及其引用；一次性运行器曾误用不存在的.mjs治理路径，已按package.json实际ts命令复测，原失败未删除。没有改工程检查入口。

新架构专项确认52项白名单与164保护指纹；477份历史报告/截图重新对照Git blob一致。[最终数据读回](r2-artifacts-20260913/artifacts/final-data-readback-commands.json)：四个schema及三个文件根为零。[最终进程读回](r2-artifacts-20260913/artifacts/final-process-readback-commands.json)：本轮临时进程零残留。原有PG13528/5432、旧API31152/3001、Vite37744/5173及Codex内核42552/25260早于本轮，保持原样。

本机合成读取/采纳采样36次，10–46ms，最大响应8496字节；样本见[API专项](r2-artifacts-20260913/artifacts/integration-1789265465791.json)。这些结果不能推断多人吞吐或生产容量。收尾检查时间2026-09-13T02:17:33.040Z。完整回归6批，前5批失败，最后22/22通过；失败与返工用于过程改进。

文件级差异：52项允许路径中18新增、26修改、8无语义差异，详见34号和[source-diff](r2-artifacts-20260913/artifacts/source-diff.json)。唯一补范围commands.js已明确批准，实际一行条件修改；此前未应用补丁的[失败评审记录](r2-artifacts-20260913/artifacts/final-review.json)保留，新结论见[收尾评审](r2-artifacts-20260913/artifacts/closeout-review.json)。本报告随收工feature提交交付；最终提交SHA与远端读回由Git回执确认，不在提交前预写。R2 main合并仍待具体验收。
