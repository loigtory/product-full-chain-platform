# R3 测试验收验证报告

结论：LOCAL_VERIFIED，26/26原生闸PASS；人工视觉/业务验收PENDING，发布NOT_AUTHORIZED。范围为35号确认包，完整差异、设计确认、角色结论和后续路线见[36号](../../planning/prototype-v3/36-R3测试验收实施与验收-20260913.md)。父POD-PFC-001/M2/5CAP26Unit及唯一next route POD-PFC-001/M2/R3a/artifact-collaboration-tdd不变。

## 命令与输出

下列命令均从本仓库根执行，使用固定Node24.20.0，退出码均0。新证据根PFC_R3_EVIDENCE_DIR=docs/quality-gate/reports/r3-test-acceptance-20260913，旧domain/flow证据参数只指向本根对应子目录。前9闸保持原脚本临时目录，不覆盖历史；stdout原始执行证据收入下列JSON，临时浏览器上下文/服务由各闸关闭；报告/截图已归入legacy，索引和临时源目录留存说明见legacy/evidence-index.json。

[完整26闸输出与59源码指纹](r3-test-acceptance-20260913/gates-final.json)。最终汇总前21项沿用gates-1789281429358.json的PASS输出；第22项测试驱动准备动作修正后，与R3四项重新执行通过。该变更只影响测试驱动，运行时代码保持；每条结果标明evidenceRun及原始输出。

| 命令                                                                   | 结论 |
| ---------------------------------------------------------------------- | ---- |
| node output/pfc-workbench-prototype/verify-prototype.mjs               | PASS |
| node output/pfc-workbench-prototype/verify-m1-layer.mjs                | PASS |
| node output/pfc-workbench-prototype/verify-m1-e2e.mjs                  | PASS |
| node server/verify-server.mjs                                          | PASS |
| node server/verify-server-m2.mjs                                       | PASS |
| node server/verify-m2b.mjs                                             | PASS |
| node output/pfc-workbench-prototype/verify-m2b2-model.mjs              | PASS |
| node server/verify-m2b2-domain.mjs                                     | PASS |
| node output/pfc-workbench-prototype/verify-m2b2-browser.mjs            | PASS |
| node server/verify-m2c-pg.mjs                                          | PASS |
| node server/verify-m2c-architecture.mjs                                | PASS |
| node server/verify-m2c-domain.mjs                                      | PASS |
| node output/pfc-workbench-prototype/verify-m2c-browser.mjs             | PASS |
| node server/verify-m2c-governance.mjs                                  | PASS |
| node output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs  | PASS |
| node output/pfc-workbench-prototype/verify-flow-model.mjs              | PASS |
| node output/pfc-workbench-prototype/verify-flow-browser.mjs            | PASS |
| node output/pfc-workbench-prototype/verify-flow-architecture.mjs       | PASS |
| node server/verify-r2-artifact-model.mjs                               | PASS |
| node server/verify-r2-artifacts.mjs                                    | PASS |
| node server/verify-r2-architecture.mjs                                 | PASS |
| node output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs     | PASS |
| node server/verify-r3-verification-model.mjs                           | PASS |
| node server/verify-r3-verification.mjs                                 | PASS |
| node server/verify-r3-architecture.mjs                                 | PASS |
| node output/pfc-workbench-prototype/verify-r3-verification-browser.mjs | PASS |

## T01–T18覆盖与结果

[模型9组](r3-test-acceptance-20260913/testing/model.json)；[PG集成18组](r3-test-acceptance-20260913/testing/integration.json)；[浏览器9组](r3-test-acceptance-20260913/testing/browser.json)；[架构4组](r3-test-acceptance-20260913/testing/architecture.json)。用例前置、数据设计、角色和退出依据沿35第六/七节，自动化由Codex执行，人工接受人为陈立。

| 用例        | 已执行场景                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| T01/T02     | 未确认业务/设计时提前生成草稿并重启恢复；完整字段/AC/稳定ID/200与201边界；编辑导入导出、比较和显式采用         |
| T03/T04     | 旧开发版本、RUNNING/CANCELLING/UNKNOWN作业和通用推进拒绝；人工来源明确，伪造CI/AI结果拒绝                      |
| T05/T06     | 单项及批量，混入跨需求证据/坏用例整批回滚；并发序号、前结果、命令重放与变更载荷拒绝                            |
| T07/T08     | FAIL带入缺陷、修复声明、新开发版本/新交付、回归FAIL重开/PASS关闭；缺结果/未执行/阻塞/失败/未关缺陷阻断         |
| T09/T10     | Owner通过/驳回及降权后重放拒绝；采用套件、开发变化、测试/验收/发布准备时上游变化回流；旧OPEN批次追加撤销旧放行 |
| T11/T12     | 未引用新附件不改变输入；撤权、跨需求、实际原件损坏/缺失与登记人降权阻断；新阶段报告/附件会话及派生报告不可改   |
| T13         | 409比较更新依据、503原命令重试、POST成功GET失败只创建一次、刷新/跨需求/成员切换、旧身份晚响应丢弃              |
| T14/T15     | 交付/结果/缺陷事件/验收/审计/事件/回执故障回滚与相同命令恢复；分页、5OPEN批次、用例/步骤/结果/证据/载荷边界    |
| T16/T17/T18 | 005缺表/停用触发器/校验和拒绝；旧003/004/005权限兼容；Edge三宽/键盘/焦点/附件手势；旧22闸和历史指纹保留        |

T15为本地边界/容量冒烟，未做生产吞吐或模型费用测量。测试用例中的USER_REPORTED也是合成数据，不代表真实产品人员完成业务测试。

## 清理、留存及风险

五个精确隔离schema不存在，四个原件根零残留：[独立读回](r3-test-acceptance-20260913/testing/cleanup-independent.json)。各fixture记录createdIds、OID、行数和原件摘要，并确认其他schema元数据不变。R3集成1198行，低于5000上限。报告/截图只含合成数据，作为Git证据保留；原件清零。

本轮API/Edge/runner全部关闭，原PG13528/5432、API31152/3001、Vite37744/5173保留，停止方法见36及[进程读回](r3-test-acceptance-20260913/testing/process-readback.json)。无子代理。受限环境的CIM读回经已授权系统只读调用完成。

2,589个受保护文件不变；[自审](r3-test-acceptance-20260913/testing/review.json)与[逐文件差异](r3-test-acceptance-20260913/testing/diff-review.json)供人工评审。没有超出确认范围的业务取舍。

标准业务PG/真实AI工具/CI/发布与观察尚未启用；本轮不变更正式CAP/Unit结论。发布后smoke/readiness、观察窗口及真实环境指标未执行，未来需确认备份、部署、监控及回滚方案。当前收工只交付feature，人工验收与main合并分开。
