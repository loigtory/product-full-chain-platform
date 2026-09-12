# M2-R2 平台启动审批修订验证报告

> 日期：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 范围：R2-T1/T3/T5/T6 平台 `RUN_START` 修订  
> 总结论：`AUTOMATED_PASS / ACCEPTANCE_BLOCKED`

## 设计与实现结论

产品负责人已确认方案 A。`WORKSPACE_WRITE` Run 和写重试现在先持久化 `RUN_START` 待审批事实，批准前数据库不存在 `START_WORKSPACE_WRITE_RUN`。独立审批者批准后，repository 在同一事务重校验 baseline、workspace、Bridge、Skill、ArtifactVersion、RunScope 和有效期，再唯一创建启动命令。拒绝、过期和待审批取消均进入终态且不创建启动命令。`RUN_START` 不接受任何 App Server identity，批准范围必须与审批页展示并绑定的固定 RunScope 完全一致；运行中的 App Server 权限审批仍允许在请求范围内缩小授权。

App Server 运行中的 command/file/permissions 请求仍保留为额外权限审批；它们不再承担平台启动门禁。启动重校验已从审批 repository 拆分到独立持久化模块，页面只消费共享 UI primitives 和 tokens。

## 测试数据与环境

- 运行时：项目固定 Node `24.20.0`、Codex App Server `0.153.4`、PostgreSQL `pfc_local`（loopback）。
- 自动化数据库数据：确定性 `CODEx_TEST_` 数据，只进入自动清理的 `codex_test_*` schema。
- App Server 数据：合成本地源文件和一次性胶囊；网络关闭，注册源工作区只做 hash 读回。
- 敏感数据：报告未记录数据库 URL、密码、二进制路径或原始 thread id。

## 验证结果

| 检查                                             | 结果                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| contract/domain/application/UI/architecture 聚焦 | PASS，6 files / 31 tests                                                                                                  |
| R2 API/DB/Bridge/control 聚焦                    | PASS，5 files / 29 tests                                                                                                  |
| persistence 全文件                               | PASS，13 tests；批准前 0、批准后 1、拒绝/过期 0、并发批准 1、重试前 0                                                     |
| 真实 App Server 三场景                           | PASS；批准写 1 个授权文件，拒绝零启动，取消后 0 变更                                                                      |
| Quick Gate                                       | PASS，66 files / 303 tests                                                                                                |
| Core Gate                                        | PASS，22 integration files / 101 tests，build 与 DB 检查 PASS，残留测试 schema 0                                          |
| Full Gate                                        | PASS；permission 44、concurrency 20、recovery 32、security 25、performance 3、PC browser 36、dependency vulnerabilities 0 |

真实 App Server runId 为 `CODEx_TEST_M2_R2_APP_SERVER_1f37161f516b`。批准场景仅修改胶囊内 `docs/requirements/acceptance.md`，源工作区 hash 不变；拒绝场景没有创建胶囊或启动 App Server；取消场景收到 `TURN_STARTED` 后中断，结果 `CANCELLED`。两个实际 thread 均删除，胶囊、合成源和 App Server 均已清理。

## 未完成与残余风险

标准 `pfc` migration 预检通过，但精确执行 `202609060005_create_m2_approval_control` 被自动风险审查拒绝，标准 schema 未改变。不得通过直接 SQL 或其他路径绕过。

因此以下仍为阻断项：标准库两个 `CODEx_TEST_M2_R2_*` 账号、真实 Browser -> API -> PostgreSQL -> Bridge -> App Server 双人审批链路、R2 专项 1280/1440/1920 浏览器证据，以及具名代码评审/测试/安全/产品视觉验收。Full Gate 的 36 项通用 PC 回归不等于 R2 业务验收。

发布状态保持 `NOT_AUTHORIZED`。功能回滚仍为关闭 `WORKSPACE_WRITE` capability 和写入口；数据库 migration 一旦执行只允许前向修复。

## 交付指标与下一路线

- 本次修订与代码复核共关闭 4 个审批边界问题：App Server 审批非必然、写重试直接启动、`RUN_START callbackId` 未强制为空、固定启动范围与实际执行范围可能不一致。
- 真实烟测首次取消因 turn 尚未进入可中断状态返回 `-32600`；补充 `TURN_STARTED` 时序门禁后通过。
- 环境启动失败 1 次：Quick Gate 首次误用全局 Node 18；切换项目固定 Node 后通过。
- 最终 Full Gate 首次在类型检查阶段失败 1 次：新测试对象的字面量类型被扩大；补充显式参数约束后从头重跑并通过。
- 下一唯一路线：`POD-PFC-001/M2/R2/standard-local-migration-authorization`。
