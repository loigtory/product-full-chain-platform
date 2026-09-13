# M2c-4 发布观察：实施差异与验证报告

当前为 **LOCAL_VERIFIED / PENDING_REVIEW**。用户已同意的历史验收恢复规则已实现；完整30条门禁通过，末次UI修复后静态、架构及浏览器专项复跑通过，最终聚合记录当前源码及复测来源；模型11/API20/浏览器14。业务规则待决定项为零，具体视觉和业务验收仍由陈立确认。

## 确认范围与最终行为

原37号A/D1–D8及63源码/七文档/六隔离目标/30闸包继续适用；本次从31f50e7续修，用户对同一冻结计划重评并沿用原验收核实UNKNOWN的方案回复“同意”。[本次确认记录](m2c-4-release-observation-20260913/recovery-decision-20260913.json)，[原确认包](m2c-4-release-observation-20260913/authorization-20260913.json)，设计与检查点见[38号](../../planning/prototype-v3/38-M2c-4发布观察实施与验收-20260913.md)。

- 发布准备评审、具名发布/回退、观察指标与遗留项、最终验收/复盘继续承接同一需求。平台记录USER_REPORTED事实，未执行或核验外部发布。
- 原批准人停用/降权时，现任Owner可重评未变的冻结计划，核实原UNKNOWN。只忽略历史成员当前权限；当前操作者/批准者权限、业务版本/epoch/指纹、附件可用性、时间和前序链仍校验。
- 原尝试的review_id、历史验收及原批准不变；新评审注明冻结验收和原记录，追加核实结果保存验收ID与重评ID。新尝试及普通release-inputs仍要求当前有效验收，客户端不能打开此例外。
- 评审提示放在意见输入附近；结果详情显示历史验收和重评依据。409/503草稿恢复、跨需求/身份隔离和原三栏交互保留。修复后台刷新清空缓存时“核对最新依据”不能重新读取工作区的问题，仍先验证当前需求与表单身份。

父POD-PFC-001 / 正式M2 / 映射UNIT-PFC-05-03/04/05（正式M3成员）；正式5CAP26Unit及唯一POD-PFC-001/M2/R3a/artifact-collaboration-tdd不变。本轮未启用标准业务PG，未合并main，未接真实Shell/CI或部署。

## 本次续修文件

较31f50e7修改10个已授权源码/测试文件，没有新增源码、路由、SQL或依赖。7份交接文档与本轮证据同步；原固定报告和截图先另存新输出再恢复原文。原始SHA及全部63文件读回见[文件差异](m2c-4-release-observation-20260913/recovery-source-diff.json)。

| 文件                                                            | 31f50e7行数 → 当前行数 |
| --------------------------------------------------------------- | ---------------------- |
| `server/src/domain/release-policy.js`                           | 377 → 403              |
| `server/src/domain/release-read-service.js`                     | 211 → 220              |
| `server/src/domain/release-plan-service.js`                     | 192 → 210              |
| `server/src/domain/release-record-service.js`                   | 185 → 202              |
| `output/pfc-workbench-prototype/original/release-actions.js`    | 805 → 824              |
| `server/test-data/m2c-release-fixture.mjs`                      | 123 → 214              |
| `server/verify-m2c-release-model.mjs`                           | 245 → 310              |
| `server/verify-m2c-release.mjs`                                 | 879 → 1040             |
| `output/pfc-workbench-prototype/verify-m2c-release-browser.mjs` | 651 → 782              |
| `server/src/domain/verification-read-service.js`                | 358 → 394              |

架构保持路由/应用服务/读取/仓储分工。冻结确认选择是release-policy纯函数；verification读取复用可选内部校验，默认仍检查当前成员。仅发布重评/同尝试核实决定是否启用该参数，HTTP输入不传递该开关。新架构闸检查纯策略无持久化依赖、路由委派和2806个受保护文件原字节。

## 全轮63文件差异

相对main0689723仍为27新增、35修改、1未变化；无删除。下表按实际当前行数列明，禁止为凑数修改未变化文件。

| 文件                                                                | 状态      | main行数 → 当前行数 |
| ------------------------------------------------------------------- | --------- | ------------------- |
| `server/sql/m2c/006-release-observation.sql`                        | NEW       | 0 → 113             |
| `server/src/domain/release-policy.js`                               | NEW       | 0 → 403             |
| `server/src/domain/release-read-service.js`                         | NEW       | 0 → 220             |
| `server/src/domain/release-dto.js`                                  | NEW       | 0 → 125             |
| `server/src/domain/release-plan-service.js`                         | NEW       | 0 → 210             |
| `server/src/domain/release-record-service.js`                       | NEW       | 0 → 202             |
| `server/src/domain/observation-service.js`                          | NEW       | 0 → 281             |
| `server/src/domain/final-acceptance-service.js`                     | NEW       | 0 → 135             |
| `server/src/domain/release-guard.js`                                | NEW       | 0 → 41              |
| `server/src/persistence/release-plans.js`                           | NEW       | 0 → 182             |
| `server/src/persistence/release-records.js`                         | NEW       | 0 → 31              |
| `server/src/persistence/release-observations.js`                    | NEW       | 0 → 55              |
| `server/src/persistence/release-closure.js`                         | NEW       | 0 → 45              |
| `server/src/persistence/release-evidence.js`                        | NEW       | 0 → 94              |
| `server/src/persistence/release-readiness.js`                       | NEW       | 0 → 173             |
| `server/src/routes/releases.js`                                     | NEW       | 0 → 88              |
| `server/src/routes/observations.js`                                 | NEW       | 0 → 67              |
| `output/pfc-workbench-prototype/original/release-client.js`         | NEW       | 0 → 191             |
| `output/pfc-workbench-prototype/original/release-view.js`           | NEW       | 0 → 195             |
| `output/pfc-workbench-prototype/original/release-actions.js`        | NEW       | 0 → 824             |
| `output/pfc-workbench-prototype/original/observation-view.js`       | NEW       | 0 → 123             |
| `output/pfc-workbench-prototype/original/observation-actions.js`    | NEW       | 0 → 445             |
| `server/test-data/m2c-release-fixture.mjs`                          | NEW       | 0 → 214             |
| `server/verify-m2c-release-model.mjs`                               | NEW       | 0 → 310             |
| `server/verify-m2c-release.mjs`                                     | NEW       | 0 → 1040            |
| `server/verify-m2c-release-architecture.mjs`                        | NEW       | 0 → 159             |
| `output/pfc-workbench-prototype/verify-m2c-release-browser.mjs`     | NEW       | 0 → 782             |
| `server/src/index.js`                                               | MODIFIED  | 157 → 159           |
| `server/src/contract.js`                                            | MODIFIED  | 125 → 164           |
| `server/src/runtime.js`                                             | MODIFIED  | 142 → 145           |
| `server/src/domain/membership-policy.js`                            | MODIFIED  | 93 → 95             |
| `server/src/persistence/commands.js`                                | MODIFIED  | 81 → 81             |
| `server/src/persistence/migrations.js`                              | MODIFIED  | 392 → 408           |
| `server/src/persistence/identifiers.js`                             | MODIFIED  | 68 → 79             |
| `server/src/domain/requirement-service.js`                          | MODIFIED  | 703 → 712           |
| `server/src/domain/artifact-service.js`                             | MODIFIED  | 562 → 573           |
| `server/src/domain/verification-read-service.js`                    | MODIFIED  | 354 → 394           |
| `server/src/domain/conversation-service.js`                         | MODIFIED  | 383 → 391           |
| `output/pfc-workbench-prototype/index.html`                         | MODIFIED  | 55 → 60             |
| `output/pfc-workbench-prototype/original/api-client.js`             | MODIFIED  | 387 → 432           |
| `output/pfc-workbench-prototype/original/domain-view.js`            | MODIFIED  | 262 → 267           |
| `output/pfc-workbench-prototype/original/domain-actions.js`         | MODIFIED  | 463 → 464           |
| `output/pfc-workbench-prototype/original/testing-view.js`           | MODIFIED  | 261 → 262           |
| `output/pfc-workbench-prototype/original/acceptance-view.js`        | MODIFIED  | 66 → 68             |
| `output/pfc-workbench-prototype/verify-static.mjs`                  | MODIFIED  | 119 → 125           |
| `server/test-data/m2c-domain-fixture.mjs`                           | MODIFIED  | 403 → 417           |
| `server/test-data/m2c-governance-fixture.mjs`                       | MODIFIED  | 174 → 175           |
| `server/test-data/r2-artifact-fixture.mjs`                          | UNCHANGED | 169 → 169           |
| `server/test-data/r3-verification-fixture.mjs`                      | MODIFIED  | 187 → 191           |
| `server/verify-m2c-domain.mjs`                                      | MODIFIED  | 1402 → 1402         |
| `server/verify-m2c-governance.mjs`                                  | MODIFIED  | 1023 → 1024         |
| `server/verify-r2-artifact-model.mjs`                               | MODIFIED  | 294 → 295           |
| `server/verify-r2-artifacts.mjs`                                    | MODIFIED  | 843 → 844           |
| `server/verify-r2-architecture.mjs`                                 | MODIFIED  | 176 → 177           |
| `server/verify-r3-verification-model.mjs`                           | MODIFIED  | 267 → 267           |
| `server/verify-r3-verification.mjs`                                 | MODIFIED  | 1067 → 1067         |
| `server/verify-r3-architecture.mjs`                                 | MODIFIED  | 167 → 201           |
| `output/pfc-workbench-prototype/verify-m2c-browser.mjs`             | MODIFIED  | 567 → 567           |
| `output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs`  | MODIFIED  | 551 → 551           |
| `output/pfc-workbench-prototype/flow-browser-fixture.mjs`           | MODIFIED  | 190 → 190           |
| `output/pfc-workbench-prototype/verify-flow-architecture.mjs`       | MODIFIED  | 320 → 320           |
| `output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs`     | MODIFIED  | 555 → 555           |
| `output/pfc-workbench-prototype/verify-r3-verification-browser.mjs` | MODIFIED  | 524 → 524           |

## 验证结果

固定Node24.20.0/npm11.19.0，现有根/server依赖离线核验通过；Quick dry-run为READY_TO_RUN，仅作环境计划。原生JS/Express原型按已确认的30条命令验证，不把正式React工程的dry-run视为通过。

**以下30条首次于10:44:34–10:50:46 UTC完整执行并全部通过。** 最终读图后仅release-actions.js及其浏览器测试有改动：补缓存失效恢复与独立身份会话验证。静态、29号架构及30号浏览器已按当前源码复跑通过；1–28保留未受影响的原命令输出，当前63指纹无漂移。证据汇总于11:11:05 UTC完成：[最终命令、原始输出及复测来源](m2c-4-release-observation-20260913/gates-recovery-final.json)，[首次完整运行](m2c-4-release-observation-20260913/gates-recovery-2026-09-13T10-44-34-281Z.json)。使用精确相对证据变量PFC_M2C_EVIDENCE_DIR=本根/domain、PFC_R3_EVIDENCE_DIR=本根、PFC_FLOW_EVIDENCE_DIR=本根/flow、PFC_M2C4_EVIDENCE_DIR=本根；测试仅写包内隔离目标。

| #   | 命令                                                                     | 结果 |
| --- | ------------------------------------------------------------------------ | ---- |
| 1   | `node output/pfc-workbench-prototype/verify-prototype.mjs`               | PASS |
| 2   | `node output/pfc-workbench-prototype/verify-m1-layer.mjs`                | PASS |
| 3   | `node output/pfc-workbench-prototype/verify-m1-e2e.mjs`                  | PASS |
| 4   | `node server/verify-server.mjs`                                          | PASS |
| 5   | `node server/verify-server-m2.mjs`                                       | PASS |
| 6   | `node server/verify-m2b.mjs`                                             | PASS |
| 7   | `node output/pfc-workbench-prototype/verify-m2b2-model.mjs`              | PASS |
| 8   | `node server/verify-m2b2-domain.mjs`                                     | PASS |
| 9   | `node output/pfc-workbench-prototype/verify-m2b2-browser.mjs`            | PASS |
| 10  | `node server/verify-m2c-pg.mjs`                                          | PASS |
| 11  | `node server/verify-m2c-architecture.mjs`                                | PASS |
| 12  | `node server/verify-m2c-domain.mjs`                                      | PASS |
| 13  | `node output/pfc-workbench-prototype/verify-m2c-browser.mjs`             | PASS |
| 14  | `node server/verify-m2c-governance.mjs`                                  | PASS |
| 15  | `node output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs`  | PASS |
| 16  | `node output/pfc-workbench-prototype/verify-flow-model.mjs`              | PASS |
| 17  | `node output/pfc-workbench-prototype/verify-flow-browser.mjs`            | PASS |
| 18  | `node output/pfc-workbench-prototype/verify-flow-architecture.mjs`       | PASS |
| 19  | `node server/verify-r2-artifact-model.mjs`                               | PASS |
| 20  | `node server/verify-r2-artifacts.mjs`                                    | PASS |
| 21  | `node server/verify-r2-architecture.mjs`                                 | PASS |
| 22  | `node output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs`     | PASS |
| 23  | `node server/verify-r3-verification-model.mjs`                           | PASS |
| 24  | `node server/verify-r3-verification.mjs`                                 | PASS |
| 25  | `node server/verify-r3-architecture.mjs`                                 | PASS |
| 26  | `node output/pfc-workbench-prototype/verify-r3-verification-browser.mjs` | PASS |
| 27  | `node server/verify-m2c-release-model.mjs`                               | PASS |
| 28  | `node server/verify-m2c-release.mjs`                                     | PASS |
| 29  | `node server/verify-m2c-release-architecture.mjs`                        | PASS |
| 30  | `node output/pfc-workbench-prototype/verify-m2c-release-browser.mjs`     | PASS |

补充 `node output/pfc-workbench-prototype/verify-static.mjs`（42脚本/39模块）、`node scripts/check-config.mjs`、`node --import tsx scripts/check-delivery-governance.ts` 全部PASS，见[静态/配置/治理输出](m2c-4-release-observation-20260913/recovery-static-config.json)。10份修改源码Prettier.check、5份修改服务ESLint全部PASS，见[源码检查](m2c-4-release-observation-20260913/recovery-source-static.json)；未改lint配置。

## 浏览器与人工评审

Browser plugin not available，采用已有Playwright/Edge，file入口output/pfc-workbench-prototype/index.html，配套临时loopback API。14组覆盖原业务链、三档PC宽度1280/1440/1920、异常恢复和新增现任Owner重评→核实停用人员原尝试→观察→回查结果。页面异常事件0、外部请求0，全部窗口/服务在finally关闭；[最终浏览器输出](m2c-4-release-observation-20260913/release/browser-2026-09-13T11-08-47-075Z.json)。

| 检查                       | 结果与证据                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| 页面、非空内容与异常覆盖层 | 实际原型入口显示发布/观察工作区，未见异常覆盖层                                             |
| 关键操作                   | 当前Owner通过键盘Enter重评、沿原记录核实并独立读回一条观察；缓存失效后可重新核对依据        |
| 运行与网络                 | 14组页面异常事件0、外部请求0；新增独立恢复会话console警告/错误0、HTTP异常0；503注入断言恢复 |
| 视觉                       | 1440宽重评说明及结果追溯截图已读图核对；原PC三档用例通过                                    |
| 人工验收                   | PENDING_REVIEW；自动化不替代陈立的视觉和业务确认                                            |

[重评提示截图](m2c-4-release-observation-20260913/release/recovery-review-1440.png)，[沿用验收与原结果截图](m2c-4-release-observation-20260913/release/recovery-result-1440.png)。恢复场景使用新浏览器上下文和现任Owner，实际路由标题“PFC · 我的工作台”已断言，键盘触发重评通过；该会话console警告/错误和HTTP异常清单已归档，均为空。其他13组未全量归档console，结论限页面异常、交互和故障注入证据；真实多用户负载与长时稳定性仍未测。

## 数据、清理与失败记录

数据全部来自CODEx_TEST_确定性factory，先通过真实隔离API构造业务/设计/开发/测试/验收/批准，再降权或停用原Owner。新用例验证原验收/尝试绑定不改写、连续UNKNOWN、未重评拒绝、普通输入继续阻断、前序与开始时间不可换、业务goal/design_epoch变化及证据撤权阻断。SQL只用于已授权隔离故障和独立断言；成员停用后的测试恢复仅命中本fixture的成员，不新增产品重新启用API。

六个精确schema按原上限执行；本次独立只读连接确认全部不存在，五原件根0文件，[清理读回](m2c-4-release-observation-20260913/recovery-cleanup-independent.json)。创建ID和实际行数由每套fixture输出记录，临时JWT不写报告。新旧合成证据原文保留供评审；忽略目录里的原脚本临时产物按既定策略保留，不纳入提交。

本轮测试辅助进程均结束，5188–5196无监听；[进程读回](m2c-4-release-observation-20260913/recovery-process-readback.json)。保留任务前已有PG13528/5432、API31152/3001、Vite37744/5173；停止命令见38。无子代理、新常驻进程或外部副作用。

失败证据保留：API旧规则409（api-2026-09-13T10-32-44-082Z）和纯规则缺函数（model-1789295850773）构成失败→通过过程。GET携带null、停用清理误用API、观察页错找发布按钮是前置测试驱动问题。末次读图另发现旧身份会话遗留401提示，改用独立上下文；随后确定性清空缓存复现“核对最新依据”阻断，修复产品读取逻辑后通过。页面动态标题曾与测试的静态标题预期不符，按app.js实际路由标题纠正测试。未扩大产品接口或超时；所有失败JSON、截图和gates-recovery-ui-failed.json保留，最终聚合30项均PASS。

新增API失败回归至首次完整30闸约19分钟，首次完整运行约6分13秒；末次UI复核及受影响复测于11:11:05 UTC汇总结束。此前文档读取/方案记录耗时未单独采集。补充复盘：D2/D3应在方案中列出人员变更与UNKNOWN的组合状态；新增模型/API/UI回归防止再次漏掉，不形成新的全局流程要求。

## 交付边界与下一步

本轮实现LOCAL_VERIFIED，隔离集成ISOLATED_PG_VERIFIED；业务规则待决定项已关闭，人工验收PENDING_REVIEW。陈立为产品/工程/评审/测试/安全负责人，同人角色已获认可，各结论独立记录。feature按23收工提交推送后交陈立评审，未据规则确认合并main或声明整个平台完成。

回退到31f50e7会恢复旧规则的阻断，本次无SQL变化。标准业务PG、实际部署、发布后smoke/readiness、观测窗口和真实费用没有执行或样本，后续启用须独立确认目标/备份/回滚与监控。本次原型验收后回父POD核对能力矩阵，正式下一路线保持不变。
