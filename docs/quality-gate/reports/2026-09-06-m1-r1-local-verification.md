# M1-R1 本地集成验证报告

> 状态：`INTEGRATED / ACCEPTANCE_BLOCKED`  
> 日期：2026-09-06  
> 迭代分类：严格系统迭代，涉及身份、权限、API、PostgreSQL、PC UI、迁移和生命周期门禁。  
> Parent POD / Milestone：`POD-PFC-001 / M1`。  
> 范围：`CAP-PFC-01 / UNIT 01～05`、`CAP-PFC-02 / UNIT 01`、`CAP-PFC-04 / UNIT 01～03`。

## 范围与实现结论

- standard 运行使用 `pfc_local.pfc`；experience/fixture 不计入能力或验收。
- 已实现应用账户、PostgreSQL 会话、CSRF、登录限速、团队/成员/分工、逻辑工作区、产物目录和不可覆盖版本。
- 产物仓储实现标准 `ArtifactEvidencePort`，只返回当前需求、当前基线且基线确认后产生的 ACTIVE 产物版本。
- 数据库前向迁移以约束触发器支持材料引用或产物版本两类门禁证据，非法跨需求、旧基线引用继续拒绝。
- 人工门禁完成事务失败后，同一幂等请求恢复原运行；不会创建第二次运行或重复推进。
- Web 已拆分身份、团队、产物和需求工作台子模块；`App.tsx` 只负责会话与路由组合。
- 本轮代码复核未发现遗留的正确性、权限、数据完整性或安全阻断项；正式组织代码评审仍等待具名责任人。

## 测试数据设计

| 项目          | 结论                                                               |
| ------------- | ------------------------------------------------------------------ |
| 自动化测试    | `packages/test-data` 确定性 factory，仅进入 `codex_test_*` schema  | 测试后读回残留 0                          |
| standard 集成 | 本地非客户数据，经真实 API 写入 `pfc_local.pfc`                    | 为继续体验而保留，不执行清理              |
| 角色/状态     | `TEAM_ADMIN`、`PRODUCT_MANAGER`、`TEST_OWNER`；需求从 G0 推进至 G5 | 3 个角色和 5 次门禁均从数据库/API/UI 读回 |
| 敏感数据      | 不使用客户数据；密码不写入源码、报告、截图或持久日志               | PASS                                      |

standard 集成标识：

- requirement：`REQUIREMENT_0cd191bf-7f83-4d52-8a68-10769b69ad5e`
- artifact：`artifact-da0cc949-b26b-4978-925e-42c31408a17b`
- workspace：`workspace-bd7f64d2-d006-4817-bd21-40ae27b167e9`

## 验证证据

| 命令/检查                 | 环境与数据                                                        | 结果                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick` | 本地源码；unit/contract 合成数据                                  | PASS，40 files / 190 tests                                                                                                         |
| `npm run test:gate:core`  | 本地 PostgreSQL；`codex_test_*`                                   | PASS，integration 16 files / 69 tests；build PASS；cleanup 0                                                                       |
| `npm run test:gate:full`  | 本地 PostgreSQL、PC Playwright、权限/并发/恢复/安全/性能/依赖审计 | PASS：permission 44、concurrency 20、recovery 32、security 25、performance 3、E2E 36；0 vulnerabilities                            |
| `npm run db:migrate`      | `pfc_local.pfc`，已授权前向迁移                                   | PASS，仅应用 `202609060003_allow_artifact_gate_evidence`                                                                           |
| standard PostgreSQL 读回  | 本地回环数据库                                                    | PASS：accounts 3、memberships 3、assignments 2、workspace/binding 1/1、artifact/version 1/2、completed gate/evidence 5/5、stage G5 |
| standard API/UI 三角色    | Chromium 1440x900                                                 | PASS：三角色 `/me` 和需求详情均 200；同读 G5/5 runs；页面非空、无 Vite overlay、console error 0                                    |
| 视觉检查                  | `pfc-m1-standard-g5.png`，系统临时目录                            | PASS：G0～G5 轨迹、当前责任人、G5 门禁和操作入口无重叠或裁切                                                                       |

沙箱内首次核心门禁在 Vitest 配置加载时因 Windows `spawn EPERM` 中止；相同命令在沙箱外完整重跑通过，未通过修改实现规避测试。开发模式详情页有一次预期的 `net::ERR_ABORTED`：React effect 清理主动取消重复 GET，应用明确忽略对应 `AbortError`，服务端/API 读回成功且控制台零错误。

首次 full 在新报告格式检查处 fail-closed，格式化后重跑；第二次 full 的 1440px Edge 进程在测试注册路由前偶发启动/关闭超时，定向复现 `1/1 PASS`，随后完整 full 重跑 `36/36 E2E PASS`。未放宽测试超时或跳过场景。

## 验收、发布与风险

- 代码评审：`陈立`，未登记结论。
- 测试验收：`陈立`，未登记结论。
- 安全验收：`陈立`，未登记结论。
- M1 所需 9 个 Unit 已达到真实本地 `INTEGRATED`，但里程碑不标记 `COMPLETED/ACCEPTED`，直到具名责任人、G10 产品验收和观察结论齐备。
- release/deploy 未授权；本次没有 commit、push、远程写入或外部系统调用。
- 代码回滚为反向编辑；标准 schema 已存在的表不做 drop/cascade，后续数据库修正只允许前向迁移。
- 建议观察一个本地工作日：关注登录失败率、403/409/503、重复 idempotency key、outbox backlog、PostgreSQL 连接和服务重启恢复。
- 停止条件：凭据泄露、跨团队越权、重复生命周期推进、幂等冲突被误判为成功、标准数据无法重启读回。

## 轻量复盘指标

- 返工次数：3。根因分别是 standard 门禁仍连接 unavailable 产物证据端口、数据库证据外键仅接受材料引用、失败完成后的幂等请求不能恢复。
- 缺陷来源：旧 CAP-PFC-01 门禁模型与新增 CAP-PFC-02 产物目录的跨模块契约未在最初迁移中闭合。
- 防回归：新增产物证据适配器集成测试、数据库触发约束测试和失败完成幂等恢复单元测试。
- 失败门禁：1 次沙箱 `spawn EPERM`、1 次报告格式检查、1 次 Edge 启动超时；均按原规则修复或复现后完整重跑通过。
- 发布后问题：不适用，尚未发布。
