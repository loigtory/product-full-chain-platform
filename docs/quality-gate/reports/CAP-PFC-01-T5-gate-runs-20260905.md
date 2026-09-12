# CAP-PFC-01 T5 GateRun 质量报告

> 记录时间：2026-09-05 06:52:57 +08:00  
> 授权：用户授权 T4 后连续执行后续 Txx；本阶段只执行本地 T5  
> 分类：System Iteration / strict  
> 需求与设计：`REQ-PFC-001 V0.7`、`CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`

## 1. 结论

| 结论层级        | 状态           | 说明                                                                                                                        |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| T5 技术实现候选 | PASS           | 自动/人工 GateRun、阻断、UNKNOWN、并发复用、旧基线隔离及 PASS 单次推进均有本地自动化、数据库和浏览器证据                    |
| T5 正式业务验收 | BLOCKED        | 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全人工结论                                                    |
| Core 门禁       | PASS           | 项目固定 Node 下 unit/contract `109/109`、integration `42/42`、构建、迁移计划、测试数据清理和本地 PostgreSQL 检查均通过     |
| Full 门禁       | BLOCKED        | dry-run 明确缺少 `pc-e2e,permission,concurrency,recovery,security,performance`；其中 pc-e2e 已单独执行，但 profile 尚未闭环 |
| 合入/发布/部署  | NOT AUTHORIZED | 未 commit、push、merge、发布、部署、执行默认 `pfc` migration 或写入外部环境                                                 |

## 2. 实施范围

- Contracts/Domain：GateRun、GateCheck、EvidenceRef、执行能力与 Requirement 权威投影；约束自动/人工结果、角色确认、check-level N/A 和阶段/基线绑定。
- Application/API：自动运行、人工登记和权威详情读取；鉴权、版本和幂等检查先于执行；依赖探测失败 fail-closed，人工入口仍可使用。
- Persistence：GateRun、check、evidence、幂等、TimelineEvent、outbox 和 StageAdvancement 事务化；行锁与唯一约束保证同一 tuple 只有一个 IN_PROGRESS，同一 PASS 只推进一次。
- Database invariants：UNKNOWN 必须有原因；人工登记字段成组有效；evidence 与 GateRun、material ref 必须绑定同一 baseline；旧基线结果只能标记 `STALE_BASELINE`。
- PC Web：展示自动执行能力、人工登记、PROCESSING/UNKNOWN 权威刷新、运行历史与检查明细；不自动重试不确定执行。
- 明确未进入：T6 材料影响/基线切换/时间线 SSE、真实 PFC-02～05、默认 schema migration、远程环境和发布操作。

## 3. AC 映射

| AC                     | 结果    | 自动化证据                                                                                                     |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `04-01` 自动能力预检   | PASS    | application/API/UI；UNAVAILABLE/UNKNOWN 和 probe exception 均不创建自动运行，人工入口保留                      |
| `04-02` 到期问题阻断   | PASS    | domain/application；OPEN/ANSWERED 且到期问题生成本地 BLOCK checks，不调用执行端口                              |
| `04-03` 单一运行与幂等 | PASS    | application/PostgreSQL；不同幂等键并发复用同一 IN_PROGRESS，只有创建者调用执行端口                             |
| `04-04` 自动结果       | PASS    | domain/application/API；COMPLETED、RUNNING、UNKNOWN 和异常路径均有稳定状态与恢复动作                           |
| `04-05` 人工登记       | PASS    | contract/domain/application/API/UI；总体仅 PASS/BLOCK/WARN，N/A 只允许在 check                                 |
| `04-06` 证据与责任     | PASS    | application/persistence；人工说明、责任角色、当前有效证据、检查项均为必需，受限证据再次鉴权                    |
| `04-07` PASS 单次推进  | PASS    | application/PostgreSQL；完成事务锁定运行和 Requirement，100 次重放只生成一个相邻阶段推进                       |
| `04-08` 旧基线隔离     | PASS    | domain/application/PostgreSQL；旧基线迟到 PASS 为 `STALE_BASELINE`，不改变当前阶段                             |
| `04-09` 历史与恢复     | PASS    | API/UI/browser；运行详情、历史摘要、PROCESSING/UNKNOWN 只通过权威 GET 恢复                                     |
| `04-10` 脱敏与越权     | PASS    | application/API/persistence；未授权 actor 不读取证据正文，错误/outbox 不含人工说明、检查原因或证据定位敏感信息 |
| `CAP AC 04/05/06`      | PARTIAL | T5 覆盖 GateRun 与单次阶段推进；跨材料影响、完整时间线/SSE、硬化与正式接受分别属于 T6/T7                       |

## 4. TDD、缺陷与复核

| 层级            | 首次红测/发现                                                                  | 最终结果                                                            |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Contract/Domain | 缺少 GateRun 合同和状态函数，`10/10` 失败                                      | 定向通过；Quick 汇总纳入 `109/109`                                  |
| Application     | 缺少自动/人工命令，`7/7` 失败                                                  | 增至 `8` 个场景；含鉴权、幂等、证据、UNKNOWN 和单次推进             |
| Persistence     | 缺少 GateRun 事务与约束                                                        | `6/6` 通过；含并发、100 次完成、旧基线、直接约束和 outbox 脱敏      |
| HTTP            | 三个 T5 路由最初为 404，`4/4` 失败                                             | `4/4` 通过；header、状态码、详情和错误恢复覆盖                      |
| React           | GateRun 面板文件初始不存在                                                     | 相邻 UI 回归 `14/14` 通过；自动不可用时人工路径仍可访问             |
| Browser         | 人工 mock 曾误返回自动运行结构，导致三个视口各失败一次                         | 修正测试 fixture 后完整 `18/18` 通过                                |
| Review          | probe 异常会击穿详情；重复 evidence 可伪造覆盖；DB 可跨 baseline 关联 evidence | 均增加回归测试和 fail-closed 约束；定向 unit `16/16`、DB `6/6` 通过 |

## 5. 最终门禁

| 命令                                  | 环境/数据                                                         | 结果                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`             | 项目 Node `24.20.0`；合成 fixture                                 | PASS：config、lint、format、types、unit/contract `109/109`                                   |
| `npm run test:gate:core`              | 项目 Node `24.20.0`；本机 `pfc_local`；隔离 `codex_test_*` schema | PASS：Quick、migration dry-run、integration `42/42`、cleanup、server/web build、DB check     |
| `npm run test:e2e:pc`                 | 系统 Edge；mock API；1280x720、1440x900、1920x1080                | PASS：完整 PC 回归 `18/18`，其中 T5 自动/人工 GateRun 为 `6/6`                               |
| `npm run test:gate:full -- --dry-run` | 只读 gate planning                                                | BLOCKED：缺 `pc-e2e,permission,concurrency,recovery,security,performance` profile 证据       |
| 敏感值定向扫描                        | 排除 `.env.local`、依赖、构建、浏览器结果和报告图片               | PASS：私钥、常见 token 和带认证信息的 PostgreSQL URL、password/token/secret 实值模式均无命中 |

## 6. 浏览器与可访问性证据

- Browser 插件未提供，按技能回退规则使用项目 Playwright 与本机 Edge；没有安装或下载浏览器。
- 自动路径：详情页启动 GateRun -> 展示 PASS 和 checks -> Requirement 从 G0 仅推进到 G1 -> 历史保留权威运行记录。
- 人工路径：执行能力 UNAVAILABLE -> 自动按钮禁用 -> 人工登记可提交 -> 展示责任角色、证据数和 WARN 结果。
- 三档 PC 视口均通过；关键按钮/字段有可访问名称，页面无 console error，测试请求未发送 Authorization/Cookie。
- 截图和 trace 位于忽略的 `test-results/`；T5 未执行 axe、完整人工键盘巡检和弱网恢复测试，纳入 T7 残余风险。

## 7. 测试数据与清理

- 数据源：`packages/test-data` T5 确定性 factory、fixture adapters 和 E2E route mocks；仅使用 `CODEx_TEST_` + runId 合成标识。
- 场景覆盖：到期问题、自动 PASS/RUNNING/UNKNOWN、并发、100 次重放、人工 PASS/BLOCK/WARN、check N/A、受限/失效/错基线证据和旧基线迟到结果。
- createdIds：Requirement、baseline、Question、GateRun、check、evidence、advancement、timeline、outbox、idempotency 只存在于进程内 adapter 或 `codex_test_t5_*` schema。
- 清理：integration `afterAll` 删除测试 schema，`TEST_SCHEMA_CLEANUP_OK remaining=0`；Playwright/Vite 退出，3001/5173 无监听。
- 敏感处理：无真实身份、需求正文、客户数据或凭据；人工说明、check 原因和 evidence 定位不进入 outbox 或错误体，数据库连接串不输出。

## 8. 风险、边界与恢复

- `ACCEPTED/RUNNING` 只保存 IN_PROGRESS；真实异步执行的回调/轮询收敛依赖未来 PFC-03 adapter。当前 fixture 只能通过权威 GET 展示已有状态，不能证明真实依赖恢复。
- Full profile 尚未注册并闭环 PC E2E、权限、并发、恢复、安全和性能检查；本报告中的独立测试不等于 Full PASS，T7 必须更新 profile 并按 fail-closed 规则执行。
- 当前授权仍使用本地 actor fixture。真实会话、团队/需求授权和受限证据策略依赖 PFC-04；运行时依赖不可用时保持 fail-closed。
- 只验证小规模合成数据，未测运行历史大分页、连接池压力、异步任务容量、超时预算或外部执行成本。
- 回滚范围仅为未提交的 T5 源文件；未写默认 `pfc` schema、外部环境或 Git remote，不存在远程数据回滚动作。

## 9. 进程、接受与下一阶段

- 测试 Web/Vite 已退出；`3001/5173` 无监听。保留项目既有本地 PostgreSQL 服务 `pfc-postgresql-18`，PID `24620`，监听 `127.0.0.1:5432`，用途为后续本地开发；管理员可用 `Stop-Service pfc-postgresql-18` 停止。
- T5 技术实现可作为 T6 输入，但不是 T5 正式业务验收、W2 完成、release-ready 或发布结论。
- 正式接受仍须记录陈立承担的代码评审、测试和安全各自结论；本报告形成时这些结论尚未记录。
- 依据用户连续执行授权，T5 报告完成后自动进入 T6，不等待新的“继续”。
