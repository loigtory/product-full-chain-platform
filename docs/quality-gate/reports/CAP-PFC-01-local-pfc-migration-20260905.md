# CAP-PFC-01 本地应用 Schema 迁移与预览验证记录

> 执行时间：2026-09-05 09:21～09:25 +08:00  
> 分类：System Iteration / strict / local database operation  
> 授权：用户在确认精确目标后明确同意，仅对本机 `pfc_local.pfc` 执行现有迁移  
> 配置来源：忽略提交的 `.env.local`；本记录不包含连接串、密码或其他配置值

## 1. 结论

- **本地迁移：PASS。** `202609040001_create_lifecycle` 已应用到 `127.0.0.1:5432 / pfc_local`。
- **结构读回：PASS。** `pfc` schema 下 14 张生命周期表全部存在，迁移后各表均为 0 行。
- **运行验证：PASS。** API 健康检查和前端代理清单接口均返回 HTTP 200；Edge 1440×900 首屏正常显示空清单。
- 本次没有写入业务数据，没有访问外部环境，没有 commit、push、merge、部署或发布。

## 2. 目标与影响边界

| 项目       | 读回结果                                                                       |
| ---------- | ------------------------------------------------------------------------------ |
| 数据库目标 | `pfc_local`                                                                    |
| 数据库角色 | `pfc_app_local`                                                                |
| 服务地址   | `127.0.0.1:5432`                                                               |
| 迁移前状态 | `pfc` schema 不存在，表数 0                                                    |
| 迁移计划   | 仅 `202609040001_create_lifecycle`                                             |
| 迁移后状态 | `pfc` schema 存在，生命周期表 14 张                                            |
| 迁移元数据 | `public.kysely_migration`、`public.kysely_migration_lock`；记录 1 个已应用迁移 |

迁移创建的生命周期表：`requirements`、`material_baselines`、`material_refs`、`material_impact_assessments`、`questions`、`decisions`、`gate_runs`、`gate_checks`、`gate_run_evidence`、`stage_advancements`、`timeline_events`、`outbox_events`、`audit_events`、`idempotency_records`。

## 3. 命令与证据

| 命令或检查                           | 结果 | 说明                                                                                              |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| 脱敏 PostgreSQL 目标与 schema 查询   | PASS | 迁移前精确目标匹配，`pfc` 不存在                                                                  |
| `npm run db:migrate:plan`            | PASS | 只列出一个预期迁移                                                                                |
| `npm run db:migrate`                 | PASS | `MIGRATION_Success`，随后 `MIGRATION_PASS target=latest`                                          |
| 迁移后 information schema 与逐表计数 | PASS | 14/14 表存在，各表 0 行                                                                           |
| `GET http://127.0.0.1:3001/health`   | PASS | HTTP 200，`businessFeatures=true`                                                                 |
| 前端代理 `GET /api/v1/requirements`  | PASS | HTTP 200，空清单，未创建数据                                                                      |
| `npm run test:gate:core`             | PASS | 26 files / 132 unit-contract tests；9 files / 49 integration tests；构建、DB 连通和清理读回均通过 |
| Edge 1440×900 首屏截图               | PASS | 空清单、筛选区和新建入口正常渲染，无启动错误页                                                    |

Core 首次在沙箱内运行时因 Vitest/esbuild 子进程 `spawn EPERM` 中断；相同源码、相同命令在获准的本机执行上下文重跑后完整 PASS。没有修改测试、增加重试或放宽门禁。

## 4. 数据、留存与回滚

- 业务表创建后均为 0 行；本次没有 createdIds。
- Core 使用 `CODEx_TEST_` 前缀的隔离测试 schema；结束读回 `TEST_SCHEMA_CLEANUP_OK remaining=0`。
- 首屏截图保存在本机临时目录 `%TEMP%\pfc-platform-dev\homepage-after-migration.png`，未写入仓库，不含业务数据或凭据。
- 当前无迁移失败，不执行回滚。现有 migration `down` 会删除整个 `pfc` schema，该破坏性动作不在本次授权内。

## 5. 生命周期边界与保留进程

- 代码评审、测试和安全责任人现统一登记为陈立；是否形成正式结论仍以对应证据为准。
- 本地迁移与 Core PASS 不替代 PFC-02/04 真实联调、G10 产品验收、G11 发布授权、观察窗口或 G12 业务验收。
- 保留本地前端监听：`127.0.0.1:5173`，Node PID `6132`，启动器 PID `39100`。
- 保留本地 API 监听：`127.0.0.1:3001`，Node PID `26532`，启动器 PID `22548`。
- 保留既有 PostgreSQL 服务：`127.0.0.1:5432`，PID `24620`。
- 停止前端/API：`taskkill /PID 39100 /T /F`、`taskkill /PID 22548 /T /F`。
