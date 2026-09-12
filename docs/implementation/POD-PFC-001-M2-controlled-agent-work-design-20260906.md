# POD-PFC-001 M2 受控作业闭环设计

> 设计日期：2026-09-06  
> 权威范围：`POD-PFC-001` 主 Spec `V0.1/R3`  
> 当前里程碑事实：M1 `IN_PROGRESS`，M2 `IN_PROGRESS`  
> 设计状态：`DESIGN_CONFIRMED`  
> 实施状态：M2 总体 `IMPLEMENTING`；M2-R1 `INTEGRATED`  
> 集成状态：M2 总体 `IN_PROGRESS`；M2-R1 `INTEGRATED`  
> 验收状态：`BLOCKED`

## 1. 迭代分类与授权边界

本轮属于严格级别的系统迭代，涉及用户可见流程、API、PostgreSQL 数据模型、角色权限、本地进程、Codex/Skill/MCP 以及执行审计，必须按“需求 -> 设计 -> 开发 -> 测试 -> 验收 -> 发布 -> 观察 -> 复盘”推进。

产品负责人已于 2026-09-06 明确确认本设计。该确认关闭 M2 设计决策，但不跳过 M1 退出条件，也不授权 migration、标准业务数据写入、依赖安装、提交、推送或外部写入。后续明确的并行偏差授权仅允许 M2 实现和隔离验证启动，不改写 M1 状态。

M1 的具名评审、G10 产品验收和一个本地工作日观察仍是正式切换 M2 的前置条件。M2 设计可并行完成；M2 代码实施必须在 M1 关闭后开始，或由产品负责人明确接受该并行实施偏差。

产品负责人已于 2026-09-06 明确接受 M1 验收未完成的并行偏差并授权开始 M2。自此 M2 可进入实现和隔离验证；M1 状态、验收缺口和观察窗口继续独立保留，不得被 M2 结果覆盖。

## 2. 范围、目标与非目标

### 2.1 M2 完整范围

| CAP    | Unit                                  | M2 可观察结果                                                 |
| ------ | ------------------------------------- | ------------------------------------------------------------- |
| PFC-02 | `UNIT-PFC-02-02` 产物生成或检查请求   | 请求绑定需求基线、目标产物和固定 Skill 版本，不使用游离提示词 |
| PFC-02 | `UNIT-PFC-02-03` 版本查看、编辑与比较 | 产物历史不可覆盖，可定位版本间变化                            |
| PFC-02 | `UNIT-PFC-02-04` 产物评审与确认       | 评审绑定准确版本、结论、责任人和时间                          |
| PFC-02 | `UNIT-PFC-02-05` 双向追踪             | 需求、CAP、Unit、AC、产物、AgentRun 和证据可相互定位          |
| PFC-03 | `UNIT-PFC-03-01` 发起 Agent 作业      | 作业绑定完整业务、代码、Skill 和授权上下文                    |
| PFC-03 | `UNIT-PFC-03-02` 实时执行事件         | 运行、输入、审批、失败、完成和 UNKNOWN 状态可见               |
| PFC-03 | `UNIT-PFC-03-03` 范围审批             | 具体动作只在明确目录、命令、期限和运行范围内获批              |
| PFC-03 | `UNIT-PFC-03-05` 作业恢复与控制       | 刷新、断线、取消和重试不制造伪成功或重复副作用                |
| PFC-03 | `UNIT-PFC-03-06` 结果与证据归档       | 结果回到对应需求、版本、门禁和执行记录                        |
| PFC-04 | `UNIT-PFC-04-04` 本地桥接器配对       | Bridge 身份、版本、在线状态、工作区和撤销状态可见             |
| PFC-04 | `UNIT-PFC-04-05` 权限与执行审计       | 关键查看、修改、审批、控制和执行均可追溯                      |

M2 退出目标是用标准本地 PostgreSQL 和真实本机依赖完成一条受控作业闭环：选择已登记的 Skill 与当前需求基线，创建 AgentRun，经已配对 Bridge 调用真实 Codex App Server，观察与恢复事件，处理审批或取消，归档真实结果和证据；未授权路径与动作保持拒绝。

### 2.2 非目标

- `UNIT-PFC-03-04` Web/Zed 完整作业交接仍属于 M3。M2 只完成 Zed 可用性、路径、文件、Diff 和 ACP 边界 Spike，不宣称双端闭环已集成。
- M2 不接 SIT、生产、远程 Git、外部数据库或客户系统，不执行 commit、push、deploy 或生产写入。
- 不把 Vibe Kanban、ECC、Zed 或 MCP 服务作为本平台业务事实源，不复制其运行时或源码。
- 不提供自由 Shell、自由提示词、任意本地路径、任意 Skill 路径或浏览器直连 Bridge。
- 不用 fixture、演示回执或 unavailable adapter 计入 M2 集成和验收。测试 factory 只进入可清理的 `codex_test_*` schema。
- 不将原始终端字节流、完整提示词、凭据、Cookie、环境变量或绝对敏感路径上传到平台日志。

## 3. 已核实前提与待确认事项

### 3.1 当前可核实前提

- 项目使用 Node `24.20.0`、React 19、Fastify 5、PostgreSQL 18 和 Kysely，浏览器通过 HTTP/SSE 访问服务端。
- 设计确认时本机 Codex CLI 为 `0.148.0`；2026-09-06 实施复核时已升级为 `0.153.4`。`codex app-server` 支持默认 stdio、daemon/proxy、TypeScript/JSON Schema 生成，`codex mcp` 支持 list/get/add/remove/login/logout。R1 已按 `0.153.4` 重新生成并固定协议绑定，Skill/Bridge 必须按 `codex-app-server/0.153` 兼容门禁匹配，不能沿用旧版本假设。
- Zed 已安装在 `C:\Program Files\ZedG`，CLI 能打开目录/文件并支持 `--diff`；它未加入 PATH。该事实只证明本机 CLI 可执行，不证明 ACP/Codex 外部 Agent 已配置。
- 当前 ArtifactVersion 已使用不可变版本、内容哈希和受控来源引用；M2 在此基础上扩展生成请求、评审与追踪，不建立第二套产物表。
- 当前运行仍保留 M1 的 unavailable GateExecutionPort；M2 真实链路完成后必须替换对应路径，不能并存为可接受的产品结果。

### 3.2 需要本次设计确认的决策

1. 采用第 4 节方案 A 和第 5 节模块边界。
2. M2-R1 只开放只读工作区与无外部副作用的真实 Codex 作业；工作区写入、命令审批和取消恢复在 M2-R2 开放。
3. Skill 运行时来源由 Bridge 的本地允许清单解析，平台只保存版本、哈希、元数据和逻辑来源，不复制完整 Skill 或脚本进数据库。
4. Codex 项目配置是 MCP 运行时权威；平台只保存脱敏能力快照和执行证据，不编辑用户的 MCP 凭据或配置。
5. Zed M2 Spike 可使用现有 `ZedG` CLI 打开隔离测试工作区、文件和 Diff；完整 `runId` 双端交接留在 M3。

## 4. 方案比较与选择

| 方案                                              | 结构                                                                                 | 收益                                                                                              | 主要风险                                                                        | 结论             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| A. 独立 Bridge + App Server stdio + 平台 HTTP/SSE | Browser -> Server；Bridge 主动拉取命令并回传事件；Bridge 子进程独占 App Server stdio | 浏览器不接触 Shell；协议和本地进程隔离；易测试重放、取消和脱敏；不依赖实验性 App Server WebSocket | 需要自建 Bridge 协议、租约和事件恢复                                            | **推荐，待确认** |
| B. Browser 直连本机 App Server                    | 页面直接连接 App Server WebSocket                                                    | 代码路径短                                                                                        | App Server WebSocket 仍属实验能力；浏览器获得过大本机能力；难统一团队权限与审计 | 拒绝             |
| C. 服务端直接启动 Codex                           | Fastify 进程直接管理本机 Codex 与工作目录                                            | 本机单用户实现较快                                                                                | 无法演进为团队多 Bridge；中心服务触达本地代码与凭据；职责混杂                   | 拒绝             |

方案 A 中 Server/Bridge 的协议与传输分离。M2 本机环境先使用仅限 `127.0.0.1` 的鉴权长轮询和事件 POST，不增加 WebSocket 依赖；命令拾取后立即重开长轮询，事件实时 POST，浏览器继续使用 SSE。未来非 loopback 部署必须替换为 HTTPS/WSS，并重新完成身份、证书和网络授权设计，不能沿用明文通道。

Bridge 与 Codex App Server 使用默认 stdio JSONL。实现阶段按已安装 CLI 版本生成协议 Schema/TypeScript 绑定并作为生成物管理，适配器只暴露平台稳定端口，不让 App Server 类型渗入领域、API 或 UI。

## 5. 模块与代码架构

| 位置                                                     | 单一职责                                                   | 禁止事项                                |
| -------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `packages/contracts/src/agent-runs.ts`                   | Web/API 的 AgentRun、事件、审批、控制 DTO                  | 不包含 App Server 原始协议              |
| `packages/contracts/src/skills.ts`                       | Skill 目录、版本、风险、兼容性 DTO                         | 不保存 Skill 正文或脚本                 |
| `packages/protocol`                                      | Server/Bridge 版本化消息、租约、心跳、能力快照             | 不依赖 React、Fastify 或 PostgreSQL     |
| `packages/domain/src/agent-run.ts`                       | AgentRun 状态机、上下文完整性和终态规则                    | 不启动进程或写数据库                    |
| `packages/domain/src/approval.ts`                        | 审批范围、有效期、缩小范围和撤销规则                       | 不把审批推断为外部写入授权              |
| `packages/domain/src/artifact-review.ts`                 | 评审、版本比较和追踪不变量                                 | 不读取文件系统                          |
| `packages/persistence/src/m2-database.ts`                | M2 表类型并扩展现有数据库类型                              | 不继续扩大 `m1-database.ts`             |
| `packages/persistence/src/agent-run-repository.ts`       | Run、事件、命令租约、幂等和证据事务                        | 不并入现有 2400 行 lifecycle repository |
| `packages/persistence/src/bridge-repository.ts`          | Bridge 配对、心跳、撤销和能力快照                          | 不访问产物正文                          |
| `packages/persistence/src/skill-repository.ts`           | SkillRelease 与启用范围元数据                              | 不保存本地凭据和绝对私密路径            |
| `packages/persistence/src/artifact-review-repository.ts` | 评审和追踪关系                                             | 不直接变更 Requirement 状态             |
| `packages/codex-adapter`                                 | App Server 生命周期、JSONL、Schema 版本隔离、事件归一化    | 不写平台业务表                          |
| `apps/bridge`                                            | 工作区验证、命令租约、Codex 子进程、Zed/MCP 能力探测、脱敏 | 不接受浏览器调用；不自行扩大授权        |
| `apps/server/src/agent-runs`                             | 创建、查询、审批、控制和归档用例                           | 不直接启动本地进程                      |
| `apps/server/src/bridges`                                | 配对、心跳、命令租约和事件入口                             | 与用户会话 API 分开鉴权                 |
| `apps/server/src/skills`                                 | Skill 目录、版本、启用范围与生成请求                       | 不执行 Skill                            |
| `apps/server/src/artifact-reviews`                       | Diff 元数据、评审和双向追踪                                | 不覆盖历史版本                          |
| `apps/web/src/agent-runs`                                | 作业中心、事件流、审批和控制 UI                            | 不解释原始 App Server 事件              |
| `apps/web/src/skills`                                    | Skill 目录和详情                                           | 不显示本地绝对路径                      |
| `apps/web/src/artifact-reviews`                          | 版本比较、评审与追踪 UI                                    | 不用页面本地色值/字号/圆角              |

`apps/server/src/app.ts` 只完成模块注册；`main.ts` 的组装将拆到 feature composition root，避免 M2 继续扩张现有组装文件。`apps/web/src/App.tsx` 只保留路由组合，M2 页面各自持有 API、状态与交互。新增共享视觉能力先进入 `packages/ui` 和 `/ui-kit`。

## 6. 真实执行链路

```text
产品经理选择需求当前基线 + 目标产物 + 固定 SkillRelease
  -> Server 校验团队、分工、工作区、版本、敏感级别和允许动作
  -> PostgreSQL 原子创建 AgentRun、首条事件、命令和审计
  -> 已配对 Bridge 领取带租约命令并再次校验本地工作区指纹
  -> Bridge 启动 codex app-server --stdio，完成 initialize
  -> thread/start 绑定 cwd、平台批准的 sandbox/approval policy
  -> turn/start 显式传入业务上下文和 Skill 引用
  -> App Server 事件经 adapter 归一化、脱敏并按单调序号回传
  -> Server 去重落库；Browser SSE 从 afterSequence 恢复
  -> 审批/输入/取消经平台命令进入同一 runId
  -> 终态结果生成不可覆盖 ArtifactVersion 或失败/未知证据
```

平台 `runId`、Bridge 命令 ID、Codex thread ID、turn ID 和 item ID 分栏保存，禁止互相推导。App Server 初始化、线程创建、回合启动和事件订阅均设置超时；协议错误、子进程退出、事件序号缺口或取消结果不明时进入 `UNKNOWN`，不得写成成功。

## 7. 状态、并发与恢复

### 7.1 AgentRun

```text
QUEUED -> STARTING -> RUNNING
RUNNING -> WAITING_INPUT | WAITING_APPROVAL | CANCELLING
WAITING_INPUT | WAITING_APPROVAL -> RUNNING | CANCELLING
CANCELLING -> CANCELLED | UNKNOWN
STARTING | RUNNING | WAITING_* -> FAILED | UNKNOWN
RUNNING -> SUCCEEDED
UNKNOWN -> VERIFYING -> SUCCEEDED | FAILED | CANCELLED | UNKNOWN
FAILED | CANCELLED -> RETRY_QUEUED（新 runId，保留 parentRunId）
```

`SUCCEEDED`、`FAILED`、`CANCELLED` 为终态；恢复核验是显式动作，不能直接覆写终态。重试创建新 AgentRun，不重用旧命令幂等键。每个 Bridge 最多 3 个并行运行，平台试点最多 5 个在线 Bridge；超限请求保持 QUEUED 并显示原因。

### 7.2 Bridge 与命令租约

Bridge 状态为 `OFFLINE / ONLINE / DEGRADED / REVOKED`。配对码一次性、短有效期，只显示一次；数据库保存摘要，不保存明文。Bridge 凭据保存在本机忽略目录且只授权其 Bridge ID 与团队工作区。

命令使用 `commandId + runId + leaseOwner + leaseUntil + attempt`。Bridge 只有在租约成功后执行；事件以 `(bridgeId, runId, sourceEventId)` 唯一去重。租约过期但副作用结果不明时不自动重发，先进入 UNKNOWN 和人工核验。

### 7.3 Approval

审批状态沿用权威模型 `PENDING / APPROVED / REJECTED / EXPIRED / REVOKED`。审批必须保存动作类型、工作区、相对路径、命令摘要、目标、有效期、允许决策和原请求哈希。批准人可以缩小范围，不能扩大原请求。

M2 永久硬拒绝：未知工作区、允许目录之外、浏览器发来的 Shell、凭据导出、外部网络写、commit、push、deploy、SIT/生产写入。产品 UI 不提供这些动作的“临时放行”按钮。

## 8. PostgreSQL 事实模型

M2 新增 migration，先在独立 `codex_test_m2_*` schema 验证，再在获得单独本地 schema 变更授权后应用到标准 `pfc`：

| 表                            | 关键事实                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `skill_releases`              | `skillKey`、显示名、说明、来源类型、逻辑来源、固定版本/提交、内容哈希、许可证、Harness、所需能力、风险、Owner、评测状态、启用范围 |
| `bridge_registrations`        | 团队、设备公钥/凭据摘要、协议版本、Bridge/Node/Codex/Zed 版本、状态、最后心跳、撤销时间                                           |
| `bridge_workspace_bindings`   | Bridge、Workspace、指纹核验结果和允许相对路径                                                                                     |
| `bridge_capability_snapshots` | Codex、Skill、MCP、Zed、Git 和工具的脱敏可用性快照                                                                                |
| `agent_runs`                  | 业务版本、工作区、Git 基线、SkillRelease、授权策略、状态、parentRunId、外部 ID、结果摘要和 rowVersion                             |
| `agent_run_events`            | 单调序号、归一化事件类型、脱敏摘要、sourceEventId、发生/接收时间                                                                  |
| `agent_run_commands`          | 命令类型、租约、尝试次数、幂等键、状态和结果摘要                                                                                  |
| `approval_requests`           | 运行、动作、请求范围、批准范围、决策人、有效期和状态                                                                              |
| `artifact_reviews`            | ArtifactVersion、结论、评审角色/人、意见、状态和时间                                                                              |
| `trace_links`                 | 带类型的 source/target 关系、有效性和创建来源                                                                                     |

事件、命令、审批和审计保存 30 天后按受控保留任务清理；ArtifactVersion、评审结论和双向追踪不随运行日志清理。原始本地日志默认不上传，保留期和清理结果由 Bridge 报告。任何清理实现必须先证明不会删除仍被门禁引用的证据。

## 9. API 与 Bridge 协议

### 9.1 Browser API

- `GET /api/v1/skills`、`GET /api/v1/skills/:key/releases/:version`
- `POST /api/v1/requirements/:id/agent-runs`
- `GET /api/v1/agent-runs/:runId`
- `GET /api/v1/agent-runs/:runId/events?afterSequence=`，以及相同 cursor 语义的 SSE
- `POST /api/v1/agent-runs/:runId/approvals/:approvalId/decision`
- `POST /api/v1/agent-runs/:runId/controls`
- `POST /api/v1/artifacts/:artifactId/versions/:versionId/reviews`
- `GET /api/v1/artifacts/:artifactId/versions/:versionId/diff`
- `GET /api/v1/requirements/:id/traces`
- `POST /api/v1/teams/:teamId/bridge-pairings`、`POST /api/v1/bridges/:bridgeId/revocations`

所有 mutation 使用 CSRF、幂等键、请求哈希和 rowVersion；授权先于正文、差异或事件读取。SSE 只发归一化事件，断线后按 sequence 续传。

### 9.2 Bridge API

Bridge 使用独立协议前缀和凭据，不复用浏览器 Cookie：

- `POST /bridge/v1/pairings/exchange`
- `POST /bridge/v1/heartbeats`
- `GET /bridge/v1/commands/next?afterCommandId=`（有界长轮询）
- `POST /bridge/v1/commands/:commandId/acknowledgements`
- `POST /bridge/v1/runs/:runId/events`
- `POST /bridge/v1/capability-snapshots`

每条消息包含 `protocolVersion`、`messageId`、`bridgeId`、时间戳和重放保护字段。未知协议版本 fail closed。payload 设大小上限，事件批次有条数上限；服务端回压时 Bridge 写有界本地队列，队列满则暂停运行并进入 DEGRADED，不丢弃终态或审批事件。

## 10. Skill、MCP 与 Zed 采用边界

### 10.1 Skill

Skill 目录显示来源、固定版本/提交、许可证、兼容 Harness、所需工具、风险、Owner、评测状态、上下文成本和启用范围。完整 `SKILL.md`、scripts、references 和 assets 仍由受控本地来源拥有；平台登记哈希和逻辑引用，Bridge 在启动前重新读回并校验哈希。

显式调用同时携带 `$skill-name` 文本和 App Server 支持的 Skill 输入项；Skill 只提供执行方法，不扩大目录、命令、网络或外部动作授权。哈希漂移时 AgentRun 不启动，并要求登记新 SkillRelease。

### 10.2 MCP

Codex 的项目级 `.codex/config.toml` 是 M2 运行时权威。Bridge 只采集脱敏快照：server 名、transport 类型、启用状态、认证是否就绪、工具/资源名称和采集版本；不上传 endpoint 查询参数、token、Cookie 或环境变量值。

平台不调用 `codex mcp add/remove/login/logout`，也不编辑 Zed 的 MCP 配置。M2-R3 只选择一个无外部写入的本地 MCP 能力完成真实调用和审计。Zed 通过 ACP 转发 MCP 与 Codex 原生 MCP 的重复权威问题必须在 M3 前解决；同一运行只允许一个 MCP 配置来源。

### 10.3 Zed

M2 Spike 使用已安装的 Zed CLI 验证：打开隔离仓库、定位文件行列、打开两个测试文件的 Diff、识别是否具备 External Agent/ACP 配置。平台不通过 UI 猜测已连接状态，Bridge 必须返回 CLI 版本、调用结果和人工核对证据。

M2 不把 Zed 编辑结果自动写成 AgentRun 成功。M3 才实现 `runId`、工作目录、文件、Diff 和控制权交接，并遵守单一交互控制端规则。

## 11. PC 页面与设计系统

M2 页面沿用已确认的 PFC UI 基线和 `packages/ui`，不重新发明字体、颜色、圆角或页面骨架：

- 一级导航新增“作业”，仅在真实 M2 API 可用后出现；模块二级导航为“运行、审批、Bridge、Skills、审计”。
- 作业中心使用 `PageHeading + MetricStrip + FilterPanel + DataPanel`，指标来自 PostgreSQL，不制造演示数字。
- AgentRun 详情使用 `DetailLayout`：左侧事件时间线和结果，右侧显示业务上下文、固定 Skill、工作区、Git 基线、授权和证据。
- Skill 目录使用已确认的三列发现卡模板；详情页显示版本、兼容性、所需工具、风险和启用范围，不展示绝对本地路径。
- 审批使用专门 Drawer，先展示“将做什么、在哪做、影响多大、何时失效”，再展示批准、缩小或拒绝操作。
- Bridge 页面显示在线状态、版本、工作区、能力快照和撤销动作；凭据永不回显。
- 必须覆盖 loading、empty、error、offline、degraded、waiting、unknown、cancelled 和 permission denied；URL 保留搜索、筛选、选中 runId 和事件 cursor。

首个视觉样板选择 AgentRun 详情页，使用真实本地运行数据完成 1280、1440、1920 三档截图、计算样式、hover、keyboard focus、事件恢复和失败态检查。样板视觉验收不通过时不批量迁移其他 M2 页面。

## 12. 版本计划和退出条件

### M2-R1：真实只读纵向链路

范围：`UNIT-PFC-02-02`、`UNIT-PFC-03-01/02`、`UNIT-PFC-04-04` 的可运行薄切。

- 新建 protocol、domain、persistence、codex-adapter 和 bridge 边界。
- Skill 目录读取固定 SkillRelease；选择当前需求基线和已验证工作区创建真实 AgentRun。
- Bridge 与 Codex App Server 完成 initialize、thread/start、turn/start 和事件回传。
- 只允许只读工作区与无外部副作用任务；显示 capability audit 和明确阻断原因。
- 重启 Web/API 后从 PostgreSQL 恢复同一 runId 和事件；fixture/unavailable 不计通过。

退出条件：一个合成但业务有效的非客户需求，使用标准 `pfc` 数据和真实本机 Codex/Bridge 完成一次只读产物检查；ArtifactVersion、runId、SkillRelease、工作区、Git 基线、事件和证据可读回；目录外请求稳定拒绝。

### M2-R2：审批、写入、取消与恢复

范围：`UNIT-PFC-03-03/05` 和 `UNIT-PFC-04-05`，补齐 `03-01/02/04-04`。

- 开放受控 workspace-write，审批映射、缩小范围、拒绝、过期和撤销。
- 完成 cancel、子进程树停止、Bridge 断线、命令租约、事件重放和 UNKNOWN 核验。
- 完成 Bridge 撤销、3 并发上限、日志脱敏和审计查询。

退出条件：授权写入在隔离测试仓库成功，未授权写入和外部动作全部拒绝；取消无残留进程；断线重放不重复副作用；不确定结果保持 UNKNOWN。

### M2-R3：产物评审、追踪和 MCP 证据

范围：`UNIT-PFC-02-03/04/05`、`UNIT-PFC-03-06`，完成 M2 全量整合。

- 产物版本正文引用、Diff、评审与确认绑定不可变 ArtifactVersion。
- 需求/CAP/Unit/AC/ArtifactVersion/AgentRun/Evidence 双向追踪。
- 一个只读本地 MCP 能力完成真实调用、脱敏事件和归档证据。
- 完成 M2 全量权限、恢复、安全、容量和 PC E2E。

M2 最终退出条件：11 个 Unit 全部达到真实本地 `INTEGRATED`；Codex/Skill 作业可启动、观察、审批、取消、恢复和归档；Bridge 与审计为真实依赖；未授权动作稳定拒绝；具名代码评审、测试、安全和产品验收均有结论。

## 13. 测试数据、验证与验收

M2 触发确定性 factory。测试设计前缀为 `CODEx_TEST_M2_<runId>`，数据只进入 `codex_test_m2_*` schema 和隔离临时 Git 仓库；包含以下场景：

- 当前/过期需求基线，匹配/漂移 Skill 哈希，已验证/未验证/越界工作区。
- Bridge 在线、离线、降级、撤销、过期配对、错误协议版本。
- 运行成功、输入等待、审批等待、拒绝、取消、失败、断线、序号缺口、UNKNOWN、恢复和重试。
- 1/3/4 并发，重复命令、重复事件、租约竞争和 API 幂等冲突。
- 产品、研发、测试、安全、团队管理员的允许/拒绝矩阵。
- 凭据、Cookie、环境变量、绝对敏感路径和超大输出的脱敏/截断。
- 产物版本冲突、Diff、评审版本错配、追踪断链和证据失效。

TDD 顺序：领域状态机和协议契约失败测试 -> repository/migration 集成失败测试 -> Server/Bridge adapter 失败测试 -> UI/Edge E2E。每个版本先执行 focused tests，再执行 quick/core；R2 和 R3 必须执行 full。真实 App Server/Zed/MCP Spike 单列证据，不能被 mock 单测替代。

验收记录必须包含场景、前置条件、步骤、预期、数据策略、自动化状态、责任人/验收人、命令、环境、配置来源、数据来源、结果、失败证据、createdIds、清理或保留状态及残余风险。

## 14. 风险、停止条件与回滚

| 风险                      | 控制                                                         | 停止条件                                     |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| App Server 协议变化       | 固定 CLI/Schema 版本、生成绑定、contract tests、隔离 adapter | initialize/事件/审批语义与固定 Schema 不一致 |
| Bridge 触达本地代码和凭据 | 本地主动连接、最小目录、动作 allowlist、脱敏、撤销           | 凭据泄露、目录逃逸或未知命令被执行           |
| 断线后重复副作用          | 命令租约、幂等键、事件去重、UNKNOWN 人工核验                 | 不能证明命令是否执行却准备自动重试           |
| Skill/MCP 来源漂移        | 固定版本与哈希、单一配置权威、能力快照                       | 哈希或来源与登记版本不一致                   |
| 子进程残留和资源耗尽      | 有界并发、超时、Windows 进程树停止、队列上限                 | 无法停止进程或出现 R6016/线程资源错误        |
| 日志体量和模型成本        | 事件摘要、分页、30 天保留、输出上限、用量记录                | 队列/日志超限且不能回压                      |
| UI 再次偏离               | 只用 packages/ui、代表页先验收、三档浏览器证据               | 代表页未达到已确认视觉基线                   |

代码回滚使用版本控制反向修改；数据库一旦承载标准业务事实，只做前向修复，不 drop/cascade。Bridge 新版本异常时撤销配对并停用 AgentRun 创建，已有运行进入 UNKNOWN 或安全终态；关闭真实 adapter 后只保留人工业务维护，不能回退为 fixture 并声称 M2 可用。

## 15. 实施顺序、并行策略与进程清理

1. 原计划为 M1 命名验收关闭后进入 M2-R1；产品负责人已明确接受 M1 验收未完成的并行偏差，因此 M2-R1 已启动，M1 阻断仍独立保留。
2. 先执行四个 Spike：App Server、Zed、Bridge 断线恢复、Windows 子进程树和脱敏；任一失败先回到设计。
3. 用 TDD 实现 R1；完成真实本地读回和代表页视觉验收。
4. 逐次完成 R2、R3；每次保留开发、测试、验收、观察和复盘证据。

当前不使用并行 Agent。M2 核心状态机、协议和 migration 紧密耦合，由控制者串行确定接口；接口稳定后才允许按非重叠文件所有权并行处理 `apps/bridge`、Web 页面和测试。并行度不超过 2，集成顺序为 contracts/domain -> persistence -> adapter/bridge -> server -> web -> gates。

每次测试结束关闭临时 App Server、Bridge、Zed 测试实例、Playwright、测试 runner 和临时 PostgreSQL 连接。若为用户体验保留 Web/API/PostgreSQL，交付时必须报告 PID、端口、目的和停止命令。

## 16. 接受、发布、观察与复盘

M2 仅发布本地候选，不部署外部环境。接受顺序为：具名代码评审 -> 具名测试结论 -> 具名安全结论 -> 产品验收。缺任何一项均不得把 `ACCEPTED`、`RELEASED` 或“平台已完成”写入台账。

本地候选需执行 quick/core/full、真实 Bridge/Codex smoke、重启读回和代表页浏览器验收。观察窗口至少一个本地工作日，关注失败率、审批等待、UNKNOWN 数、事件缺口、重放、残留进程、日志增长、P95 事件可见延迟和单次运行用量。触发目录逃逸、重复副作用、凭据泄露、状态伪成功或不可停止进程时立即停用真实执行入口并保留证据。

每个 R 版本记录 lead time、返工次数、失败门禁、缺陷来源、协议变化和用户体验反馈。M2 完成后回到 `POD-PFC-001/M3/PFC-03-04+PFC-05`，不得把 Zed Spike 冒充 M3 Web/Zed 交接完成。

## 17. 本次确认记录

产品负责人于 2026-09-06 以“确认”明确接受以下整包设计：

1. 采用独立 Bridge、App Server stdio、Server/Bridge 版本协议和 Browser HTTP/SSE。
2. 按 M2-R1 只读真实链路、M2-R2 审批/写入/恢复、M2-R3 评审/追踪/MCP 三段交付。
3. 原设计要求 M1 正式关闭后再开始 M2；产品负责人已在后续指令中明确接受该并行实施偏差。
4. 授权后续 Spike 使用隔离临时仓库启动本机 Codex App Server，并打开现有 Zed CLI；不包含外部写入、依赖安装、commit、push 或部署。

确认仅关闭上述 M2 设计范围。它不替代 M1 具名代码评审、测试、安全结论、G10 产品验收或一个本地工作日观察，也不接受这些缺口的残余风险。

## 18. Spike 回读与协议冻结（2026-09-06）

- App Server 真实 stdio 链路已验证 Skill 输入、只读线程、跨进程恢复、运行中断和线程删除。中断必须以 `turn/started` 通知中的 turn id 为锚点，不能在等待 `turn/start` 结果后再发起。
- Bridge 断线恢复冻结为 at-least-once 事件投递与幂等去重。已观测副作用但 ACK 丢失的命令进入 `UNKNOWN`，禁止自动重派，不宣称 exactly-once。
- Windows 清理必须绑定 Bridge 自有父 PID 并终止整棵子进程树；平台证据在入库前必须脱敏 Bearer、Cookie、token、password、数据库 URL、用户目录和工作区绝对路径。
- Zed CLI 版本、目录/行列/Diff 参数和 ACP 配置键已检测；本机单实例机制使测试进程快速派发后退出，因此不把 CLI exit 0 解释为界面已打开或 ACP 已连接。M2-R1 只暴露 `detected / unverified`，人工可见核对和 Web/Zed 交接仍属于 M3。

详细命令、结果、数据策略和清理证据见 `docs/quality-gate/reports/2026-09-06-m2-r1-spikes.md`。

## 19. 外部依据

- OpenAI Codex App Server：<https://developers.openai.com/codex/app-server/>
- OpenAI Agent Skills：<https://developers.openai.com/codex/skills/>
- OpenAI Codex MCP：<https://developers.openai.com/codex/mcp/>
- Zed External Agents：<https://zed.dev/docs/ai/external-agents>
- Zed Parallel Agents：<https://zed.dev/docs/ai/parallel-agents>
- Zed MCP Servers：<https://zed.dev/docs/ai/mcp>
