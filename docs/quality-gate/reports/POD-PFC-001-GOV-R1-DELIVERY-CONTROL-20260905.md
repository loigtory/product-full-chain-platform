# POD-PFC-001 GOV-R1 交付防偏航治理报告

> 日期：2026-09-05  
> 分类：严格系统迭代，影响项目规则与 quick/core/full 质量门禁  
> 结论：`LOCAL_GOVERNANCE_PASS / M1_IN_PROGRESS / RELEASE_NOT_AUTHORIZED`

## 1. 变更范围

- 增加 5 CAP、26 Unit、M1-M3 的机器可读交付台账，当前唯一 POD 路线为 `POD-PFC-001/M1-R1/PFC-02+PFC-04-design`。
- 增加项目硬规则，强制区分本地实现、真实集成、产品验收与发布，不允许子任务完成替代父 POD 结论。
- 增加 `check:delivery-governance` 并接入 quick/core/full。
- 固化 PostgreSQL 业务事实源和 fixture test-only 政策；关闭本机 `PFC_EXPERIENCE_MODE`，保留但不删除历史 `pfc_experience` schema。
- 增加检查点模板和 `EXP-PFC-001` 经验候选。

本轮未修改业务 API、UI、领域状态机、数据库迁移或数据库数据；未安装依赖，未调用外部系统，未 commit、push、merge、部署或发布。

## 2. TDD 与评审

| 阶段       | 命令/检查                                        | 结果                                                        |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------- |
| RED-1      | 定向运行 `delivery-governance.test.ts`           | 按预期失败：校验模块不存在，0 test                          |
| GREEN-1    | 增加台账、校验器和 6 个治理场景                  | 6/6 PASS                                                    |
| RED-2      | 增加实际本机配置禁止 experience/fixture 场景     | 按预期 1/7 FAIL：校验函数不存在                             |
| GREEN-2    | 增加本机配置校验并关闭 experience 开关           | 7/7 PASS                                                    |
| Quick 首轮 | `npm run test:gate:quick`                        | 格式阶段按预期失败；治理、UI 和 lint 已通过                 |
| 格式修复   | 仅格式化本轮新增 4 个文件                        | PASS；无逻辑变化                                            |
| 代码评审   | 范围、状态关系、敏感配置、数据库和外部副作用复核 | 未发现待解决代码问题；`.env.local` 只读取布尔策略且不输出值 |

## 3. 最终验证

| 命令                            | 环境与数据                                      | 结果                                                           |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `npm run test:gate:quick`       | 项目 Node 24.20.0；无业务数据写入               | PASS；36 files、174/174 tests                                  |
| `npm run test:gate:core`        | 本地 `pfc_local`；仅 `codex_test_*` 隔离 schema | PASS；12 integration files、56/56 tests；server/web build PASS |
| `npm run db:test-cleanup-check` | 集成测试结束读回                                | PASS；`remaining=0`                                            |
| `npm run db:check`              | loopback PostgreSQL 只读连通检查                | PASS；`pfc_local` / `pfc_app_local` / `127.0.0.1:5432`         |

Full 未运行：本轮没有形成发布候选，也未改业务行为、API、数据库模型或 UI；core 是当前影响面的比例门禁。发布和正式验收继续阻断。

## 4. 数据与结论边界

- 治理台账保存在源码仓，供无数据库环境的质量门禁使用；它不是业务事实库。
- 后续标准本地业务状态必须持久化到 `pfc_local.pfc`。当前该 schema 尚未执行本轮业务迁移，不能声称标准本地运行已就绪。
- fixture 仅允许自动化测试使用进程内存或 `codex_test_*`；不能计入 CAP、M1-M3、验收或发布。
- `pfc_experience` 未删除，避免未经授权清理历史体验数据；它处于 `RETIRE_BEFORE_M1_EXIT`，不再作为下次启动配置或能力证据。
- 测试创建的隔离 schema 已全部清理；无保留 createdIds，无客户数据或敏感业务数据。

## 5. 下一路线与剩余风险

下一路线固定为 PFC-02/PFC-04 的 M1 恢复设计，至少覆盖产物目录、团队、成员/角色、仓库工作区及标准 PostgreSQL 持久化。未经该设计确认，不执行默认 `pfc` schema migration。

剩余风险：当前仓库仍无首个 commit；代码评审、测试和安全责任人现统一登记为陈立；PFC-02～05 未完成；标准 `pfc` schema、真实本地身份与跨 CAP 集成在本报告形成时尚未就绪；历史 experience 进程若仍运行，只能用于查看旧数据，不能继续写入或作为验收证据。
