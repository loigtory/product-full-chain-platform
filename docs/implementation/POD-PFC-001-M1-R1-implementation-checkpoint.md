# POD-PFC-001 M1-R1 实施检查点

> 状态：`INTEGRATED / ACCEPTANCE_BLOCKED`  
> 日期：2026-09-06  
> 设计依据：`POD-PFC-001-M1-R1-PFC02-PFC04-design-20260905.md`（`DESIGN_CONFIRMED`）

## 当前授权边界

- 允许：在本仓库实现并验证 M1-R1；在隔离 `codex_test_*` schema 创建和清理合成测试数据；对本地 `pfc_local.pfc` 执行已确认的前向迁移、standard 业务写入和读回。
- 不允许：commit、push、merge、部署、发布、远程数据库或外部系统写入；删除或迁移 `pfc_experience` 历史合成数据。
- 标准运行：`PFC_EXPERIENCE_MODE=false`、`FIXTURE_ADAPTERS_ENABLED=false`，业务事实仅来自本地 PostgreSQL `pfc` schema。

## 实施结果

1. `CAP-PFC-04 / UNIT-PFC-04-01～03`：应用账户、PostgreSQL 会话、团队、成员、需求分工和逻辑工作区已真实集成。
2. `CAP-PFC-02 / UNIT-PFC-02-01`：阶段产物目录与不可覆盖版本已真实集成。
3. `CAP-PFC-01 / UNIT-PFC-01-01～05`：标准权限、需求、门禁、时间线和运营视图已改用 PostgreSQL 业务事实。
4. Web 页面按身份、团队、产物、需求工作台和运营中心拆分；共享视觉仅来自 `packages/ui`。
5. 前向迁移 `202609060003_allow_artifact_gate_evidence` 使当前基线下的有效产物版本可作为门禁证据，并保持数据库级归属校验。
6. 人工门禁完成失败后，同一幂等请求可恢复既有 `IN_PROGRESS` 运行，不重复推进生命周期。

## 标准数据与读回

- 本地非客户需求：`REQUIREMENT_0cd191bf-7f83-4d52-8a68-10769b69ad5e`，当前阶段 G5，rowVersion 6。
- 产物：`artifact-da0cc949-b26b-4978-925e-42c31408a17b`，2 个不可变版本。
- PostgreSQL 读回：3 个账户、1 个团队、3 个成员关系、2 个需求分工、1 个工作区及绑定、5 个已完成门禁、5 条门禁证据。
- API/UI 读回：`TEAM_ADMIN`、`PRODUCT_MANAGER`、`TEST_OWNER` 三个角色均登录成功并读取同一需求 G5 和 5 次门禁记录；服务重启后数据未丢失。
- 数据为 standard 本地业务体验数据，不是 fixture；为用户继续体验而保留，不执行清理。

## 当前事实

- 设计确认：PASS。
- 开发与真实本地集成：PASS；M1 所需 9 个 Unit 均达到 `INTEGRATED`。
- 最新核心门禁：PASS；unit/contract 190，integration 69，build 和 PostgreSQL 检查通过，测试 schema 残留 0。
- 正式代码评审、测试、安全验收：责任人均已登记为陈立；本检查点形成时结论仍待记录。
- M1 里程碑：保持 `IN_PROGRESS`，直到各角色结论、G10 产品验收和观察结论写入；不因人员数量或独立性阻断。
- M2 设计：`DESIGN_CONFIRMED`；产品负责人已接受并行偏差，M2-R1 已进入源码级实现和隔离验证，但不改变 M1 的验收阻断状态。
- 发布：NOT_AUTHORIZED。

## 2026-09-06 恢复核对

- 产品负责人已确认 M2 受控作业闭环设计；确认不替代 M1 具名评审、G10 产品验收或观察结论。
- 本地 Web/API 体验服务于 07:47 启动；09:28 复核时 Web/API 健康，PostgreSQL 可连接，累计观察约 1 小时 40 分钟，尚不足一个本地工作日。
- 项目 Node `24.20.0`、npm `11.19.0` 和依赖树可读；使用项目 Node 执行 `check:config`、full gate dry-run 和 delivery governance 均通过。
- 直接调用项目目录的 `npm.cmd` 仍可能由系统 Node `18.17.1` 启动；后续门禁必须先把项目 Node 目录置于 PATH，不能把全局 Node 误当项目运行时。
- 代码评审、测试和安全责任人现统一登记为陈立；本检查点形成时没有对应结论，不得仅凭人员登记关闭 M1。
- 产品负责人随后明确接受“M1 验收未完成的并行偏差，开始 M2”。因此 M1 继续保持 `IN_PROGRESS / ACCEPTANCE_BLOCKED`，M2 可独立进入已确认设计的开发与隔离验证；该偏差不等于接受 M1 残余风险或完成 M1 验收。

## 下一执行点

1. 记录陈立承担的代码评审、测试和安全各自结论。
2. 记录 G10 产品验收和一个本地工作日观察结论。
3. M2-R1 的 Spike 与源码薄切已完成；POD 当前下一路线为 `POD-PFC-001/M2/R1/real-local-integration-and-visual-acceptance`，M1 仍需单独补齐具名验收和观察结论。
