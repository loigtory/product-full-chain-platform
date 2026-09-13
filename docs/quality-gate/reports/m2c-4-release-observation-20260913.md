# M2c-4 发布观察：实施差异与验证报告

状态：已实现范围的自动门禁30/30通过；一个业务规则待确认，整轮DECISION_PENDING，人工验收待具体交付。

## 范围与设计确认

用户确认37号A/D1–D8；基线 `0689723`，feature `feat/m2c-release-observation`。授权为63个源码/测试路径、七份文档、指定证据根、六个精确隔离PG目标及30条门禁。确认原文和归一化设计哈希见 [authorization](m2c-4-release-observation-20260913/authorization-20260913.json)。

父级POD-PFC-001 / 正式M2；本轮映射UNIT-PFC-05-03/04/05（正式M3成员）。正式5CAP/26Unit、集成/验收状态和唯一下一路线 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd` 不变。业务PG启用、真实执行、main合并、正式发布均未授权。

## 行为与架构差异

- 发布准备可早于产品验收保存；准备完成后送Owner评审，冻结交付/测试/产品验收/目标/AC及证据。新草稿不替换已批准计划。
- 发布与回退仅登记USER_REPORTED；未知结果只能核实原尝试。成功且冒烟通过才生成不可改写报告并进入观察。
- 观测按服务端窗口、指标前序与序号追加；异常、阻断遗留项和证据不可用会阻断最终验收。Owner单独确认最终结论；结案仍能追加非阻断遗留处理及聊天附件。
- 发布后业务修改必须显式返回修复；验证覆盖新交付/新测试/新产品验收/第二轮发布，旧报告和结果保留。
- 原三栏保留；发布工作区可回查只读上游成果/测试。动态表单、409显式比较、503及写成功读失败保留草稿和原命令；身份/需求/服务地址隔离。
- 006新增11表，三个业务入口委派保护。新模块按policy/read/DTO/应用服务/仓储/路由拆分；001–005和依赖未改。

当前精确差异为27新增、35修改、1未变化；无删除。逐文件状态、原/新行数与指纹见 [source-diff-review](m2c-4-release-observation-20260913/source-diff-review.json)。

| 文件                                                                | 状态      | 原行数 → 当前行数 |
| ------------------------------------------------------------------- | --------- | ----------------- |
| `server/sql/m2c/006-release-observation.sql`                        | NEW       | 0 → 113           |
| `server/src/domain/release-policy.js`                               | NEW       | 0 → 377           |
| `server/src/domain/release-read-service.js`                         | NEW       | 0 → 211           |
| `server/src/domain/release-dto.js`                                  | NEW       | 0 → 125           |
| `server/src/domain/release-plan-service.js`                         | NEW       | 0 → 192           |
| `server/src/domain/release-record-service.js`                       | NEW       | 0 → 185           |
| `server/src/domain/observation-service.js`                          | NEW       | 0 → 281           |
| `server/src/domain/final-acceptance-service.js`                     | NEW       | 0 → 135           |
| `server/src/domain/release-guard.js`                                | NEW       | 0 → 41            |
| `server/src/persistence/release-plans.js`                           | NEW       | 0 → 182           |
| `server/src/persistence/release-records.js`                         | NEW       | 0 → 31            |
| `server/src/persistence/release-observations.js`                    | NEW       | 0 → 55            |
| `server/src/persistence/release-closure.js`                         | NEW       | 0 → 45            |
| `server/src/persistence/release-evidence.js`                        | NEW       | 0 → 94            |
| `server/src/persistence/release-readiness.js`                       | NEW       | 0 → 173           |
| `server/src/routes/releases.js`                                     | NEW       | 0 → 88            |
| `server/src/routes/observations.js`                                 | NEW       | 0 → 67            |
| `output/pfc-workbench-prototype/original/release-client.js`         | NEW       | 0 → 191           |
| `output/pfc-workbench-prototype/original/release-view.js`           | NEW       | 0 → 195           |
| `output/pfc-workbench-prototype/original/release-actions.js`        | NEW       | 0 → 805           |
| `output/pfc-workbench-prototype/original/observation-view.js`       | NEW       | 0 → 123           |
| `output/pfc-workbench-prototype/original/observation-actions.js`    | NEW       | 0 → 445           |
| `server/test-data/m2c-release-fixture.mjs`                          | NEW       | 0 → 123           |
| `server/verify-m2c-release-model.mjs`                               | NEW       | 0 → 245           |
| `server/verify-m2c-release.mjs`                                     | NEW       | 0 → 879           |
| `server/verify-m2c-release-architecture.mjs`                        | NEW       | 0 → 159           |
| `output/pfc-workbench-prototype/verify-m2c-release-browser.mjs`     | NEW       | 0 → 651           |
| `server/src/index.js`                                               | MODIFIED  | 157 → 159         |
| `server/src/contract.js`                                            | MODIFIED  | 125 → 164         |
| `server/src/runtime.js`                                             | MODIFIED  | 142 → 145         |
| `server/src/domain/membership-policy.js`                            | MODIFIED  | 93 → 95           |
| `server/src/persistence/commands.js`                                | MODIFIED  | 81 → 81           |
| `server/src/persistence/migrations.js`                              | MODIFIED  | 392 → 408         |
| `server/src/persistence/identifiers.js`                             | MODIFIED  | 68 → 79           |
| `server/src/domain/requirement-service.js`                          | MODIFIED  | 703 → 712         |
| `server/src/domain/artifact-service.js`                             | MODIFIED  | 562 → 573         |
| `server/src/domain/verification-read-service.js`                    | MODIFIED  | 354 → 358         |
| `server/src/domain/conversation-service.js`                         | MODIFIED  | 383 → 391         |
| `output/pfc-workbench-prototype/index.html`                         | MODIFIED  | 55 → 60           |
| `output/pfc-workbench-prototype/original/api-client.js`             | MODIFIED  | 387 → 432         |
| `output/pfc-workbench-prototype/original/domain-view.js`            | MODIFIED  | 262 → 267         |
| `output/pfc-workbench-prototype/original/domain-actions.js`         | MODIFIED  | 463 → 464         |
| `output/pfc-workbench-prototype/original/testing-view.js`           | MODIFIED  | 261 → 262         |
| `output/pfc-workbench-prototype/original/acceptance-view.js`        | MODIFIED  | 66 → 68           |
| `output/pfc-workbench-prototype/verify-static.mjs`                  | MODIFIED  | 119 → 125         |
| `server/test-data/m2c-domain-fixture.mjs`                           | MODIFIED  | 403 → 417         |
| `server/test-data/m2c-governance-fixture.mjs`                       | MODIFIED  | 174 → 175         |
| `server/test-data/r2-artifact-fixture.mjs`                          | UNCHANGED | 169 → 169         |
| `server/test-data/r3-verification-fixture.mjs`                      | MODIFIED  | 187 → 191         |
| `server/verify-m2c-domain.mjs`                                      | MODIFIED  | 1402 → 1402       |
| `server/verify-m2c-governance.mjs`                                  | MODIFIED  | 1023 → 1024       |
| `server/verify-r2-artifact-model.mjs`                               | MODIFIED  | 294 → 295         |
| `server/verify-r2-artifacts.mjs`                                    | MODIFIED  | 843 → 844         |
| `server/verify-r2-architecture.mjs`                                 | MODIFIED  | 176 → 177         |
| `server/verify-r3-verification-model.mjs`                           | MODIFIED  | 267 → 267         |
| `server/verify-r3-verification.mjs`                                 | MODIFIED  | 1067 → 1067       |
| `server/verify-r3-architecture.mjs`                                 | MODIFIED  | 167 → 201         |
| `output/pfc-workbench-prototype/verify-m2c-browser.mjs`             | MODIFIED  | 567 → 567         |
| `output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs`  | MODIFIED  | 551 → 551         |
| `output/pfc-workbench-prototype/flow-browser-fixture.mjs`           | MODIFIED  | 190 → 190         |
| `output/pfc-workbench-prototype/verify-flow-architecture.mjs`       | MODIFIED  | 320 → 320         |
| `output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs`     | MODIFIED  | 555 → 555         |
| `output/pfc-workbench-prototype/verify-r3-verification-browser.mjs` | MODIFIED  | 524 → 524         |

## 验证与边界

使用项目Node24.20.0/npm11.19.0及已有离线依赖。标准工程Quick仅dry-run；本轮实际验收入口是37号30条原型命令。fullstack-quality-gate与frontend-testing-debugging用于组织比例验证；Browser plugin not available，使用现有Playwright/Edge。

最终API17组、浏览器13组、模型10组及架构5项通过，42脚本/39模块静态通过；30条门禁全部通过，最终63源码指纹与分步回归关联见 [gates-final](m2c-4-release-observation-20260913/gates-final.json)。这是一份包含保留前序结果及受影响重跑的证据汇总，不声称首轮一次全绿。失败轮保留，不把旧源码或失败输出算最终PASS。所有真实执行端点继续CAPABILITY_UNAVAILABLE。

## 数据设计、清理和进程

factory通过API创建有效前置，负向覆盖角色、状态、版本、边界、并发、权限和恢复。数据均CODEx_TEST_，六精确schema/OID/标记/行数上限及原件根按确认包；SQL仅初始化、故障和独立断言，不写业务schema。每次finally记录createdIds及schema/原件/进程清理，独立连接核对其他schema元数据。最新局部API1683行、浏览器451行，分别读回schema/原件/进程零残留；全量结束后六schema不存在、五原件根文件数0，见 [独立清理](m2c-4-release-observation-20260913/cleanup-independent.json)；进程见 [独立进程读回](m2c-4-release-observation-20260913/process-readback.json)。

新证据只含合成材料、命令和页面；不含凭据或真实业务数据。持久证据随feature保留供评审。旧命令原生输出的ignored .local/临时报告本地保留，不提交、不清理历史证据。预存PG13528/5432、旧API31152/3001、Vite37744/5173保留，本轮临时API/Edge串行并关闭。

## 唯一待确认业务规则

UNKNOWN时，若原批准人停用或降权同时令原产品验收/上游具名依据失效，37号D2要求当前Owner重新评审，D3又要求核实原尝试且不能另开轮次。是否允许当前Owner在同一冻结基线上复评后沿用历史验收快照核实原尝试，仍需陈立决定。当前按失败关闭，不绕过上游有效性。

推荐允许对未改变的原计划/原尝试进行历史事实核实；原件可用性、当前Owner、目标/版本/实际时间继续校验，不新建尝试，不执行部署。若不允许，需要另明确恢复有效产品验收的路径，不能在UNKNOWN下私自回流改产品。仅原准备评审人失效而产品输入仍有效的情况已实现并通过API；这不代替上述决定。

## 自审与回退

实际发现并修复：UNKNOWN未执行冒烟被要求填结果、来源false绕过、派生报告初次确认顺序、发布后上游历史导航、观测前序未校验、动态草稿结构恢复、SQL分页与响应界限、明确验收依据。测试驱动错误另列：附件替换200误期望201、错误SQL断言字段、故障SQL缺search_path；没有将这些误判为产品bug。旧13/15浏览器各一次间歇超时，原源码原命令复跑通过；完整闸第12次因运行器把严格相对证据路径转绝对而启动前拒绝，修正环境值后继续，同源首11条结果保留。

后续人工接受人为陈立，以具体feature提交、差异与三档PC截图确认；当前设计同意不视为业务/视觉验收。真实多人负载、长时间观察、外部监控/CI/部署/成本未测试。回退为未启用业务PG前撤回本feature或回到已验收main；不把005程序连接006视为降级。业务启用须另行确认迁移、同点备份、smoke/readiness、监控和回滚触发。

## 完成闸与下一步

30闸及独立清理已完成，feature检查点保留唯一待确认项。该项决定后补对应回归，再交具体原型人工验收；本轮完成返回父POD核对能力矩阵，不自动启动真实工具接入或改正式路线。

## 最终命令结果

| #   | 命令（固定Node24.20.0）                                                  | 结果 |
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

末轮浏览器发现503后恢复入口依赖下一次重绘；已修复失败分支立即刷新，增加按钮存在断言，13组完整复跑通过。新客户端只改变发布写失败路径，静态和新架构再次通过；未重复无关旧门禁，关联记录见gates-final的adaptations。每轮失败输出保留。

设计确认至当前检查点约120分钟（08:06–10:06 UTC，包含实施、回归、定位和文档，非个人绩效指标）。实际业务发布/观察、真实多人负载及外部费用均无样本。
