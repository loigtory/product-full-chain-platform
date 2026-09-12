# CAP-PFC-01 T1 Domain 与迁移质量报告

> 记录时间：2026-09-04 22:19:36 +08:00  
> 授权：用户明确授权 `T1` 本地实现  
> 分类：System Iteration / strict  
> 需求与设计：`REQ-PFC-001 V0.7`、`CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`

## 1. 结论

| 结论层级        | 状态           | 说明                                                                                        |
| --------------- | -------------- | ------------------------------------------------------------------------------------------- |
| T1 技术实现候选 | PASS           | Domain、contracts、显式 migration、repository、outbox、确定性 fixture 已实现，Core 门禁通过 |
| T1 正式业务验收 | BLOCKED        | 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全结论                        |
| Full 门禁       | BLOCKED        | `pc-e2e`、`permission`、`concurrency`、`recovery`、`security`、`performance` 尚未具备       |
| 合入/发布/部署  | NOT AUTHORIZED | 本轮没有 commit、push、merge、发布、部署或外部环境写入                                      |

## 2. 实施范围

- 契约：`G0-G12`、材料来源/用途/敏感等级、Question、GateCheck 与 GateRun 结果、稳定错误码。
- 领域：G0 草稿和首个完整 baseline、仅补缺项、乐观版本、Question 显式转换、GateRun 结果、旧 baseline 迟到结果、相邻且单次推进、Outbox 摘要边界。
- 持久化：14 张生命周期表、复合外键、当前 baseline/运行中 GateRun/推进唯一约束、物理删除保护、推进触发器、事务 repository。
- 工具：迁移发现/执行入口、隔离 schema 清理检查、quick/core/full 门禁映射。
- 未进入：T2 权限与跨 CAP adapter，T3-T7 API/SSE/UI/自动执行和发布能力。

## 3. TDD 与复审证据

| 场景                  | 红测证据                                    | 修复后结果                                                         |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| 初始 contracts/domain | 缺少生命周期导出，目标集 `21` 项失败        | 对象、状态机和摘要约束实现后通过                                   |
| G0 只补缺项           | `2` 项失败：已有值不会合并且可被覆盖        | 部分补充成功；覆盖已填字段返回 `VALIDATION_FAILED`                 |
| GateRun 阶段级 N/A    | 契约/状态机 `2` 项失败；迁移 `1` 项插入成功 | GateRun 结果收窄；领域与数据库都拒绝 N/A，GateCheck 仍允许         |
| Repository 聚合绑定   | 错绑 outbox 被接受                          | SQL 前校验 requirement/baseline/timeline/outbox 的聚合、版本和状态 |
| 推进幂等重放          | 错绑 StageAdvancement 被当作成功            | 完整校验 GateRun、Requirement、baseline、from/to、有效性和完成时间 |

## 4. 最终门禁

| 命令                                    | 环境/数据                                                                              | 结果                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run test:gate:core`                | 固定 Node `24.20.0`；`CODEX_TEST_RUN_ID=T1_CORE_FINAL_20260904_2219`；本机 `pfc_local` | PASS：config、lint、format、types、unit/contract `31/31`、migration plan、integration `9/9`、cleanup、build、DB check |
| `npm run test:gate:full -- --dry-run`   | 本地规划，无业务写入                                                                   | BLOCKED 规划：缺少 `pc-e2e, permission, concurrency, recovery, security, performance`                                 |
| `npm run test:gate:full`                | fail-closed 入口                                                                       | 预期退出码 `1`：`FULL_GATE_BLOCKED`，未误报 PASS                                                                      |
| 默认 schema 只读核验                    | `.env.local` 仅作为本地配置源，不输出连接串                                            | `APPLICATION_SCHEMA_STATUS pfc_present=false`                                                                         |
| `scripts/check-test-schema-cleanup.mjs` | `codex_test_*`                                                                         | `TEST_SCHEMA_CLEANUP_OK remaining=0`                                                                                  |

说明：一次直接调用项目内 `npm.cmd` 的测试在进入用例前因系统旧 Node 缺少 `node:util.styleText` 启动失败；按项目规则显式激活固定 Node 24 后重跑并通过，不计为代码失败。

## 5. 测试数据与清理

- 数据源：仅 `packages/test-data` 的确定性合成 fixture；无客户数据、真实材料、凭据或真实运营日志。
- 最终 runId：`T1_CORE_FINAL_20260904_2219`；补充红绿测试使用独立 `T1_*_RED/GREEN_*` runId。
- createdIds：统一前缀 `CODEx_TEST_<runId>_`，覆盖 `REQ_PRIMARY/ROLLBACK/UNSAFE/INVALID_BINDING`、baseline、GateRun、advancement、timeline 和 outbox。
- 隔离：每次集成测试使用 `codex_test_<normalized-runId>` schema，单 worker 运行。
- 清理：`afterAll` 删除隔离 schema；最终只读检查残留 `0`。默认 `pfc` schema 未创建。
- 敏感信息：扫描未发现私钥、AKIA key 或带凭据的 PostgreSQL URL；报告和输出未打印 `.env.local` 值。

## 6. 自审结果与残余风险

- Correctness：未发现仍需在 T1 内修复的高/中风险问题；数据库约束与领域校验对关键绑定形成双层防线。
- Security：事件摘要限制字段数量、字符串长度和标量类型，并拒绝正文/回答/凭据类字段；真实对象级权限和动作授权属于 T2，未测试也未报 PASS。
- Recovery/concurrency：T1 验证唯一索引、事务回滚和迟到结果；100 次并发推进、故障注入和端到端恢复属于 T5/T6/Full，仍为未测风险。
- UI/API：T1 无用户界面和业务 API 变更，因此没有浏览器验收；PC E2E 从 T3 开始。
- Performance/cost：本轮仅小规模本地测试，未测真实负载、连接池等待、存储增长和 outbox 吞吐。
- Supply chain：本轮没有新增外部依赖，也没有执行网络安装；Full 的在线依赖审计未因本轮授权而单独扩展执行。

## 7. 外部影响与进程

- 未运行 `npm run db:migrate`；migration 只在测试 schema 正向应用并删除。
- 未写 SIT、staging、production、远程数据库、Git remote 或客户系统。
- `3001`、`5173` 无监听；无遗留项目 Node、浏览器、Vitest 或开发服务器进程。
- 保留项目本地 PostgreSQL 服务：`pfc-postgresql-18`，PID `24620`，`127.0.0.1:5432`，启动类型 `Manual`，用于后续本地迭代。管理员可用 `Stop-Service pfc-postgresql-18` 停止。

## 8. 验收与后续门槛

T1 当前只能交付为技术候选。登记独立代码评审、测试和安全责任人并完成其复核后，才能形成 T1 正式验收结论。T2 仍需单独授权；本报告不构成 T2、提交、合入、发布或部署授权。
