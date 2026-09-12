# POD-PFC-001 M2 AI-UX-D1 产品作业会话详细设计

> 分类：System Iteration Requirement / strict / 设计阶段  
> 状态：`AI-UX-D1 CONFIRMED`，产品负责人已确认  
> 日期：2026-09-07  
> 确认方式：当前协作会话明确回复“确认”  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 影响 CAP：`CAP-PFC-01/02/03/04`；`CAP-PFC-05` 仅保留后续接入点  
> 权威产品范围：主 Spec `V0.1/R3`、已确认 `AI-UX-D0`  
> 当前 POD 唯一路线：`POD-PFC-001/M2/R2/standard-local-migration-authorization`

## 1. 决策摘要

AI-UX-D1 采用“持久化产品作业会话 + 只读产品 Agent 回合 + 结构化动作建议 + 现有业务服务应用”的方案：

1. `ProductWorkSession` 绑定一个团队中的一条需求、打开时的需求版本和材料基线，是可恢复作业上下文，不是第二套需求事实。
2. `ProductWorkTurn` 表示一次用户意图及其真实 AI 处理过程；通过本地 Bridge 调用 Codex App Server，默认无写工具，不伪装成现有 `AgentRun`。
3. `ActionProposal` 保存可审查的类型化变更建议。用户确认只把建议交给既有应用服务；目标服务仍独立执行权限、版本、幂等和业务规则校验。
4. 需要文件、命令或其他受控执行时，建议只能创建现有 `AgentRun`。`WORKSPACE_WRITE` 仍必须经过 `AgentApproval`，产品建议确认不能替代执行审批。
5. 会话、回合、建议和恢复事件持久化到标准 PostgreSQL；React state、浏览器缓存、fixture 和模型聊天记忆都不能作为恢复或验收依据。
6. R2 标准 migration 和真实本地验收先收口。本文确认后仍需单独的 AI-UX-R1 实施授权和本地 schema-change 授权。

## 2. 当前基线与缺口

当前代码已提供以下可复用边界：

- `Requirement`、`Question/Decision`、`ArtifactVersion`、`GateRun` 使用 `rowVersion`、`If-Match`、`Idempotency-Key`、审计、Timeline 和 Outbox。
- `AgentRun` 已有运行状态机、持久化事件序列、审批、取消、UNKNOWN 核验、Bridge 命令和写入胶囊。
- 浏览器只经 HTTP/SSE 访问平台服务；Bridge、Codex、工作区和数据库不暴露给浏览器。
- 授权模型已经区分普通业务动作与 `TRANSMIT_MATERIAL`，但标准 PostgreSQL 授权端口尚未提供可用的材料传输授权数据。

仍缺少的不是一个聊天组件，而是以下端到端能力：

- 会话、回合、上下文引用和建议没有正式 contract、状态机和 PostgreSQL 模型。
- 产品对话尚无真实 Codex Bridge 命令、能力协商、流式事件和恢复协议。
- “确认产品建议”和“批准本地执行”尚未形成两个不可混淆的权限边界。
- 当前导航和需求详情尚未把需求事实、Agent 作业、产物画布与证据组合成一个连续任务空间。
- 传给 AI 的材料缺少 PostgreSQL 中可撤销、可过期、可审计的精确授权来源。

## 3. 目标、非目标与前提

### 3.1 目标

- 产品经理从一条真实需求进入后，可连续完成上下文恢复、澄清、建议审查、结构化写入、AgentRun 发起和证据查看。
- 每次 AI 输入都绑定明确需求、版本、材料引用、Skill 版本和传输授权；版本已变时不启动。
- 每项建议显示目标对象、当前版本、字段级变化、影响、确认人要求和失效条件。
- 刷新、SSE 断线、Bridge 离线、进程退出和 UNKNOWN 后按数据库状态恢复，不重复产生业务副作用。
- 权威业务对象仍由现有模块拥有；work-session 模块只能调用应用服务或消费领域事件。

### 3.2 非目标

- 不实现无需求绑定的通用聊天、自由工具调用、模型自主门禁、自动验收或自动发布。
- 不在 AI-UX-R1 实现 Web/Zed 控制端交接；`UNIT-PFC-03-04` 仍属于 M3。
- 不让 work-session repository 直接修改 requirements、questions、artifacts、gate-runs 或 agent-runs 表。
- 不保存模型隐藏推理、原始终端流、凭据、Cookie、数据库 URL、绝对工作区路径或未脱敏工具输出。
- 不用模拟 AI 回复、fixture、内存仓库或 `pfc_experience` 证明产品能力完成。

### 3.3 已采用前提

- 一个会话只绑定一条 Requirement；切换需求必须新建或恢复另一个会话。
- 会话允许多人分别打开，不使用全局编辑锁；所有目标写入依赖对象 `rowVersion` 防止覆盖。
- 同一会话同一时刻只允许一个未决写建议，避免用户确认对象不明确。
- AI-UX-R1 只支持 Web 控制端；字段保留 `controlSurface`，但不能显示未实现的 Zed 交接能力。
- 产品 Agent 回合只能读已授权上下文并生成建议；任何写副作用都走类型化建议和既有应用服务。

## 4. 方案比较与选择

| 方案                       | 描述                                               | 优点                               | 主要风险                             | 结论     |
| -------------------------- | -------------------------------------------------- | ---------------------------------- | ------------------------------------ | -------- |
| A. 会话直接写业务表        | 模型响应后由会话服务修改需求、问题和产物           | 表面链路短                         | 绕过对象 Owner、权限、版本和审计边界 | 不采用   |
| B. 所有对话都创建 AgentRun | 每次消息都套用现有工作区、Git 和 Skill 运行模型    | 复用运行框架                       | 产品澄清不一定有代码工作区，语义失真 | 不采用   |
| C. 会话与执行分层          | WorkTurn 负责只读理解和建议；AgentRun 负责受控执行 | 符合 D0 双核模型，边界清楚，可恢复 | 需要新增会话命令与建议协调器         | **采用** |

方案 C 中，`ProductWorkTurn` 是对话处理单元，`AgentRun` 是可执行作业单元。二者可以关联，但不能互相替代。

## 5. 领域模型与事实所有权

### 5.1 聚合与记录

| 对象                        | 责任                                                               | 不是其责任                                | 关键绑定                                              |
| --------------------------- | ------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------- |
| `ProductWorkSession`        | 保存需求作业上下文、当前活动回合、最后事件序号和恢复点             | 不保存权威阶段、门禁或产物状态            | team、requirement、打开版本、材料基线、owner          |
| `ProductWorkTurn`           | 保存一次用户意图、AI 可见答复、真实处理状态和外部 thread/turn 引用 | 不直接应用业务写入，不保存隐藏推理        | session、context snapshot、SkillRelease、Bridge       |
| `ContextBinding`            | 记录该回合实际使用的来源与版本，支持过期判断和追踪                 | 不复制完整业务对象                        | material/question/decision/artifact/gate/run/evidence |
| `ActionProposal`            | 保存类型化候选、目标版本、作用域哈希、确认和应用结果               | 不等于 Approval，不等于业务对象已更新     | session、turn、target aggregate、actor、result ref    |
| `ProductWorkSessionEvent`   | 提供会话内有序 SSE、恢复和操作反馈                                 | 不承载敏感正文，不替代全局 Timeline/Audit | session sequence、source event、safe summary          |
| `ProductWorkTurnCommand`    | 以租约和幂等键把真实回合交给兼容 Bridge                            | 不存完整 prompt，不执行业务写入           | turn、bridge capability、attempt、lease               |
| `ScopedActionAuthorization` | 为材料传输提供精确、可过期、可撤销授权                             | 不批准文件写、发布或外部业务动作          | actor、requirement、target、purpose、material refs    |

### 5.2 会话锚点

创建会话时由服务端校验并保存：

- `teamId`：客户端可从当前身份的 `currentTeamId` 提名；服务端必须同时验证 actor 的 ACTIVE membership 和 Requirement 的 ACTIVE assignment。只有一个有效候选时服务端可推导，多候选且未提交时返回明确校验错误，禁止猜测。
- `requirementId` 与 `openedRequirementVersion`。
- `openedBaselineId`，G0 尚无基线时可为 `null`。
- `openedStage` 和 `ownerId` 快照，仅用于恢复提示和审计。
- `currentRequirementVersion`：成功应用本会话建议后更新；外部修改导致不一致时会话进入 BLOCKED。

`opened*` 字段不可覆盖，`currentRequirementVersion` 只记录会话已知版本。页面每次恢复仍必须读取 Requirement 权威值。

### 5.3 ContextBinding 类型

首版允许以下 `contextType`：

`MATERIAL_BASELINE / MATERIAL_REF / QUESTION / DECISION / ARTIFACT_VERSION / GATE_RUN / AGENT_RUN / EVIDENCE`

每条 binding 保存 `targetId`、可用时的 `targetVersion`、内容哈希、用途 `PRIMARY/SOURCE/OUTPUT/EVIDENCE`、敏感级别和创建时间。目标变化时不覆盖 binding；追加 `invalidatedAt/reasonCode` 并创建新 binding。模型收到的是服务端按 binding 重新解析、权限检查和脱敏后的内容。

### 5.4 ActionProposal 首版白名单

| proposalKind               | 目标应用服务                  | 确认后结果                                            |
| -------------------------- | ----------------------------- | ----------------------------------------------------- |
| `COMPLETE_G0_REGISTRATION` | RequirementApplicationService | 仍按 Requirement `If-Match` 和完整性规则写入          |
| `ANSWER_QUESTION`          | QuestionApplicationService    | 保存原始回答，不自动形成最终确认                      |
| `CONFIRM_QUESTION`         | QuestionApplicationService    | 再校验确认角色和问题版本                              |
| `REGISTER_ARTIFACT`        | ArtifactApplicationService    | 创建目录记录，绑定需求和来源                          |
| `APPEND_ARTIFACT_VERSION`  | ArtifactApplicationService    | 新增不可覆盖版本，不改写历史                          |
| `CREATE_AGENT_RUN`         | AgentRunApplicationService    | READ_ONLY 排队；WORKSPACE_WRITE 进入 WAITING_APPROVAL |

白名单之外的模型输出只能作为解释或草稿显示。新增 proposalKind 必须先有类型化 contract、目标权限映射、应用适配器和回归测试，不能使用任意 URL、SQL、Shell 或 JSON Patch 作为逃生口。

## 6. 状态机

### 6.1 ProductWorkSession

权威状态：`ACTIVE / BLOCKED / COMPLETED / ARCHIVED`

```text
ACTIVE -> BLOCKED -> ACTIVE
ACTIVE -> COMPLETED -> ACTIVE
ACTIVE | BLOCKED | COMPLETED -> ARCHIVED
ARCHIVED -> ACTIVE 仅通过显式 RESUME，并先校验当前需求访问权和版本
```

进入 BLOCKED 的确定条件包括：需求版本失配、基线失效、Bridge 无兼容能力、材料传输授权过期、活动回合 UNKNOWN 或目标服务结果未知。失败不得自动改为 COMPLETED。

### 6.2 ProductWorkTurn

权威状态：

`RECEIVED / QUEUED / RUNNING / WAITING_INPUT / PROPOSING / COMPLETED / FAILED / CANCELLING / CANCELLED / UNKNOWN`

```text
RECEIVED -> QUEUED -> RUNNING
RUNNING -> WAITING_INPUT -> QUEUED
RUNNING -> PROPOSING -> COMPLETED
RUNNING -> COMPLETED | FAILED | CANCELLING | UNKNOWN
QUEUED | WAITING_INPUT -> CANCELLING
CANCELLING -> CANCELLED | UNKNOWN
UNKNOWN -> RUNNING | COMPLETED | FAILED | CANCELLED | UNKNOWN 仅限只读核验结果
```

`WAITING_CONFIRMATION` 不属于 WorkTurn；回合可以完成并留下 PENDING_CONFIRMATION 的 proposal。`VERIFYING`、`DISPATCHING` 和 `OFFLINE` 是由命令、Bridge 和事件组合出来的 UI 状态，不重复持久化到 session。

### 6.3 ActionProposal

权威状态：

`DRAFT / PENDING_CONFIRMATION / CONFIRMED / APPLYING / APPLIED / REJECTED / EXPIRED / STALE / FAILED / UNKNOWN`

```text
DRAFT -> PENDING_CONFIRMATION
PENDING_CONFIRMATION -> CONFIRMED | REJECTED | EXPIRED | STALE
CONFIRMED -> APPLYING
APPLYING -> APPLIED | FAILED | STALE | UNKNOWN
UNKNOWN -> APPLIED | FAILED | STALE | UNKNOWN 仅限幂等读回
```

约束：

- CONFIRM 必须携带 proposal `If-Match`、`Idempotency-Key` 和当前展示的 `scopeHash`。
- 确认时目标版本已变则直接 STALE，不进入 APPLYING。
- CONFIRMED 仅代表用户同意当前建议，不代表 AgentApproval、门禁、验收或外部授权通过。
- APPLYING 调用目标应用服务时使用派生幂等键 `proposal:{proposalId}:apply:v1`。
- 崩溃发生在目标写入后、proposal 标记前时进入 UNKNOWN；协调器用目标服务的提交查询或目标版本读回收敛，禁止盲重试。

## 7. 主流程与事务边界

### 7.1 创建或恢复会话

1. 鉴权 `VIEW_WORK_SESSION/CREATE_WORK_SESSION`。
2. 读取 Requirement、assignment、当前基线和已存在的 ACTIVE/BLOCKED 会话。
3. 同一用户、需求和控制端已有未归档会话时返回该会话，不重复创建。
4. 新建时在一个事务内写 session、首个 session event、Timeline、Outbox、Audit 和 idempotency record。
5. 返回 ETag 和 `lastSequence`；页面再订阅 SSE。

### 7.2 提交用户意图

1. 校验 session ETag、ACTIVE/BLOCKED 恢复条件、消息长度和 context binding 数量。
2. 服务端重新读取每个 context target；版本或权限不一致则拒绝或标为 stale。
3. 对将传给 Codex/Skill 的每一项材料执行 `TRANSMIT_MATERIAL` 授权检查。
4. 事务内创建 turn、不可变 context bindings、`START_PRODUCT_WORK_TURN` command、事件、审计和幂等记录。
5. 返回 `202` 和 QUEUED；Bridge 只能租用兼容能力的命令。

零传输授权时仍可创建/恢复会话和查看结构化事实，但不得排队 AI 回合，也不得退回模拟回复。

### 7.3 生成和确认建议

1. Bridge 回送经过协议校验的文本项和类型化 proposal candidate。
2. 服务端限制正文、字段、数组和 JSON 深度；未知 kind 拒绝入库。
3. proposal domain 根据当前目标快照生成 `scopeHash` 和字段 Diff，进入 PENDING_CONFIRMATION。
4. 用户在 UI 查看完整对象、版本、变更和影响后确认或拒绝。
5. 确认事务只改变 proposal 并发出待应用 Outbox；不直接修改其他模块表。
6. `ActionProposalCoordinator` 领取 CONFIRMED proposal，调用对应应用服务。目标服务重新鉴权并写自己的事务。
7. 协调器按幂等读回把 proposal 收敛为 APPLIED、STALE、FAILED 或 UNKNOWN，并关联结果对象。

### 7.4 受控执行

`CREATE_AGENT_RUN` 建议确认后只能调用现有 AgentRun 创建 API 语义。READ_ONLY 作业进入队列；WORKSPACE_WRITE 作业仍先创建 `RUN_START` Approval。任何对话文案、proposal confirmation 或产品负责人身份都不能绕过 Approval、RunScope、胶囊、网络关闭和 Bridge 校验。

## 8. HTTP Contract 候选

所有写接口继续使用 Cookie session、CSRF、`Idempotency-Key`；更新接口同时要求 `If-Match`。错误继续使用统一 `ApiErrorResponse`，并新增必要的显式错误码。

| Method / Route                                        | 用途                           | 关键约束                                                                      |
| ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `GET /api/v1/requirements/:id/work-sessions`          | 列出当前用户可恢复会话         | cursor 分页，默认 20，最大 100                                                |
| `POST /api/v1/requirements/:id/work-sessions`         | 创建或返回现有会话             | body 允许已选 `teamId`、`controlSurface: WEB` 和可选标题；teamId 必须重新鉴权 |
| `GET /api/v1/work-sessions/:sessionId`                | 获取恢复快照                   | 返回 ETag、lastSequence、权威需求摘要、分页首屏                               |
| `GET /api/v1/work-sessions/:sessionId/turns`          | 分页读取历史回合               | cursor 分页，默认 50，正文按访问权返回                                        |
| `POST /api/v1/work-sessions/:sessionId/turns`         | 提交用户意图并排队真实 AI 回合 | 1-8000 字，最多 50 个 contextBindingId，返回 202                              |
| `POST /api/v1/work-turns/:turnId/controls`            | `CANCEL/VERIFY`                | UNKNOWN 只允许 VERIFY，不直接重试                                             |
| `POST /api/v1/action-proposals/:proposalId/decisions` | `CONFIRM/REJECT`               | ETag、scopeHash、reasonCode，目标服务再次鉴权                                 |
| `POST /api/v1/work-sessions/:sessionId/controls`      | `COMPLETE/ARCHIVE/RESUME`      | 有活动回合或未决建议时不能静默归档                                            |
| `GET /api/v1/work-sessions/:sessionId/events?after=N` | SSE 初始回放和持续事件         | Cookie 鉴权、Last-Event-ID、heartbeat、gap 恢复                               |

### 8.1 核心 DTO

- `ProductWorkSessionDto`：id、requirementId、opened/current version、baselineId、status、controlSurface、activeTurnId、lastSequence、rowVersion、owner、timestamps。
- `ProductWorkSessionSnapshotDto`：session、requirement summary、context summaries、turn page、pending proposal、linked runs、recovery action。
- `CreateProductWorkSessionRequest`：可提名 current teamId、controlSurface 和标题；不接受客户端注入 actor、stage、baseline、owner 或 sensitivity。
- `CreateProductWorkTurnRequest`：intentKind、message、contextBindingIds、optional skill release；不接受客户端注入 actor、team、stage、sensitivity 或 prompt template。
- `ProductWorkTurnDto`：状态、可见输入、AI 答复、Skill/模型/Bridge 引用、external thread/turn IDs、failure/recovery、timestamps；不含隐藏 reasoning。
- `ActionProposalDto`：kind、typed change set、display diff、target version、scope hash、confirmation requirement、status、result reference 和 rowVersion。
- 所有 DTO 增加独立 schema version；未知版本 fail closed。

### 8.2 新错误码候选

`WORK_SESSION_BLOCKED / CONTEXT_STALE / TRANSMISSION_AUTH_REQUIRED / PROPOSAL_STALE / PROPOSAL_SCOPE_MISMATCH / WORK_TURN_ALREADY_ACTIVE / BRIDGE_CAPABILITY_UNAVAILABLE / EVENT_GAP_REQUIRES_RELOAD`

错误响应必须提供确定恢复动作，例如 `RELOAD_CURRENT`、`REQUEST_TRANSMISSION_AUTHORIZATION`、`VERIFY_TURN` 或 `RETURN_TO_STRUCTURED_WORKFLOW`，不能只返回“操作失败”。

## 9. Bridge、Skill 与事件协议

### 9.1 Bridge 能力

- 现有 `pfc-bridge/1` envelope 和 AgentRun 命令保持兼容。
- Bridge capability snapshot 新增 `productWorkTurn: AVAILABLE/UNAVAILABLE/UNVERIFIED`。
- 为兼容旧 Bridge，产品回合使用独立租约 endpoint 和 `product-work-turn-command/1` payload；服务端不会把新命令租给未声明能力的 Bridge。
- 新命令：`START_PRODUCT_WORK_TURN / INTERRUPT_PRODUCT_WORK_TURN / VERIFY_PRODUCT_WORK_TURN`。
- 命令持久化 payload 只含 session/turn/context IDs、版本和哈希；正文由已认证 Bridge 在租约内按需读取，不进入命令日志。
- App Server external thread/turn ID 只用于协同和核验，平台数据库仍是恢复依据。

### 9.2 Skill 和 MCP

- 每个 AI 回合必须绑定一个已启用、评估通过的 `SkillRelease`；无明确 Skill 时服务端返回不可用，不退回游离系统提示词。
- AI-UX-R1 允许 Skill 读取已授权平台上下文并输出文本/类型化建议，工具默认关闭。
- MCP/tool 请求在首版不直接执行：只读查询需有已注册能力和审计；写入请求转换为 ActionProposal 或 AgentRun。
- `UNIT-PFC-02-05/03-06` 的追踪和 MCP 证据在 M2-R3 接入本工作空间，不建立另一套页面。

### 9.3 Session SSE 事件

事件候选：

`SESSION_CREATED / SESSION_BLOCKED / SESSION_RESUMED / SESSION_COMPLETED / SESSION_ARCHIVED / TURN_RECEIVED / TURN_QUEUED / TURN_STARTED / TURN_WAITING_INPUT / TURN_MESSAGE_AVAILABLE / TURN_PROPOSAL_AVAILABLE / TURN_CANCEL_REQUESTED / TURN_CANCELLED / TURN_FAILED / TURN_UNKNOWN / PROPOSAL_DECIDED / PROPOSAL_APPLYING / PROPOSAL_APPLIED / PROPOSAL_STALE / PROPOSAL_FAILED / PROPOSAL_UNKNOWN / CONTEXT_INVALIDATED / AGENT_RUN_LINKED`

每个事件包含 `eventId/sessionId/sequence/type/aggregateRef/schemaVersion/occurredAt/receivedAt/safeSummary`。`safeSummary` 继续执行现有敏感字段和标量限制，不含消息正文、答案、prompt、凭据或原始工具输出。

### 9.4 断线恢复

- session 内 sequence 严格递增并有唯一约束；同一 source event 按 source/turn/event id 去重。
- SSE 连接先鉴权并回放 `after`/`Last-Event-ID` 之后事件，再每 15 秒 heartbeat。
- 回放上限 200。超过窗口或出现 sequence gap 时发送 `RELOAD_REQUIRED`，客户端重新 GET snapshot，不自行拼接状态。
- 页面以 snapshot 的 `lastSequence` 建立下一次订阅；重复事件按 eventId/sequence 忽略。
- Bridge ACK、进程退出或租约过期不能证明结果时，turn/proposal 进入 UNKNOWN，先 VERIFY 再决定恢复。

## 10. PostgreSQL migration 设计

### 10.1 迁移拆分

候选 migration 名称仅用于设计，实施时若序号冲突必须重新编号：

1. `202609070006_create_scoped_action_authorizations.ts`：材料传输授权头和 material-ref 明细。
2. `202609070007_create_product_work_sessions.ts`：session、turn、context binding、proposal、session event 和 turn command。

二者都要求 `202609060005_create_m2_approval_control` 已在目标 schema 完成。不得在应用启动时自动建表；必须先在隔离 `codex_test_*` schema 验证，再取得标准 `pfc` 精确 migration 授权。

### 10.2 表与关键字段

| 表                                          | 关键字段与约束                                                                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoped_action_authorizations`              | id、actor/requirement/action/target/purpose、scope_hash、status、valid_from/until、granted/revoked actor/time、row_version；默认拒绝、期限有效、哈希格式检查                                                                     |
| `scoped_action_authorization_material_refs` | authorization_id + material_ref_id 复合主键和 FK；禁止空授权范围                                                                                                                                                                 |
| `product_work_sessions`                     | id、team/requirement FK、opened/current requirement version、opened baseline/stage、status、control_surface、active_turn_id、last_sequence、owner/created_by、row_version、timestamps                                            |
| `product_work_turns`                        | id、session FK、sequence、intent_kind、input_text、visible_response、status、skill_release/bridge refs、external thread/turn ids、usage_summary、failure/recovery、content_retention_until、redacted_at、row_version、timestamps |
| `product_work_context_bindings`             | id、session/turn FK、context_type、target_id/version/hash、binding_role、sensitivity、invalidated_at/reason、created_at；session+turn+type+target+version 唯一                                                                   |
| `product_action_proposals`                  | id、session/turn FK、kind、schema_version、target type/id/version、change_set JSONB、display_diff JSONB、scope_hash、status、confirmation metadata、apply lease/attempt、result ref/version、row_version、timestamps             |
| `product_work_session_events`               | id、session FK、sequence、event_type、aggregate ref、safe_summary JSONB、source_event_id、occurred/received_at；session+sequence 唯一，source 去重                                                                               |
| `product_work_turn_commands`                | id、turn FK、type、payload_summary、status、required_capability、lease owner/until、attempt、idempotency_key、result_summary、timestamps                                                                                         |

### 10.3 索引与并发

- sessions：`(owner_id, requirement_id, updated_at desc)`；部分唯一索引限制同一 owner/requirement/controlSurface 只有一个未归档会话。
- turns：`(session_id, sequence)` 唯一；部分唯一索引限制一个 session 只有一个活动 turn。
- proposals：`(session_id, created_at desc)`；部分唯一索引限制一个 session 只有一个未解决 mutation proposal。
- commands：唯一 `idempotency_key`；待领取按 `(status, required_capability, created_at)` 索引。
- transmission authorization：按 actor、requirement、status、valid_until 查询；scope hash 唯一不能替代逐项 material ref 校验。
- 所有状态更新使用 `row_version = expected` 条件更新；零行更新返回 VERSION_CONFLICT。

### 10.4 JSONB 和正文限制

- `change_set` 只接受 proposalKind 对应的 discriminated schema，最大 64 KiB、最大深度 8、数组最多 100 项。
- `display_diff` 是服务端从 change_set 和当前对象生成的可视投影，不接受模型直接声明为权威 Diff。
- user message 最大 8000 字符，可见 AI 答复最大 32000 字符；超限输出作为受控 ArtifactVersion 候选，不截断后冒充完整结果。
- 数据库只校验 JSON object 和基础约束；完整类型、字段白名单和内容限制在 contract/domain 双层校验。

### 10.5 保留与清理

- session header、proposal 元数据、结果引用、Audit 和权威业务对象按需求生命周期保留。
- 用户消息和 AI 可见答复在会话归档后默认保留 30 天；之后清空正文、写 `redacted_at`，保留哈希、类型和追踪引用。
- session events 和操作日志默认至少保留 30 天；确认形成的 Decision、ArtifactVersion 和 Evidence 按其对象策略保留。
- 不保存隐藏推理。清理任务必须幂等、可审计、按批次执行并报告 deleted/redacted count；未实现清理任务前不能声称保留策略已落地。
- migration 回滚只允许关闭入口和前向修复。表中已有事实后禁止 drop/cascade 回滚。

## 11. 模块和代码所有权

| 位置                                                           | 责任                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/contracts/src/work-sessions.ts`                      | DTO、状态、proposal discriminated union、事件和错误 contract |
| `packages/domain/src/product-work-session.ts`                  | session/turn/proposal 状态机、版本与 scopeHash 不变量        |
| `packages/persistence/src/work-session-repository.ts`          | work-session 自有表、事务、租约、SSE 事件和 read model       |
| `packages/persistence/src/scoped-authorization-repository.ts`  | 传输授权及 material refs 读写                                |
| `apps/server/src/work-sessions/routes.ts`                      | HTTP/SSE schema、header、cursor 和响应边界                   |
| `apps/server/src/work-sessions/application-service.ts`         | 会话/回合用例和授权编排                                      |
| `apps/server/src/work-sessions/action-proposal-coordinator.ts` | 领取建议并调用目标应用服务，负责 UNKNOWN 读回                |
| `packages/protocol/src/product-work-turn.ts`                   | Bridge command/event schema 与能力版本                       |
| `apps/bridge/src/product-work-turn-worker.ts`                  | Codex thread/turn、流式事件、取消和核验                      |
| `apps/web/src/work-sessions/`                                  | 独立路由页面、API client、query/state mapping 和业务布局     |
| `packages/ui`                                                  | D0 共享 token、shell、cards、diff、progress、recovery 组件   |

架构约束：

- `App.tsx` 只注册 `/requirements/:requirementId/work` 路由，不持有会话业务逻辑。
- work-session repository 不得引用其他模块表的 update/insert 类型；proposal 应用只能依赖端口。
- target adapters 位于 server composition 层，分别调用现有 Requirement/Question/Artifact/AgentRun application service。
- 共享 UI 不导入 contracts/domain，不发网络请求，不保存业务状态。
- 新增架构测试阻止 work-session 页面回流到 `RequirementWorkbenchApp.tsx`、阻止 server service 越权直写别的表。

## 12. 权限、安全与隐私

### 12.1 新动作候选

`VIEW_WORK_SESSION / CREATE_WORK_SESSION / SUBMIT_WORK_TURN / DECIDE_ACTION_PROPOSAL / CONTROL_WORK_SESSION / GRANT_MATERIAL_TRANSMISSION`

角色初始映射：

- PRODUCT_MANAGER：本需求的 view/create/submit/decide/control。
- PRODUCT_OWNER：同上，并可在准确材料范围内 grant transmission。
- BUSINESS_OWNER：view/submit；确认业务建议时仍由目标 Question/Decision 规则判定。
- ENGINEERING_OWNER：view/create/submit/decide/control；文件执行仍走 AgentApproval。
- TEST_OWNER、RELEASE_OWNER：view；其他动作由目标业务权限决定。
- TEAM_ADMIN：团队范围 view/control/grant，但不能因此自批其发起的高风险 AgentRun。

proposal 的确认权限只是第一道检查；应用时目标服务必须再次以确认人 actor 校验 `COMPLETE_G0_REGISTRATION`、`ANSWER_QUESTION`、`CONFIRM_QUESTION`、`REGISTER_ARTIFACT`、`APPEND_ARTIFACT_VERSION` 或 `RUN_AGENT(_WRITE)`。

### 12.2 材料传输

- Bridge 是传输通道，最终目标按 `APPROVED_AI` 或 `APPROVED_SKILL` 审计；不得笼统授权“发给 AI”。
- 授权界面必须展示 actor、requirement、material refs、sensitivity、target、purpose、有效期和授权人。
- INTERNAL/PUBLIC 也要求 target 已批准；RESTRICTED 额外要求 actor+requirement+purpose+materials 的有效 scoped authorization。
- 首版 transmission grant 最长 30 分钟，默认一次会话；过期或材料版本变化立即阻断下一回合。
- 授权不包含文件写、Shell、网络、Git、外部系统或发布动作。

### 12.3 内容和提示注入防护

- 材料以带 source/type/version/sensitivity 的引用块输入模型，明确其为不可信数据，不把材料中的指令提升为系统指令。
- 服务端拥有固定系统策略和 proposal schema；模型不能改写角色、权限、目标服务或授权范围。
- Markdown 按无 HTML 白名单渲染；链接显示目标并阻止脚本协议；代码块纯展示。
- event/audit/log 先执行现有敏感字段检查，再做 token、Cookie、authorization、password、database URL、Windows user path 和 workspace absolute path 脱敏。
- 频率限制候选：每 actor 每分钟 10 个回合、每 session 1 个活动回合、每 team 3 个并发 AI 回合；超限返回 429 和可见恢复时间。
- 模型超时 120 秒；SSE 心跳 15 秒；Bridge 命令租约 30 秒、最多 3 次只读派发。结果不明时停止自动重派。

### 12.4 容量、性能与成本

- 单回合最多 50 个 binding，服务端组装后的可传输上下文上限 256 KiB；超限时返回需要用户缩小范围的明确错误，不静默截断来源。
- `usageSummary` 只记录提供方实际返回的 input/output/cache token 和耗时；拿不到的字段保存 UNKNOWN，不按字符数伪造 token 或费用。
- UI 显示排队、首事件、总耗时和上下文规模；治理视图按 team 汇总完成率、UNKNOWN、授权拒绝和可获得的 token 用量。
- 初始并发、超时和上下文上限是受控试点值，观察后再调整。未在真实负载下测量前不得宣称容量或成本目标已达成。

## 13. 前端投影与交互责任

AI-UX-R1 只实现 D0 的代表性真实页面 `/requirements/:requirementId/work`：

- `RequirementContextHeader` 和 `LifecycleRail` 始终显示从 Requirement API 读取的阶段、版本、Owner、阻断和下一步。
- `ContextRail` 显示实际绑定且用户有权读取的材料/问题/决策/产物/运行；过期项可见，不静默移除。
- `WorkStream` 由 turn、proposal 和 linked AgentRun 的服务端状态投影内容块；普通文本不能制造成功状态。
- `ArtifactCanvas` 使用目标对象 DTO 和服务端生成 Diff；确认后重新读取目标对象和 ETag。
- `EvidenceBar` 显示 Skill release、Bridge capability、runId、Git baseline、approval 和 evidence。不存在的 MCP/Zed 能力明确显示不可用，不使用演示标签。
- URL 保存 `session`、焦点对象和必要筛选；刷新先 GET snapshot 再 SSE，禁止只靠内存恢复。
- 视觉 token 和组件必须先进入 `packages/ui` 与 `/ui-kit`，再被业务页面组合；业务页面不新增局部字体、色值、圆角、阴影、字号、行高或 motion duration。

1280、1440、1920 的折叠规则、键盘顺序、hover/focus/loading/empty/error/offline/reduced-motion 状态沿用已确认 D0；自动化通过后仍需产品负责人做并排视觉和代表任务验收。

## 14. 测试数据设计

本迭代包含 CRUD、状态、权限、版本、并发、恢复和负向场景，触发确定性 factory 要求。

### 14.1 Factory

- 模块：`packages/test-data/src/ai-work-session-factory.ts`。
- runId：测试进程生成，所有业务 ID 以 `CODEx_TEST_AIUX_{runId}_` 开头。
- schema：`codex_test_aiux_{normalizedRunId}`，只允许隔离本地 PostgreSQL。
- factory 创建团队、7 类角色账号、需求/assignment、材料/基线、问题/决策、产物、工作区、SkillRelease、Bridge capability 和精确传输授权。
- factory 返回 `createdIds`、expected versions、authorization scopes 和 cleanup handle；afterAll 读回 schema 不存在。
- 使用完全合成中文业务内容，不含客户、员工、真实仓库路径、凭据或生产数据。

### 14.2 数据场景

| ID             | 场景与风险    | 数据与预期                                                                 |
| -------------- | ------------- | -------------------------------------------------------------------------- |
| `AIUX-DATA-01` | happy path    | INTERNAL 材料、有效 Skill/Bridge/授权；回合完成并产生 G0 proposal          |
| `AIUX-DATA-02` | 基线变更      | 回合排队后 Requirement rowVersion/baseline 更新；命令不启动，context stale |
| `AIUX-DATA-03` | 权限拒绝      | 非团队用户、只读角色、RESTRICTED 无 scoped grant；零命令、零传输           |
| `AIUX-DATA-04` | 建议决定      | confirm/reject/expire/stale；只有 confirm 且目标版本一致才可 apply         |
| `AIUX-DATA-05` | 并发确认      | 两 actor 同时确认同一 proposal；仅一个版本更新，另一方 409                 |
| `AIUX-DATA-06` | 跨会话冲突    | 两会话建议同一 Requirement 版本；首个应用，第二个 STALE                    |
| `AIUX-DATA-07` | SSE 恢复      | 重复事件、断线、sequence gap、超 200 回放；最终 snapshot 一致              |
| `AIUX-DATA-08` | AgentRun 关联 | READ_ONLY 排队；WRITE 只进入 WAITING_APPROVAL，未授权零启动命令            |
| `AIUX-DATA-09` | 敏感内容      | prompt injection、HTML、token/path/URL；渲染转义，日志和事件脱敏           |
| `AIUX-DATA-10` | UNKNOWN       | 目标写成功后协调器中断；读回收敛 APPLIED，不重复业务写                     |
| `AIUX-DATA-11` | 保留清理      | 归档超过 30 天；正文脱敏，proposal/result/audit 引用保留                   |
| `AIUX-DATA-12` | 容量边界      | 最大输入、context 数、并发和分页；超限可预测拒绝，无资源失控               |

## 15. 验证与验收方案

### 15.1 TDD 顺序

1. Contract/domain：先写状态转移、typed proposal、scopeHash 和错误码失败测试。
2. Migration/repository：先写隔离 schema、约束、事务、幂等、租约和清理失败测试。
3. API/authorization：先写 header、CSRF、角色、传输授权、目标服务二次鉴权和 409/503 测试。
4. Bridge/protocol：先写能力协商、未知命令、断线、重复事件、取消和 UNKNOWN 测试。
5. UI：先写页面结构、状态投影、URL 恢复、Diff 确认和无假能力测试。
6. E2E：真实本地 PostgreSQL + 真实 Bridge/Codex，覆盖三宽度、键盘和恢复。

### 15.2 自动化门槛

- Quick：lint、format、types、contract/domain/UI、架构和安全单测。
- Core：006/007 isolated migration、repository、API、SSE、Bridge protocol、build 和 PostgreSQL connectivity。
- Full：真实本地两账号、真实 Codex App Server 回合、AgentRun/Approval 关联、权限/并发/恢复/安全/性能、三宽度浏览器。
- `npm run check:delivery-governance` 与 `npm run check:ui-design` 每级必跑。
- 任何 fixture、unavailable adapter、mock model、dry-run 或 console-only 结果不得记为真实集成或产品验收。

### 15.3 正式产品验收

沿用 D0 第 13 节，并增加：

- 用户输入到服务端 RECEIVED 的本地 p95 不高于 300ms；首个真实 AI 流式反馈目标 p95 不高于 3s，未测不得宣称达标。
- 代表任务中 100% AI 回合可定位 SkillRelease、context bindings、Bridge 和 external thread/turn；100% 应用建议可定位确认人、目标版本和结果对象。
- 权限、版本、过期、取消、UNKNOWN 和 Bridge offline 的负向场景均为 fail closed，重复业务写为 0。
- 产品负责人完成 1280/1440/1920 并排视觉验收和代表任务 1-5；自动截图不能替代该结论。

## 16. 版本、实施顺序与回滚

### 16.1 顺序

| 顺序 | 工作包                                     | 退出条件                                                   |
| ---: | ------------------------------------------ | ---------------------------------------------------------- |
|    0 | M2-R2 标准 migration 和验收收口            | 005 标准库读回、真实双账号链路、专项浏览器与具名结论       |
|    1 | AI-UX-D1 设计确认                          | 本文第 18 节全部有明确结论，仅关闭设计阶段                 |
|    2 | AI-UX-R1-A contracts/domain/security       | 状态机、提案白名单和 transmission authorization 通过 quick |
|    3 | AI-UX-R1-B migrations/repositories/API/SSE | 006/007 仅隔离 schema 通过 core；标准 pfc 尚需单独授权     |
|    4 | AI-UX-R1-C Bridge/Codex integration        | 真实只读回合、取消、恢复和 UNKNOWN 在隔离数据通过          |
|    5 | AI-UX-R1-D UI Kit + 代表页面               | 真实 API/PostgreSQL/Agent 数据，三宽度与人工视觉/任务验收  |
|    6 | M2-R3                                      | 产物 Diff/评审/追踪/MCP 证据接入同一工作空间               |

以上是后续候选执行顺序，不是当前授权。每个涉及标准 schema、真实本地进程或外部副作用的步骤仍按项目规则取得对应授权。

### 16.2 Feature flag 与回滚

- 新入口由 `PFC_AI_WORKSPACE_ENABLED=false` 控制，默认关闭；未完成 migration、Bridge capability 或安全策略时服务端拒绝启用。
- 关闭 flag 后回到现有需求详情和作业运营页；已有会话事实保持只读可审计，不删除。
- contract 和 DB 只做前向兼容修复；UI 回退不得改用 fixture、假回复或内存状态。
- 停止条件：未授权材料被传输、proposal 绕过目标权限、重复业务写、UNKNOWN 被显示为成功、敏感信息进入日志、旧 Bridge 收到不兼容命令或 1280 主流程不可用。

### 16.3 观察与复盘

- 代表页面通过产品验收后，进入不少于 1 个本地工作日且至少 20 个真实本地回合的观察窗口；两项均满足后再给试点结论。
- 关键监控：队列等待、首事件延迟、完成/失败/取消/UNKNOWN、proposal 应用/拒绝/过期/stale、重复写、SSE 重连、Bridge 租约失败、授权拒绝、敏感脱敏命中和可获得的 token 用量。
- 任一未授权传输、重复业务写或错误成功状态立即关闭 feature flag、保留证据并停止试点；性能超限或 Bridge 降级先限制并发，不隐藏状态。
- 复盘记录 lead time、返工次数、失败 gate、缺陷来源、任务完成率、人工纠错次数、规则误报和未完成项；只用于改进平台和规则，不用于个人绩效。

## 17. 交付状态、责任与副作用

| 项目                   | 当前结论                                                   |
| ---------------------- | ---------------------------------------------------------- |
| Parent POD / Milestone | `POD-PFC-001 / M2`                                         |
| CAP/Unit scope         | PFC-01/02/03/04 交互组合；不改变 5 CAP / 26 Unit 成员      |
| implementation         | `NOT_STARTED`（仅设计）                                    |
| integration            | `NOT_STARTED`                                              |
| acceptance             | `BLOCKED`（待实现、真实集成、人工验收和具名责任人）        |
| deferred               | Zed 交接、MCP 证据、CAP-PFC-05 发布/观察/复盘              |
| POD next route         | `POD-PFC-001/M2/R2/standard-local-migration-authorization` |

责任人：

- 产品负责人/当前工程 Owner：陈立。
- 代码评审：`陈立`。
- 测试：`陈立`。
- 安全：`陈立`。

产品、工程、代码评审、测试和安全责任人均已登记为陈立，人员数量或独立性不作为阻断项；各项结论仍按实际证据分别记录。本设计不使用并行 Agent。当前阶段没有启动 dev server、浏览器、Bridge、Codex App Server、watcher 或测试进程；未安装依赖、未改代码、未执行 migration、未写数据库、未做远程 Git、SIT/生产、发布或部署。

## 18. D1 确认记录

产品负责人于 2026-09-07 在当前协作会话明确回复“确认”，以下九项组合结论全部确认：

1. 会话范围：一个 `ProductWorkSession` 只绑定一条 Requirement，允许多会话并发，但同一会话只允许一个活动回合和一个未决写建议。
2. 模型边界：ProductWorkTurn 是真实 Codex 只读处理单元；AgentRun 仍是受控执行单元，二者不互相冒充。
3. 写入边界：ActionProposal 只支持第 5.4 节白名单；确认后由目标应用服务二次鉴权、版本校验和幂等写入。
4. 授权边界：材料传输授权单独持久化，首版最长 30 分钟；proposal 确认不能替代 AgentApproval 或外部动作授权。
5. 状态边界：session、turn、proposal 分别使用第 6 节状态机；UNKNOWN 必须只读核验，不能自动重复副作用。
6. 数据边界：采用 006/007 两个候选 migration；消息/AI 可见答复归档后默认保留 30 天，结构化业务事实和审计按对象策略保留，不保存隐藏推理。
7. 接口边界：采用第 8 节 HTTP/ETag/Idempotency/SSE contract 和独立 Product Work Bridge command endpoint。
8. 版本顺序：R2 收口优先；AI-UX-R1 分 A-D 实施，Zed、MCP 证据和 CAP-PFC-05 按第 16 节后续接入。
9. 验收边界：采用第 14-15 节测试数据、自动化、真实性、三宽度和人工产品验收门槛。

该组合确认关闭 `AI-UX-D1` 设计阶段，并仅授权准备 AI-UX-R1 精确实施授权包；不授权代码、migration 文件、标准数据库、真实 Bridge/Codex、页面、依赖、远程 Git、发布或部署变更。
