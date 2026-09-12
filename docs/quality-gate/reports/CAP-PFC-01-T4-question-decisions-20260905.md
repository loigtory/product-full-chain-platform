# CAP-PFC-01 T4 问答与决定质量报告

> 记录时间：2026-09-05 05:56:22 +08:00  
> 授权：用户明确授权进入 T4，并授权 T4 完成后按已确认设计继续后续 Txx  
> 分类：System Iteration / strict  
> 需求与设计：`REQ-PFC-001 V0.7`、`CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`

## 1. 结论

| 结论层级        | 状态              | 说明                                                                                                          |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| T4 技术实现候选 | PASS              | Question 回答、确认、退回、替代、延后及详情抽屉均有本地自动化和浏览器证据；不运行 GateRun、不推进 Requirement |
| T4 正式业务验收 | BLOCKED           | 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全人工结论                                      |
| Full 门禁       | NOT RUN / BLOCKED | T4 仅完成 W2 的 Question 子域；T5-T7、全生命周期性能/安全/恢复和正式责任人仍未闭环                            |
| 合入/发布/部署  | NOT AUTHORIZED    | 未 commit、push、merge、发布、部署、执行默认 `pfc` migration 或写入外部环境                                   |

## 2. 实施范围

- Contracts/Domain：Question/Decision DTO、五类命令、决定类型与精确作用域；状态机约束 `OPEN -> ANSWERED -> CONFIRMED`、退回、替代和延后。
- Application/API：五个命令路由均要求 `Idempotency-Key` 和 Question `If-Match`；授权先于问题正文读取；稳定返回版本冲突、幂等冲突和结果未知。
- Persistence：Question/Decision、幂等记录、TimelineEvent 和脱敏 outbox 在同一事务写入；行锁和 rowVersion 处理并发；旧 Question/Decision 只标记替代，不删除。
- Database invariants：候选必须为 JSON array；确认角色合法；角色、确认人、确认时间必须成组出现；DEFERRAL 必须有重开条件和责任确认。
- PC Web：当前基线问题清单和右侧抽屉；候选/原始回答/说明/作用域/确认责任及时间可见；UNKNOWN 状态只允许权威重读，确认未生效后才复用原幂等键。
- 明确未进入：Question 创建/分派、GateRun 和阶段推进、材料影响、SSE、真实 PFC-02～05、发布和生产操作。

## 3. AC 映射

| AC                     | 结果    | 自动化证据                                                                                                 |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `03-01` 回答与确认范围 | PASS    | contract/domain/application/API/UI/browser；保存原始回答后仅到 ANSWERED，确认后记录角色/时间，GateRun 不变 |
| `03-02` 退回           | PASS    | application/persistence/API/UI；保留旧回答，Question 回 OPEN，原因只进入受保护时间线                       |
| `03-03` 替代           | PASS    | domain/application/persistence/API/UI；旧 Question/Decision 为 SUPERSEDED，新记录反向引用旧 Decision       |
| `03-04` 延后           | PASS    | domain/application/API/UI；DEFERRAL 明确保存原因、重开条件和确认责任，不显示为 CONFIRMED                   |
| `03-05` 越权           | PASS    | application/API；未授权 actor 在读取问题正文前被拒绝，状态和 GateRun 不变                                  |
| `CAP AC 03/04`         | PARTIAL | T4 已覆盖问题决定与历史不覆盖；完整时间线恢复和实时事件属于 T6                                             |

## 4. TDD 与复核

| 层级            | 首次红测/发现                                         | 最终结果                                                |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Contract/Domain | 缺少 Question 合同与决定函数，`5` 失败                | `6/6` 通过                                              |
| Application     | 缺少五类应用命令，`7/7` 失败                          | `7/7` 通过；含授权、版本、幂等和阶段不变                |
| Persistence     | 缺少 `decision_kind` 与原子命令；并发错误初为状态错误 | `5/5` 通过；并发稳定返回一个成功、一个 VERSION_CONFLICT |
| HTTP            | 路由初始为 404，`5/5` 失败                            | `5/5` 通过；必需 header、错误脱敏和无权正文均覆盖       |
| React           | 抽屉入口初始缺失，`4/4` 失败                          | `4/4` 通过；回答、确认、退回、替代、延后和 UNKNOWN 覆盖 |
| Review          | DB 可被写成半确认记录；UI 未显示确认时间              | 增加数据库约束、负向测试及确认时间展示；定向 `9/9` 通过 |

## 5. 最终门禁

| 命令                            | 环境/数据                                                         | 结果                                                                                     |
| ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`       | 项目 Node `24.20.0`；合成 fixture                                 | PASS：config、lint、format、types、unit/contract `87/87`                                 |
| `npm run test:gate:core`        | 项目 Node `24.20.0`；本机 `pfc_local`；隔离 `codex_test_*` schema | PASS：Quick、migration dry-run、integration `32/32`、cleanup、server/web build、DB check |
| `npm run test:e2e:pc`           | 系统 Edge；mock API；1280x720、1440x900、1920x1080                | PASS：完整回归 `12/12`；最终问题抽屉定向复跑 `3/3`                                       |
| `npm run db:test-cleanup-check` | 本地 PostgreSQL                                                   | PASS：`TEST_SCHEMA_CLEANUP_OK remaining=0`                                               |
| 敏感值定向扫描                  | 排除 `.env.local`、依赖、构建、浏览器结果和图片                   | PASS：私钥、实值 DATABASE_URL/SESSION_SECRET、password/token/secret 赋值模式无命中       |

## 6. 浏览器与可访问性证据

- Browser 插件未提供，按项目流程使用既有 Playwright 与本机 Edge，没有安装或下载浏览器。
- 目标流：需求详情 -> 打开“问题与决定” -> 选择候选 -> 保存原始回答 -> 抽屉显示 ANSWERED，且无 GateRun PASS。
- 三档 PC 视口均验证抽屉在视口内、目标文本无溢出、无 console error、无 Authorization/Cookie 请求头；可访问名称可直接定位对话框、字段和命令。
- 截图由 Playwright 写入忽略的 `test-results/t3-pc/`，不作为提交源文件；T4 未做移动端验收，符合 PC-only 范围。
- 未运行 axe 和完整人工键盘巡检；这是 T7 加固及正式可访问性验收的残余风险。

## 7. 测试数据与清理

- 数据源：`packages/test-data` 的确定性 T4 factory 与 E2E 页面路由 mock；只使用 `CODEx_TEST_` + runId 合成标识。
- 场景：OPEN/ANSWERED/CONFIRMED、替代链、延后、同/异幂等请求、旧版本、并发、越权和 UNKNOWN。
- createdIds：Requirement、baseline、Question、Decision、timeline、outbox、idempotency 均只存在于进程内 adapter 或 `codex_test_t4_*` schema。
- 清理：integration `afterAll` 删除测试 schema，读回残留 `0`；3001/5173 无监听，未发现项目 Node/Vite/Playwright 残留。
- 敏感处理：测试无真实身份、需求正文、客户数据或凭据；回答/退回原因不进入错误体或 outbox，数据库连接串未输出。

## 8. 偏差、风险与边界

- 第一次直接调用 `npm.cmd` 时门禁子进程误用系统 Node `18.17.1`，在配置检查即失败；随后在同一 PowerShell 进程把项目 `.tools` Node 24 置于 PATH 首位，所有最终证据均使用 `24.20.0`。
- Quick 曾依次被一个未使用类型导入和 11 个本轮文件格式问题阻断；均修复并完成全量复跑，不以部分结果替代最终 PASS。
- 当前授权适配器仍是本地 fixture；真实身份、团队/需求权限和内部受限动作授权需 PFC-04 在约定节点提供，当前运行时依赖不可用时 fail-closed。
- 仅验证小规模合成数据，未做 Question 大历史、连接池压力、长文本容量或成本测试；纳入 T7/full 残余风险。
- 当前分支 `feat/cap-pfc-01-m1`，仓库尚无 commit；无远程 Git 或外部环境副作用。

## 9. 进程、观察与下一阶段

- Playwright/Vite 已退出；`3001/5173` 无监听。保留前置本地 PostgreSQL 服务 `pfc-postgresql-18`，PID `40516`，端口 `127.0.0.1:5432`，用途为本地开发数据库；管理员可用 `Stop-Service pfc-postgresql-18` 停止。
- T4 技术实现可作为 T5 输入，但不是 T4 正式人工验收、W2 完成、release-ready 或发布结论。
- 正式接受仍须记录陈立承担的代码评审、测试和安全各自结论；本报告形成时这些结论尚未记录。
