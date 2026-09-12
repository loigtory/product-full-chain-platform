# CAP-PFC-01 T3 需求工作台与 G0 质量报告

> 记录时间：2026-09-05 02:55:35 +08:00  
> 授权：用户明确授权 `T3` 本地实现  
> 分类：System Iteration / strict  
> 需求与设计：`REQ-PFC-001 V0.7`、`CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`

## 1. 结论

| 结论层级        | 状态           | 说明                                                                                                                                |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| T3 技术实现候选 | PASS           | 清单/详情、最小与完整 G0、补齐、幂等/并发、UNKNOWN 核验、对象级读取控制和 PC 工作台均有本地自动化证据                               |
| T3 正式业务验收 | BLOCKED        | 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全结论，Codex 自审不替代这些结论                                      |
| Full 门禁       | BLOCKED        | dry-run 仍列出全生命周期 `pc-e2e`、`permission`、`concurrency`、`recovery`、`security`、`performance` 缺项；T3 仅关闭本阶段部分场景 |
| 合入/发布/部署  | NOT AUTHORIZED | 未 commit、push、merge、发布、部署、运行默认 schema migration 或写入外部环境                                                        |

## 2. 实施范围

- Contracts/API：需求清单、详情、G0 登记、提交核验 DTO，稳定错误和恢复动作；HTTP 覆盖 200/201/400/403/404/409/503。
- Application：授权范围过滤、详情授权前只读元数据、未分类草稿按 RESTRICTED、创建/补齐幂等与 UNKNOWN 只读恢复。
- Persistence：Requirement、首个 MaterialBaseline、idempotency、timeline 和 outbox 的同事务写入；G0 补齐使用行锁与 rowVersion。
- PC Web：默认表格、待我处理/全部需求/阻断项、搜索空状态、不可拖拽阶段分组、新建、缺项清单、补齐与恢复。
- Runtime：有 `DATABASE_URL` 才装配 PostgreSQL T3 service；无 service 或无可信 ActorContext 时 fail-closed；启动不自动迁移 schema。
- 未进入：T4-T7、GateRun、问题/决定、材料影响、SSE、真实 CAP-PFC-02～05、发布与生产操作。

## 3. 验收映射

| AC                         | 结果              | 自动化证据                                                                                                          |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `01-01～03`                | PASS              | 默认六列表格、阶段分组无拖拽、搜索空状态/清除动作；unit UI + PC E2E                                                 |
| `01-04`                    | PASS              | 跨 CAP 摘要 UNKNOWN 保留清单并标 WARN，不显示 PASS；application/API tests                                           |
| `01-05`                    | PASS              | 无权详情返回 403，授权前不读取正文；application/API tests + PC E2E                                                  |
| `02-01～04`                | PASS              | 两项首次必填；缺项 BLOCK 无 baseline；完整/补齐后首个 baseline 与 NOT_STARTED；unit/application/API/persistence/E2E |
| `02-05～06`                | PASS              | 明确失败无部分对象且可重新提交；同名不同 ID；API/application/persistence tests                                      |
| `02-09`                    | PASS              | UNKNOWN 禁止直接重提，只读核验 CREATED/NOT_FOUND 后恢复；unit UI + API + PC E2E                                     |
| `02-10～13`                | PASS（T3 登记面） | 三级边界含查看/AI/发布说明；六类来源；OTHER 首存可 BLOCK、补齐时说明必填并展示；unit UI + domain/API/E2E            |
| `CAP AC 01/02/05/07/09/12` | PARTIAL           | T3 相关清单、G0、恢复和读取权限有证据；后续门禁、SSE、跨 CAP 动作授权及全生命周期恢复仍未实现                       |

## 4. TDD 与复审证据

| 场景                  | 红测/发现                                            | 修复后结果                                                             |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Contracts/application | 缺少 requirements contract、应用服务和 CREATE action | 目标 `3` 文件 `10` 项通过；权限、同名、幂等、恢复和 G0 状态覆盖        |
| Persistence           | repository 缺少 T3 查询、幂等创建和补齐事务          | 目标测试通过；新增并发同 key 双请求只形成 `1` 条 Requirement           |
| Fastify API           | T3 路由初始全部 404                                  | API 与健康状态 `8` 项通过；错误体不回显正文                            |
| React UI              | 缺少 API adapter 与工作台；首轮 UI `4/5` 失败        | 最终 UI `7/7`；补充首次 OTHER 可 BLOCK、逐项缺失、NOT_FOUND 后开放重提 |
| Visual                | 1280 截图长责任人 ID 断词                            | 表格/详情单行省略并保留 title；重跑与截图读回通过                      |

## 5. 最终门禁

| 命令                                  | 环境/数据                                                         | 结果                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`             | 项目 Node `24.20.0`；本地合成 fixture；最终复跑获批在沙箱外执行   | PASS：config、lint、format、types、unit/contract `70/70`                                        |
| `npm run test:gate:core`              | 项目 Node `24.20.0`；本机 `pfc_local`；独立 `codex_test_*` schema | PASS：Quick、migration plan、integration `22/22`、cleanup、server/web build、DB check           |
| `npm run test:e2e:pc`                 | 系统 Edge/Chromium；mock API；`CODEx_TEST_T3_E2E_*`；三档 PC 视口 | PASS：`9/9`；主流程、无权正文和 UNKNOWN 恢复                                                    |
| `npm run test:gate:full -- --dry-run` | 本地计划，无业务写入                                              | BLOCKED 规划：缺少全生命周期 `pc-e2e, permission, concurrency, recovery, security, performance` |
| 敏感值定向扫描                        | 排除 `.env.local`、依赖、构建和测试结果目录                       | PASS：私钥、非空 DATABASE_URL/SESSION_SECRET、password/token/secret 模式无命中                  |
| test schema 清理                      | `codex_test_*`                                                    | PASS：`TEST_SCHEMA_CLEANUP_OK remaining=0`                                                      |

## 6. 浏览器与视觉证据

- 视口：`1280x720`、`1440x900`、`1920x1080`，每档执行 3 项，共 `9` 项。
- 验证：页面无横向溢出；固定侧栏与工作区无重叠；无 console error；localStorage/sessionStorage 无键；mock 请求无 Authorization/Cookie。
- 截图：`docs/quality-gate/reports/assets/CAP-PFC-01-T3/` 下每档各有 worklist/detail，共 `6` 张；已人工读回 1280 worklist/detail 与 1920 detail。
- Browser 插件未在本环境提供，按项目规则使用已有 Playwright；首次因缺少 revision 1234 在浏览器启动前失败，改用本机系统 `msedge` Chromium channel 后通过，未下载浏览器。

## 7. 测试数据与清理

- 数据源：只用 `packages/test-data` 和 E2E 内合成 fixture，无真实用户、需求正文、客户数据、cookie、token 或数据库连接串。
- 标识：Requirement、actor、baseline、幂等键均使用 `CODEx_TEST_` + runId；并发用例 key 为 `CODEx_TEST_<runId>_IDEMPOTENCY_CONCURRENT`。
- 隔离：unit/API/UI 使用进程内 adapter；PostgreSQL 使用 `codex_test_t3_<runId>` schema、单 worker；E2E 使用页面路由 mock，不连接数据库。
- createdIds：数据库测试创建的 Requirement/baseline/timeline/outbox/idempotency 均位于隔离 schema；E2E 无持久化业务对象。
- 清理：集成测试 `afterAll` 删除隔离 schema，最终残留 `0`；Playwright/Vite 最终 PID 已退出，`3001/5173` 无监听。

## 8. 自审、安全与残余风险

- Correctness：T3 范围内未发现仍需修复的高/中风险问题；并发创建、补齐原子性、版本冲突、同名和 UNKNOWN 都有回归证据。
- Security：清单不含 originalIdea；详情先授权后读正文；未登记敏感等级按 RESTRICTED；错误响应脱敏；无权 API/browser 均不显示正文。
- 当前阻断：真实 ActorContext/session、团队权限和内部受限“本次动作授权”依赖 CAP-PFC-04；当前运行时无可信 resolver 时拒绝访问，未做真实联调。
- Accessibility：关键控件使用 label/role、focus-visible、状态文字而非只依赖颜色；已通过 Playwright 可访问名称操作，未运行 axe 或完整键盘人工巡检。
- Performance：只验证了小规模合成数据和有界查询；未做大列表、连接池等待、并发补齐压力和容量/成本测试。
- Maintainability：当前 T3 工作台集中在单个 React 文件，后续 T4 页面扩展前应按 worklist/detail/dialog 拆分；这不是当前行为阻断。
- Full/Release：Full 仍 fail-closed；无实际发布、观察窗口或发布后 smoke。设计建议的一个工作日隔离观察尚未开始。

## 9. 过程偏差与供应链

- 一次聚焦测试误用 `npm exec -- node`，npm 输出尝试临时获取 `node@26.8.1`，随后测试才运行。这不符合固定 Node/无未授权安装规则。
- 立即停止使用该命令；后续全部恢复项目 Node `24.20.0`。定向扫描确认 package.json、package-lock 和 workspace 中无 `26.8.1`，没有仓库依赖变更。
- 可能写入的用户 npm 缓存未擅自删除，保留为已披露的本机缓存副作用；未执行其他下载或升级。Full 在线依赖审计未运行。
- 报告格式化后的 Quick 在受限沙箱内两次因 Node 无法创建 Vite 的只读 `net use` 子进程而报 `spawn EPERM`；直接命令可运行且无网络映射。按审批治理用相同门禁命令在沙箱外最终复跑，通过 `70/70`，未改动业务代码或外部环境。

## 10. 外部影响、进程与 Git

- 未运行 `npm run db:migrate`；migration 只在测试 schema 执行并删除。未写 SIT、staging、production、远程数据库、Git remote 或客户系统。
- 最终 Playwright webServer/worker PID `37376/22536/26776/31120` 均已退出；`3001/5173` 无监听。
- 保留本地 PostgreSQL 服务 `pfc-postgresql-18`：PID `40516`，`127.0.0.1:5432`，用途为本地开发数据库，启动类型 Manual；管理员可用 `Stop-Service pfc-postgresql-18` 停止。
- 当前分支 `feat/cap-pfc-01-m1`；仓库仍为未提交工作区，没有 commit/push/merge。

## 11. 指标与后续门槛

- 返工/门禁：Quick 因格式阻断 `2` 次、沙箱子进程权限阻断 `2` 次；Playwright 因本机 revision 不匹配阻断 `1` 次；Spec 自审纠正首次 OTHER、缺失项和 NOT_FOUND 恢复 `3` 类行为。
- 缺陷来源：测试隔离/类型覆盖、产品规则逐条对照、视觉截图读回；无发布后问题，因为尚未发布。
- 正式接受仍需登记具体代码评审、测试和安全责任人并完成复核。之后才能形成 T3 acceptance；本报告不构成 T4、提交、合入、发布或部署授权。
