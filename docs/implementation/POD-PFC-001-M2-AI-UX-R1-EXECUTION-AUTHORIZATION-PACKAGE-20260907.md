# POD-PFC-001 M2 AI-UX-R1 分阶段执行授权包

> 分类：System Iteration Requirement / strict / 开发前授权  
> 状态：`STAGE_5_LOCAL_VERIFIED / STANDARD_MIGRATION_AUTHORIZATION_PENDING`  
> 日期：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 影响 CAP：`CAP-PFC-01/02/03/04`；`CAP-PFC-05` 延后  
> 已确认设计：`AI-UX-D0`、`AI-UX-D1`  
> 当前 POD 唯一路线：`POD-PFC-001/M2/AI-UX-R1/standard-migration-authorization`

## 1. 请求的授权结论

请求产品负责人一次性确认以下分阶段执行包：

1. 先完成 M2-R2 的精确标准本地 migration `202609060005`、双账号真实本地链路和专项验收。
2. R2 收口后实施 AI-UX-R1-A 至 R1-D 的源码、测试、文档、隔离 migration、真实本地 Bridge/Codex 和代表页面。
3. AI-UX 新 migration `006/007` 只允许在隔离 `codex_test_aiux_*` schema 执行；标准 `pfc` 落库必须等 migration 文件完成、评审、hash 和预检证据齐备后再次取得精确授权。
4. 不新增或升级依赖，不改注册源工作区，不进行 remote Git、SIT/生产、发布或部署。

确认本包后，范围内的普通源码修改、隔离测试和明确的本地进程不再逐命令重复询问；任何超出目标、环境、动作、数据或停止条件的操作仍需重新授权。

## 2. 分阶段范围与停点

| 阶段 | 工作包                               | 允许结果                                                                           | 强制停点                                              |
| ---: | ------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
|    0 | 环境恢复与只读预检                   | 固定 Node/npm、规则、branch、配置键、DB/listener、gate dry-run 证据                | 依赖缺失、目标不唯一、凭据或 schema 状态异常          |
|    1 | M2-R2 标准库收口                     | 005 migration、R2 Skill、两账号、真实审批/拒绝/取消/UNKNOWN、API/DB/UI/Bridge 读回 | 非 `pfc_local/pfc`、004 缺失、005 已存在或 shape 不符 |
|    2 | AI-UX-R1-A contracts/domain/security | 状态机、typed proposal、权限和 transmission authorization 代码及测试               | D1 白名单或权限边界需要扩大                           |
|    3 | AI-UX-R1-B persistence/API/SSE       | 006/007 migration 源码、repository、API/SSE、隔离 schema 证据                      | 禁止向标准 `pfc` 应用 006/007                         |
|    4 | AI-UX-R1-C Bridge/Codex              | 合成数据的真实只读 ProductWorkTurn、Skill、流式事件、取消和 UNKNOWN                | 真实/敏感材料、写工具、外部业务动作或不兼容 Bridge    |
|    5 | AI-UX-R1-D UI Kit 与代表页           | `/ui-kit` 模板、真实 API/隔离 PostgreSQL/真实回合页面、三宽度自动证据              | 标准库体验和正式人工验收等待 006/007 单独授权         |

阶段按 0→5 串行。任一停点触发后保留证据并停止后续阶段，不能用 fixture、mock、演示标签或聊天自报跨越阻断。

## 3. 可写文件范围

### 3.1 AI-UX-R1 源码和测试

- `packages/contracts/src/work-sessions.ts` 及 `packages/contracts/src/index.ts`。
- `packages/domain/src/product-work-session.ts` 及 `packages/domain/src/index.ts`。
- `packages/persistence/src/work-session-repository.ts`、`scoped-authorization-repository.ts`、database type/index exports 和候选 migration `202609070006_*`、`202609070007_*`。
- `packages/protocol/src/product-work-turn.ts` 及协议导出。
- `packages/test-data/src/ai-work-session-factory.ts` 及测试数据导出。
- `packages/ui` 中 D0 已确认的 token、组件、catalog 和对应测试。
- `apps/server/src/work-sessions/`、现有 authorization/composition/app 装配点和必要错误映射。
- `apps/bridge/src/product-work-turn-worker.ts` 及现有 gateway/runtime/capability 装配点。
- `apps/web/src/work-sessions/`、路由装配和现有平台导航映射。
- `tests/unit`、`tests/contract`、`tests/integration`、`tests/e2e`、`tests/performance` 中 AI-UX-R1 与 R2 收口用例。
- `scripts/` 中 migration 预检、R2 双账号验收、AI-UX 隔离验收、证据读回和清理脚本。

### 3.2 治理与文档

- `.env.example` 仅增加无值的配置键示例。
- `.quality-gate/profile.json` 仅补充已确认的 work-session critical flow 和 gate coverage。
- `.quality-gate/delivery-plan.json` 仅在 R2 真实证据完成后更新状态和唯一 next route，不改变 5 CAP、26 Unit 或 M1-M3 成员。
- `package.json` 仅允许增加项目脚本，不新增依赖；`package-lock.json` 必须保持不变。
- `docs/implementation/`、`docs/design-system/`、`docs/quality-gate/reports/` 写入设计确认、实施检查点、测试报告、视觉证据索引和残余风险。

### 3.3 本地忽略产物

- `.local/m2-r2-acceptance/`、`.local/aiux-r1/`：本地凭据、Bridge registry、运行状态和临时证据，必须保持 gitignored。
- `.local/run-capsules/CODEx_TEST_*`：R2 授权胶囊，最长保留 24 小时。
- `output/playwright/`、`test-results/`、`playwright-report/`、`dist/`：由项目命令生成，不手工编辑、不提交。

除此之外的源码、相邻方法仓库、用户工作区、Git 元数据、系统目录和外部目标均不在可写范围。

## 4. 数据库授权边界

### 4.1 本包请求授权的标准库动作

唯一标准目标：

| 项                     | 精确值                                        |
| ---------------------- | --------------------------------------------- |
| 环境                   | 本机 local                                    |
| Host                   | `127.0.0.1` 或 `localhost`                    |
| Port                   | `5432`                                        |
| Database               | `pfc_local`                                   |
| Schema                 | `pfc`                                         |
| 前置 migration         | `202609060004_create_m2_agent_run` 必须已存在 |
| 唯一允许新增 migration | `202609060005_create_m2_approval_control`     |

执行前必须由 `npm run db:migrate:m2-r2-preflight` 读回：目标正确、004 已应用、005 未应用、`pfc.agent_runs` 和 `pfc.agent_run_commands` 存在、`pfc.approval_requests` 不存在。执行脚本只能 `migrateTo('202609060005_create_m2_approval_control')`，结果出现其他 migration 立即失败。

005 后允许在标准 `pfc` 创建前缀 `CODEx_TEST_M2_R2_{runId}_*` 的合成验收事实：两账号、一个团队、assignment、需求、基线、产物/版本、工作区/绑定、Bridge/Skill、Run、Approval、Command、Event、Audit、Timeline 和 Outbox。禁止更新或删除任何非该 runId 的记录。

标准验收事实默认保留供具名验收；ID、创建时间和 retained 状态写入脱敏报告。账号口令只写入 gitignored 本地文件，不进入日志、截图、文档或最终消息。后续删除标准验收事实属于新的 DML 授权，不包含在本包。

### 4.2 本包允许的隔离数据库动作

- 自动创建、迁移、写入、读回并删除 `codex_test_m2_r2_*` 和 `codex_test_aiux_*` schema。
- 仅使用确定性 factory 和 `CODEx_TEST_` ID；不得复制标准库或真实用户数据作为 fixture。
- 每次报告 runId、createdIds、断言、cleanup 和 schema 不存在读回。

### 4.3 本包明确不授权的数据库动作

- 向标准 `pfc` 应用未来的 AI-UX migration `006/007`。
- 任意生产、SIT、测试共享库、远程主机或数据库。
- 修改/删除现有非测试数据、drop/cascade 标准 schema、绕过 migration 手工 DDL、打印连接串或数据库密码。

## 5. 命令与进程授权

所有项目命令先把 `D:\项目管理\product-full-chain-platform\.tools\node-v24.20.0-win-x64` 放到当前 PowerShell PATH；禁止使用系统旧 Node 代替。

### 5.1 环境和只读命令

- `node --version`、`npm --version`、`git status/diff/log/show/branch`、`rg`、配置键检查和端口/进程审计。
- `npm run test:gate:quick -- --dry-run`、`npm run test:gate:core -- --dry-run`、`npm run test:gate:full -- --dry-run`。
- 只读取 `.env.local` 的键存在性、目标 host/database 指纹和脱敏配置，不输出值。

### 5.2 M2-R2 精确标准动作

- `npm run db:migrate:m2-r2-preflight`：零写预检。
- `npm run db:migrate:m2-r2`：仅应用 005，并从 migration 表读回。
- `npm run local:skill:register-m2-r2`：只登记固定、评估通过、hash 匹配的本地 SkillRelease。
- 增加并运行 R2 双账号 setup/readback 脚本，runId 使用 `R2_REAL_20260907_A`，数据库 ID 自动带 `CODEx_TEST_M2_R2_` 前缀。
- `npm run test:m2:r2:app-server -- --output .local/m2-r2-acceptance/app-server-result.json`：只写隔离胶囊，不写注册源工作区。
- 运行 R2 专项 API、Bridge 和浏览器验收脚本，结果写 `.local/` 和 `docs/quality-gate/reports/` 的脱敏摘要。

### 5.3 AI-UX-R1 开发和验证命令

- 固定依赖下的 lint、Prettier、TypeScript、Vitest、Kysely isolated migration、workspace build 和 Playwright。
- `npm run test:gate:quick`、`npm run test:gate:core`、`npm run test:gate:full`；Full 中 `npm audit` 只允许读取 npm registry 漏洞信息，不允许安装或升级依赖。
- 新增的 AI-UX migration plan/preflight/test 命令只能指向 `codex_test_aiux_*`，标准 `pfc` 命令保持禁用。
- 浏览器仅使用项目已安装 Edge/Playwright，视口为 1280×720、1440×900、1920×1080。

### 5.4 允许启动的本地进程

| 进程             | 绑定/目标                     | 用途                                 |
| ---------------- | ----------------------------- | ------------------------------------ |
| PostgreSQL 18    | 既有 `127.0.0.1:5432`         | 标准 R2 与隔离 AI-UX 数据            |
| Fastify API      | `127.0.0.1:3001`              | HTTP/SSE、鉴权和读回                 |
| Vite Web         | `127.0.0.1:5173`              | PC 代表页面和浏览器验收              |
| PFC Bridge       | 仅连接 `127.0.0.1:3001`       | 领取受控本地命令                     |
| Codex App Server | Bridge 拥有的短生命周期子进程 | 合成材料的真实只读回合或 R2 胶囊写入 |
| Edge/Playwright  | headless、本机                | 三宽度和交互证据                     |

除 PostgreSQL 按现有本地服务策略保留外，API、Web、Bridge、Codex App Server、浏览器和测试 runner 在每阶段结束时关闭，并报告 PID、端口、用途和关闭命令。禁止新增防火墙规则或监听非 loopback 地址。

## 6. Codex、Skill、网络和敏感数据

- R2 workspace-write 只允许读取相邻方法仓库中已登记的非敏感评估文件，并写入 `.local/run-capsules/CODEx_TEST_*`；相邻仓库和当前平台注册源均只读，运行前后比较 hash。
- AI-UX-R1 ProductWorkTurn 只使用 factory 生成的合成需求、材料、问题和产物；绑定固定、已评估、hash 匹配的 SkillRelease。
- 允许 Codex App Server 使用本机现有配置进行模型请求，这会把合成测试上下文传给已配置的 Codex 服务；不得传输客户数据、真实员工信息、凭据、私有日志或 RESTRICTED 材料。
- ProductWorkTurn 的工具默认关闭；R2 写入只使用已确认的胶囊 RunScope，`networkAccess=false`。模型请求授权不包含工具联网、MCP 写入、Git、部署或外部业务系统调用。
- 不安装新模型、字体、浏览器、Skill、MCP 或 npm 依赖。发现现有工具不足时停止并提交供应链评估与单独安装授权。
- 不在日志、测试报告、截图或最终消息输出 Cookie、token、密码、连接串、用户目录或绝对工作区路径。

## 7. TDD、测试数据与证据

### 7.1 TDD

每个行为变化先增加失败测试并确认失败原因，再实现最小代码。按 D1 顺序覆盖 contract/domain、migration/repository、API/authorization、Bridge/protocol、UI 和 E2E；不可实践 TDD 的纯 token/视觉调整必须先有 UI Kit 状态用例和后续截图证据。

### 7.2 测试数据

- R2 标准验收：`R2_REAL_20260907_A`，两账号验证请求人与批准人分离、自批拒绝、批准/拒绝/取消/UNKNOWN 和审计。
- AI-UX 自动化：每次独立 runId，factory 创建 7 类角色、需求/基线、材料、Question/Decision、ArtifactVersion、Workspace、Skill、Bridge capability 和 transmission grant。
- AI-UX 真实 Codex：只使用 `CODEx_TEST_AIUX_*` 合成内容；记录 context IDs/hash，不保存隐藏推理。
- 所有数据场景必须记录前置、步骤、预期、权限/状态组合、createdIds、cleanup/retention 和敏感数据结论。

### 7.3 验证和报告

- 开发中运行受影响测试；每阶段运行 Quick，持久化/API 后运行 Core，真实链路和代表页面后运行 Full。
- 005、R2 标准事实、AI-UX isolated schema、API DTO、SSE sequence、Bridge event、Codex external IDs、proposal、AgentRun/Approval 和 UI 都必须有数据库/API/页面读回。
- 生成 `docs/quality-gate/reports/2026-09-07-m2-r2-closeout.md` 与 `2026-09-07-ai-ux-r1.md`，记录命令、环境、配置来源、数据来源、授权、PASS/FAIL/BLOCKED、createdIds、清理、未测范围和残余风险。
- 自动测试或报告不能替代具名代码评审、测试、安全验收和产品负责人三宽度人工验收。

## 8. 安全控制和立即停止条件

任一条件出现立即停止后续动作、关闭 AI workspace flag、保留证据并报告：

- migration 目标不是本机 `pfc_local/pfc`，004 缺失、005 已存在、预检 shape 不符或准备执行 005 之外的 migration。
- 发现真实客户/员工/凭据/RESTRICTED 内容准备进入 Codex、日志、截图或测试文件。
- proposal 绕过目标应用服务、目标权限、rowVersion、scopeHash、CSRF 或 Idempotency-Key。
- WORKSPACE_WRITE 在 RUN_START 批准前产生启动命令，批准者等于请求人，或写到胶囊之外。
- UNKNOWN 被显示为成功、结果不明时自动重试、并发确认产生重复业务写。
- 注册源工作区 hash 变化、旧 Bridge 收到不兼容命令、进程/端口无法归属或出现资源错误。
- 1280/1440/1920 任一主流程出现遮挡、不可达、焦点丢失或视觉验收明显不达 D0 基线。

回滚优先关闭 `PFC_AI_WORKSPACE_ENABLED`、停用 ProductWorkTurn 命令租约和保留现有传统入口。数据库已有事实不 drop；通过前向 migration 修复。R2 胶囊不回写注册源，失败后清理受控临时目录并保留 hash/审计。

## 9. 明确不授权

- 向标准 `pfc` 应用 AI-UX `006/007` 或其他未审查 migration。
- 任何依赖安装/升级、lockfile 变化、远程下载脚本、外部字体或新二进制。
- 修改相邻方法仓库、平台注册源工作区、用户其他文件或 Git 历史。
- commit、push、merge、branch 删除、PR、远程 Git、SIT、生产、客户系统、远程数据库、发布、部署或防火墙变更。
- MCP 写入、工具联网、Shell 任意执行、未限定目录写入、真实材料传输或自动外部动作。
- 用 fixture、mock、`pfc_experience`、内存状态或演示数据宣称集成、验收或发布完成。

## 10. 状态、责任人与下一路线

| 项                     | 当前结论                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| Parent POD / Milestone | `POD-PFC-001 / M2`                                                         |
| implementation         | R2 `INTEGRATED`；AI-UX-R1-A/B/C/D `LOCAL_VERIFIED`                         |
| integration            | R2 标准本地集成 `PASS`；AI-UX-R1 隔离 API/Bridge/Codex/UI `LOCAL_VERIFIED` |
| acceptance             | `BLOCKED`                                                                  |
| deferred               | AI-UX 006/007 标准落库、Zed 交接、MCP 证据、CAP-PFC-05、发布与观察         |
| current POD next route | `POD-PFC-001/M2/AI-UX-R1/standard-migration-authorization`                 |

- 产品负责人/当前工程 Owner：陈立。
- 代码评审：`陈立`。
- 测试：`陈立`。
- 安全：`陈立`。
- 不使用并行 Agent；本地并发只限项目测试内部受控 worker，Bridge session pool 上限保持 3。

R2 真实收口后，ledger 唯一路线才可切换为 `POD-PFC-001/M2/AI-UX-R1/contracts-domain-security`。AI-UX-R1 完成隔离验证后，必须提交 006/007 文件 hash、schema diff、零写预检、标准数据计划、回滚和读回清单，取得另一次标准 `pfc` 精确授权；在此之前最多结论为 `LOCAL_VERIFIED`，不能标记 `INTEGRATED` 或 `ACCEPTED`。

## 11. 授权确认记录

产品负责人确认本包，表示授权第 1-8 节列明的本地源码、测试、R2 精确 005 migration、R2 合成标准验收事实、隔离 AI-UX schema、短生命周期本地进程以及合成上下文的真实 Codex 请求；同时接受第 8 节停止条件和第 9 节明确排除项。

该确认不授权 AI-UX 006/007 标准落库、依赖变更、真实敏感数据、注册源写入、远程 Git、SIT/生产、发布或部署。

- 确认时间：2026-09-07。
- 确认方式：产品负责人在当前协作会话明确回复“确认 AI-UX-R1 分阶段执行授权包”。
- 授权范围：严格限于本文件第 1-8 节，并持续受第 8 节停止条件与第 9 节排除项约束。
