# POD-PFC-001 M2-R2 审批、隔离写入、取消与恢复设计

> 状态：`CONFIRMED / LOCAL_IMPLEMENTATION_AUTHORIZED`  
> 日期：2026-09-06  
> 迭代分类：严格系统迭代，涉及用户可见工作流、权限、Codex App Server 协议、Bridge 子进程、PostgreSQL、审计和本地文件写入。  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> CAP / Unit：`CAP-PFC-03 / UNIT-PFC-03-03、UNIT-PFC-03-05`，`CAP-PFC-04 / UNIT-PFC-04-05`；补齐 `UNIT-PFC-03-01/02、UNIT-PFC-04-04`。  
> 权威范围：主 Spec `V0.1/R3`、已确认 M2 总体设计、M2-R1 实施检查点。  
> 当前 POD 下一路线：`POD-PFC-001/M2/R2/write-approval-cancel-implementation`。

> 确认记录：产品负责人于 2026-09-06 明确确认“R2 方案及第 15 节执行授权包”。授权边界以第 15 节为准，不外推到依赖变更、注册源工作区写入、远程 Git、SIT/生产、提交、发布或部署。

## 1. 现状结论

M2-R1 已贯通标准本地 PostgreSQL、Server、Bridge、固定 Skill 和真实 Codex App Server 的只读链路，但当前实现不能直接扩成受控写入：

1. `JsonlAppServerRpc` 对命令和文件审批请求立即返回 `decline`，没有持久化的待审批请求和异步决策通道。
2. Bridge Worker 一次只阻塞处理一个运行，无法在运行等待审批时继续领取取消、审批决策或 Bridge 撤销命令。
3. `agent_run_commands` 只有 `START_READ_ONLY_RUN` 和 `INTERRUPT_RUN`，没有写入启动、审批决议、恢复核验和明确取消终态。
4. `createAgentRun` 明确拒绝 `WORKSPACE_WRITE`；授权动作只有 `RUN_AGENT` 和 `VIEW_AGENT_RUN`，不能区分发起写运行、批准、取消、核验和审计读取。
5. App Server `0.153.4` 的当前生成协议支持 command/file/permissions 三类审批请求、一次或会话级决策，以及 `turn/interrupt`。其中 file/command 响应不能携带自定义缩小范围，permissions 响应才支持返回请求权限的子集。
6. R1 的 `readOnly`/R2 的 `workspaceWrite` 都不是 Windows 上的通用 OS 级读取白名单。R2 只允许合成、非敏感本地材料；客户数据或敏感资料继续阻断。

因此 R2 是协议、状态机、持久化、Bridge 会话控制、权限、审计和 PC UI 的完整纵向迭代，不是给现有页面增加“批准/取消”按钮。

## 2. 目标、非目标与设计假设

### 2.1 目标

- 在每个 AgentRun 独有的隔离写入胶囊中完成真实文件修改，注册源工作区始终不被 Codex 直接写入。
- 将 App Server 发起的审批请求先落 PostgreSQL，再由有权限且与发起人不同的人员作出一次性决定，最后由 Bridge 精确回送原 JSON-RPC request id。
- 支持明确的批准、缩小范围、拒绝、过期、取消和 Bridge 撤销；任何上下文不匹配都 fail closed。
- 取消时先调用 `turn/interrupt`，再在超时后按 Bridge 自有父 PID 停止整棵进程树；未证实终止时保持 `UNKNOWN`。
- Bridge 断线、命令租约过期、事件重放和 ACK 丢失不重复写入，不将不确定结果伪装成成功。
- 在作业详情、审批箱和审计页中展示真实 PostgreSQL 数据，并沿用已确认的 PFC UI 模板。

### 2.2 非目标

- 不把胶囊内修改自动应用到注册源工作区，不执行 commit、push、merge、deploy 或远程环境写入。
- 不开放公网、任意网络、任意 Shell、`dangerFullAccess`、会话级永久批准或用户自定义命令文本。
- 不使用 fixture、`pfc_experience` 或内存状态作为产品事实或验收证据。
- 不接入客户数据、受限敏感材料、真实外部 MCP 写操作或完整 Web/Zed 控制权交接。
- 不在 R2 完成 ArtifactVersion Diff 评审、双向追踪和 MCP 证据归档；这些属于 M2-R3。

### 2.3 假设与待验证项

- 固定使用已登记且哈希匹配的 Codex App Server `0.153.4` 生成协议；版本变化立即阻断。
- `item/permissions/requestApproval` 是否会在本机真实 Windows `workspaceWrite` 流程触发，必须在实现前用隔离胶囊 Spike 验证；未触发时不能伪造协议证据。
- 现有本地用户不足以证明双人审批，R2 验收数据需建立两个 `CODEx_TEST_` 账号，分别扮演发起者和审批者。
- 新增数据库结构只通过显式 migration；应用启动不隐式改表。

## 3. 方案比较与选择

| 方案                | 做法                                                                                                              | 优点                                                            | 代价/风险                                                 | 结论     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| A. 每运行隔离胶囊   | 从固定 Git baseline 和授权相对路径物化一个 `CODEx_TEST_` 胶囊；Codex 仅写胶囊；平台保存 manifest、diff 摘要和审计 | 不污染用户工作区；可清理、可复核；取消和 UNKNOWN 的影响边界明确 | 需要胶囊管理、会话控制和额外校验                          | **采用** |
| B. 直接写注册工作区 | 批准后让 Codex 在现有 checkout 修改                                                                               | 实现最短                                                        | 会覆盖用户 WIP；基线漂移、回滚和重复副作用难证明          | 拒绝     |
| C. 只生成补丁文本   | 保持只读，让模型输出 patch                                                                                        | 无本地文件写副作用                                              | 没有验证真实 workspace-write、审批回调和取消；不满足 Unit | 拒绝     |

选择 A。R2 的“写入成功”只表示隔离胶囊内的受控修改成功并可读回，不表示用户源工作区、Git 历史或任何外部系统已被改变。

## 4. 端到端流程与不变量

### 4.1 创建和启动

1. Browser 只提交 `requirementId`、`operation=CONTROLLED_ARTIFACT_EDIT`、`workspaceId`、`skillReleaseId`、目标 ArtifactVersion、授权相对路径集合和预期动作，不提交绝对路径、Git baseline 或任意 prompt。
2. Server 从 PostgreSQL 读取当前 requirement baseline、ArtifactVersion、敏感级别、workspace 绑定、Bridge capability 和固定 SkillRelease；校验 `RUN_AGENT_WRITE` 权限和非敏感数据策略。
3. Server 生成不可变 RunScope，包含需求/产物/Skill/Git baseline、规范化相对路径、动作种类、影响上限、有效期和 scope hash；创建 `WORKSPACE_WRITE` AgentRun 和 `START_WORKSPACE_WRITE_RUN` 命令。
4. Bridge 领取命令后重新核验版本、哈希、baseline、能力和路径，物化只包含授权文件的运行胶囊。胶囊目录位于 gitignored `.local/run-capsules/CODEx_TEST_<runId>`，不能是注册源工作区、其父目录或符号链接逃逸目标。
5. App Server 的 cwd 和唯一 writable root 都指向胶囊；使用 `workspaceWrite`、`networkAccess=false`、`excludeTmpdirEnvVar=true`、`excludeSlashTmp=true`。不调用 unsandboxed `process/spawn` 或 `thread/shellCommand`。
6. 运行开始后记录 execution instance、threadId、turnId 和事件序号。胶囊内每次结果只通过 manifest/hash/diff 读回，不信任 Agent 文本自报。

### 4.2 审批

App Server 的 server-initiated request 由 adapter 转成受版本约束的内部对象。Bridge 在等待决定期间保留原 RPC request，不自动接受：

- `item/commandExecution/requestApproval`：保存 kind、threadId、turnId、itemId、approvalId、cwd、结构化 command actions、附加文件/网络权限和可用决策。命令只能匹配平台动作目录，不执行浏览器传入的任意字符串；网络请求始终拒绝。
- `item/fileChange/requestApproval`：保存 threadId、turnId、itemId、reason 和 grantRoot。只有请求范围等于或小于 RunScope 且 canonical realpath 留在胶囊内时，才允许一次性 `accept`。
- `item/permissions/requestApproval`：保存 requested fileSystem/network profile。审批者可返回 requested profile 的严格子集，scope 固定为 `turn`，`strictAutoReview=true`；network grants 永远为空。
- 旧版 `applyPatchApproval`/`execCommandApproval` 和其他未设计 request 一律返回协议级拒绝并记录原因，不静默放行。

状态流为 `RUNNING -> WAITING_APPROVAL -> RUNNING`。每个请求先持久化并产生事件，Browser 决策成功落库后才生成 `RESOLVE_APPROVAL` 控制命令。Bridge 必须用 `(runId, executionInstanceId, appServerRequestId, threadId, turnId, itemId, approvalId?)` 全量匹配，才能回送决定。

一次性批准只响应 `accept`；R2 不暴露 `acceptForSession`、execpolicy/network policy amendment。审批有效期建议 10 分钟，过期自动决定 `decline`，运行继续或由 Agent 自行失败，平台不补发批准。

“缩小范围”按协议能力区分：permissions request 原位批准请求子集；file/command request 不能携带子集，选择缩小时取消当前请求并结束该运行，再以新的更小 RunScope 创建子运行，不伪装成原请求已被部分批准。

### 4.3 取消

- Browser 调用幂等控制 API，Server 校验 `CANCEL_AGENT_RUN`、rowVersion、当前状态和 RunScope，记录取消请求并置为 `CANCELLING`。
- `QUEUED/RETRY_QUEUED` 且没有 execution-start 证据时，Server 原子取消待执行命令并直接进入 `CANCELLED`。
- `STARTING/RUNNING/WAITING_APPROVAL/VERIFYING` 时生成高优先级 `INTERRUPT_RUN`。Bridge 的主控制循环不被运行会话阻塞，可将命令路由到对应 session controller。
- session controller 先用已记录 threadId/turnId 调用 `turn/interrupt`，等待 `turn/completed(status=interrupted)`；等待审批时先以 `cancel` 回送原 approval request，再 interrupt。
- 5 秒内没有受信终态时，仅对该 session 自有 App Server 父 PID 执行进程树终止；15 秒内仍不能证明父子进程均退出，则运行进入 `UNKNOWN`，不得写成 `CANCELLED`。
- `CANCELLED` 的证据必须同时包含取消请求、interrupt/终止结果、进程退出读回和胶囊最终 manifest。

### 4.4 断线、恢复和重试

- Bridge 每个运行维护独立 session controller；主轮询器最多同时持有 3 个活动 session，并始终可领取审批/取消/撤销控制命令。
- 写运行一旦出现 execution-start 证据，租约过期或 ACK 丢失后绝不自动重新领取 `START_WORKSPACE_WRITE_RUN`。Server 将其置为 `UNKNOWN`。
- `VERIFY_AGENT_RUN` 只执行只读核验：读取已有胶囊 manifest、进程存活、事件序号和 App Server thread 状态，不重放写动作。可证明未执行则 `FAILED/NOT_STARTED`；可证明已结束则归档实际结果；仍不能证明则保留 `UNKNOWN`。
- 需要重试时创建新的 child run、execution instance 和胶囊，`parentRunId` 指向原运行；不复用原命令、approval 或胶囊。
- 事件保持 at-least-once 传输，以 source event id 去重；审批和控制命令以 request hash + idempotency key 去重。平台不宣称 exactly-once。

### 4.5 Bridge 撤销

TEAM_ADMIN 撤销 Bridge 后，Server 原子写入 `REVOKED` 和审计，停止新命令领取；所有未开始运行进入 `FAILED/BRIDGE_REVOKED_BEFORE_START`，已开始运行进入 `CANCELLING`。无法联系 Bridge 或无法证明进程退出的运行进入 `UNKNOWN`。撤销不删除证据和凭据摘要。

## 5. 状态、结果和协议模型

### 5.1 状态与结果分离

AgentRun `status` 表示运输/生命周期状态；新增 `resultOutcome` 表示业务结果：`PASS | WARN | BLOCKED | UNKNOWN | null`。禁止再用 `SUCCEEDED` 表达业务 PASS：

- transport `SUCCEEDED` + outcome `PASS/WARN`：链路完成，业务结论可读回。
- transport `FAILED` + outcome `BLOCKED`：Agent 正常给出阻断结论，不是协议故障。
- transport `UNKNOWN` + outcome `UNKNOWN`：副作用或终态不可证实。

### 5.2 Bridge command

新增受版本约束的 discriminated union：

- `START_WORKSPACE_WRITE_RUN`
- `RESOLVE_APPROVAL`
- `INTERRUPT_RUN`
- `VERIFY_RUN_STATE`

每类 payload 独立解析，不共享宽泛对象。控制命令优先于新运行命令。命令状态扩展为 `PENDING | LEASED | ACKNOWLEDGED | CANCELLED | EXPIRED | UNKNOWN | FAILED`。

### 5.3 Adapter/RPC 边界

- `AppServerRpc` 增加 `onRequest` 和一次性 `respond(requestId, result|error)`；每个 request id 只能解决一次，关闭时所有未解决请求返回 `cancel/decline`。
- `CodexAppServerAdapter` 拆为 `ReadonlyRunSession`、`WorkspaceWriteRunSession`、`ApprovalRequestNormalizer` 和 `TurnController`，避免继续扩大单文件职责。
- `WorkspaceWriteRunSession` 暴露 `interrupt()`、`resolveApproval()`、`inspect()` 和 `close()`；只有 Bridge session controller 可以调用。
- server-initiated request、response 和 notification 均受固定生成类型约束，未知字段只保留安全摘要，不原样上传。

## 6. PostgreSQL 设计

新增 migration `202609060005_create_m2_approval_control.ts`，只做可前向兼容的新增/约束演进，不在启动时运行：

| 对象                 | 关键字段/变化                                                                                                                                      | 不变量                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `agent_runs`         | `execution_instance_id`、`result_outcome`、`run_scope`、`run_scope_hash`、`execution_started_at`、`cancel_requested_at`、`terminal_at`             | RunScope 创建后不可变；不存绝对路径或 PID                                    |
| `approval_requests`  | run/execution/request/thread/turn/item/approval identity、kind、requested/approved scope、scope hash、decision、expires/decided/reason、rowVersion | 原 request identity 唯一；批准范围必须是请求和 RunScope 的子集；终态不可反转 |
| `agent_run_commands` | 新 command types、`priority`、`execution_instance_id`，增加 `CANCELLED/EXPIRED`                                                                    | 写启动命令一旦有 execution-start 证据不可重新租赁                            |
| `agent_run_capsules` | run/execution、source baseline、scope hash、before/after manifest hash、diff summary、lifecycle、created/verified/cleaned time                     | 仅保存逻辑引用和 hash，不存用户绝对路径；一个 execution 一个 capsule         |

现有 `audit_events` 继续作为统一审计事实，不重复建设平行审计表。每次 run 创建、审批请求、决策、过期、取消、核验、重试和 Bridge 撤销均与业务事务原子写入审计和 outbox。审计 `scope_summary` 只保存相对路径、动作、数量、hash、影响上限和原因码，不保存凭据、完整命令输出或用户目录。

## 7. 权限与四眼规则

新增动作：`RUN_AGENT_WRITE`、`APPROVE_AGENT_ACTION`、`CANCEL_AGENT_RUN`、`VERIFY_AGENT_RUN`、`VIEW_AGENT_AUDIT`、`REVOKE_BRIDGE`。

| 动作           | 允许角色                                                                | 附加约束                                                            |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 发起隔离写运行 | PRODUCT_MANAGER、PRODUCT_OWNER、ENGINEERING_OWNER、TEAM_ADMIN           | 必须具备需求访问和 workspace WRITE，材料非敏感，RunScope 完整       |
| 批准文件/权限  | PRODUCT_OWNER、ENGINEERING_OWNER、TEAM_ADMIN                            | 审批者不得等于发起者；只能缩小不能扩大；必须在同一 team/requirement |
| 批准命令       | ENGINEERING_OWNER、TEAM_ADMIN                                           | 审批者不得等于发起者；命令必须命中平台动作目录；网络永不批准        |
| 取消运行       | 发起者、PRODUCT_OWNER、ENGINEERING_OWNER、TEAM_ADMIN                    | 仅限同一需求/团队；终态请求幂等返回当前状态                         |
| UNKNOWN 核验   | ENGINEERING_OWNER、TEST_OWNER、TEAM_ADMIN                               | 只读核验，不触发原写动作                                            |
| 查看执行审计   | PRODUCT_OWNER、ENGINEERING_OWNER、TEST_OWNER、RELEASE_OWNER、TEAM_ADMIN | 只读且按团队/需求裁剪                                               |
| 撤销 Bridge    | TEAM_ADMIN                                                              | 必须填写原因，影响范围和活动运行数量先展示再确认                    |

PRODUCT_MANAGER 不能单独批准自己发起的写运行。R2 不设置“紧急自批”后门；本地验收用两个独立合成账号证明四眼规则。

## 8. Server、Bridge 和 Web 模块边界

### 8.1 Server

- `agent-runs` 保留创建、查询、事件和运行总装，不承载审批/控制全部逻辑。
- 新建 `agent-approvals`：审批查询、决策 application service、repository port、routes。
- 新建 `agent-controls`：取消、UNKNOWN 核验、重试和 Bridge 撤销的 application service、repository port、routes。
- 新建 `agent-audit`：按 actor/requirement/run 裁剪的只读查询。
- 所有 mutation 使用 Cookie 身份、CSRF、`Idempotency-Key`、request hash、`If-Match` rowVersion；授权发生在正文/命令/差异读取之前。

Browser API：

- `GET /api/v1/agent-approvals?status=PENDING&mine=true`
- `GET /api/v1/agent-runs/:runId/approvals/:approvalId`
- `POST /api/v1/agent-runs/:runId/approvals/:approvalId/decision`
- `POST /api/v1/agent-runs/:runId/controls`，body 仅允许 `CANCEL | VERIFY_UNKNOWN | RETRY`
- `GET /api/v1/agent-runs/:runId/audit`
- `POST /api/v1/bridges/:bridgeId/revocations`

Bridge API 延续独立凭据。`GET /commands/next` 返回控制命令优先级；Bridge 上报 approval request、胶囊 manifest/diff 摘要和进程终止证据时使用专用受限 endpoint，不能借浏览器 API。

### 8.2 Bridge

- `runtime.ts` 仅组装依赖和生命周期。
- `session-pool.ts` 管理最多 3 个运行会话和控制命令路由。
- `run-capsule.ts` 负责物化、canonical path 校验、manifest/diff 和清理。
- `approval-coordinator.ts` 负责 App Server request 挂起/回送和过期。
- `process-tree.ts` 只终止登记为当前 session 所有的父 PID 树。
- `worker.ts` 拆为 command dispatcher 和只读/写入 handlers，避免一个大文件继续承担所有职责。

### 8.3 Web 与 UI 设计系统

作业二级导航固定为“运行、审批、Bridge、Skills、审计”。页面继续使用已确认的全局导航、密集型工作台和模块色，不另起视觉风格：

- `packages/ui` 先增加共享 `Drawer`、`DecisionFooter`、`ScopeDiff` 和状态展示模式，并在 `/ui-kit` 登记；所需 token 先进入 primitive -> semantic -> component 三层。
- 作业详情右侧增加“授权与控制”InfoPanel；状态为 WAITING_APPROVAL/CANCELLING/UNKNOWN 时显示明确的下一动作和证据，不用营销卡片。
- 审批箱采用列表 + 详情 Drawer。首屏展示动作、相对位置、影响上限、失效时间、发起人和风险；详细区域对比“请求范围/批准范围”，绝对路径、凭据和原始敏感输出不进入 Browser。
- 审计页为可筛选 DataTable，支持 actor、动作、decision、runId、时间筛选；URL 保留 view、筛选和选中记录。
- 取消使用危险按钮和二次确认 Dialog；不输入自由文本命令。过期/已处理审批禁用动作并展示最新决定人和时间。
- 覆盖 loading、empty、error、offline、degraded、waiting approval、stale rowVersion、permission denied、cancelling、cancelled、unknown 和 recovery result。
- 验证 1280/1440/1920，键盘焦点、Escape 关闭、焦点回归、hover、长路径折行和 SSE 断线续传；业务页不得新增 page-local 字体、颜色、字号、圆角、阴影或 motion 值。

## 9. 版本拆分与实施顺序

确认后按串行顺序实施；共享状态机、协议和 migration 尚未稳定，不使用并行 Agent：

1. **R2-T1 协议/领域/数据库**：先写失败测试，再增加 actions、DTO、状态/结果分离、migration 和 repositories。
2. **R2-T2 隔离胶囊和会话控制**：先完成真实本机 approvals Spike；实现 capsule、session pool、进程所有权和新 Bridge command。
3. **R2-T3 审批闭环**：实现 JSONL server request、PostgreSQL approval、Browser decision 和 Bridge response；覆盖拒绝、过期、缩小及重放。
4. **R2-T4 取消/恢复/撤销/审计**：实现 interrupt、进程树停止、UNKNOWN verify、child retry 和 Bridge revoke。
5. **R2-T5 PC UI**：先扩展 `packages/ui` 与 `/ui-kit`，再实现作业详情、审批箱和审计页；不把业务逻辑堆回 `App.tsx` 或 `AgentRunsPage.tsx`。
6. **R2-T6 真实本地集成与验收证据**：隔离 migration/repository、真实 App Server 写入/拒绝/取消/断线试验、浏览器验收和 Full Gate。

每个 T 完成只更新子任务事实，R2-T6 后仍回到 Parent POD；没有具名人工结论时不得将 Unit 写成 `ACCEPTED`。

## 10. 测试数据设计

R2 触发确定性 factory，命名 `createM2R2TestData(runId)`。自动化数据只进入 `codex_test_m2_r2_*` schema 或 `.local/run-capsules/CODEx_TEST_<runId>`；标准 `pfc` 只保留明确授权的本地验收对象。

| 场景               | 风险/要求         | 数据和断言                                                                        | 清理/保留                                |
| ------------------ | ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| 双人批准写入       | 四眼与最小范围    | requester/approver 两账号；胶囊目标文件 hash 改变，源工作区 hash 不变             | 测试 schema/胶囊清理；验收记录可保留摘要 |
| 自批/越权/扩大范围 | 权限旁路          | 同一 actor、非成员、越界路径、过期 rowVersion 均 403/409，零命令写入              | 全清理                                   |
| permissions 缩小   | 协议子集          | granted profile 严格属于 requested 与 RunScope，网络为空、scope=turn              | 全清理                                   |
| command/file 请求  | 任意命令/路径逃逸 | 未命中动作目录、网络、父路径、junction/symlink、绝对路径全部拒绝                  | 全清理                                   |
| 取消               | 残留进程          | QUEUED、RUNNING、WAITING_APPROVAL 分别取消；父子 PID 均退出才 CANCELLED           | 进程与胶囊全清理                         |
| 断线/ACK 丢失      | 重复副作用        | execution-start 后不重租写命令；同一 request/event replay 去重；结果 UNKNOWN      | 保留脱敏证据，临时数据清理               |
| UNKNOWN 核验/重试  | 伪成功            | verify 只读；retry 新 run/execution/capsule；原记录不改写                         | 全清理                                   |
| Bridge 撤销        | 在途执行          | 新命令停止；已开始 run cancel 或 UNKNOWN；审计完整                                | 全清理                                   |
| 1/3/4 并发         | 资源耗尽          | 3 个可运行，第 4 个保持排队；控制命令不被饿死                                     | 全清理                                   |
| 脱敏与上限         | 凭据/日志泄漏     | Bearer、Cookie、token、密码、DB URL、用户路径不入库；事件/命令/差异超限截断或拒绝 | 全清理                                   |

测试报告记录环境、配置来源、数据来源、runId、createdIds、命令、结果、失败证据、清理读回和残余风险。真实 App Server Spike 与自动化 mock 结果分列。

## 11. 质量门禁、验收和退出条件

TDD 顺序：domain/contract -> migration/repository -> adapter/Bridge -> Server API -> UI -> real local integration。

- 每个 T：focused tests + `npm run test:gate:quick`。
- T1/T3/T4：`npm run test:gate:core`，含独立 PostgreSQL migration/repository 读回和测试 schema 清理。
- R2 候选：`npm run test:gate:full`，以及真实 App Server approvals/write/cancel/UNKNOWN smoke。
- UI：`npm run check:ui-design`、`/ui-kit` 读回、1280/1440/1920 截图和键盘/交互证据；自动化通过不替代产品人工视觉验收。

R2 退出条件：

1. 一个业务有效、非客户的 `CODEx_TEST_` 本地需求，经独立 requester/approver 完成隔离胶囊写入；文件、审批、事件、审计和 diff hash 均从标准 `pfc` 读回。
2. 注册源工作区在运行前后 hash 完全一致；路径逃逸、网络、任意命令、会话级批准和未经批准的额外权限稳定拒绝。
3. RUNNING 与 WAITING_APPROVAL 取消后没有残留子进程；不能证明时稳定为 UNKNOWN。
4. 断线/重放不产生重复写入；UNKNOWN 核验不重跑原动作，retry 使用新 child run。
5. 3 并发上限、控制优先、Bridge 撤销、脱敏和审计查询通过。
6. R2 所涉 Unit 可更新为 `INTEGRATED`；具名代码评审、测试、安全和产品视觉验收缺失时继续 `ACCEPTANCE_BLOCKED`。

## 12. 性能、保留、进程和观测

- 每个 Bridge 最多 3 个活动 run session；审批/取消/撤销控制命令不计入新运行并发，但使用有界控制队列。
- 默认运行上限 10 分钟、审批 10 分钟、interrupt 优雅等待 5 秒、进程树终止核验 15 秒；全部配置设上下限且不由 Browser 覆盖。
- 每个运行事件队列继续上限 100；approval、command、diff 和 event payload 分别设大小限制，超限 fail closed。
- 本地原始运行日志不上传；运行/审批/命令/审计元数据按总体设计保留 30 天。测试胶囊在证据读回后立即清理；人工验收胶囊默认保留 24 小时再由受控清理任务删除，保留摘要/hash。
- 观察指标：审批等待 P95、过期数、拒绝数、UNKNOWN 数、重放去重数、取消耗时、残留进程、活动 session、控制队列深度、事件可见延迟、胶囊磁盘占用和单次运行用量。
- 本轮当前保留的 PostgreSQL/API/Web/Bridge 仅供本地体验。实现重启时按 PID 精确停止并重新报告，不按进程名批量终止。

## 13. 风险、停止条件和回滚

| 风险                 | 控制                                                        | 立即停止条件                                     |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Codex 读取胶囊外内容 | R2 仅合成非敏感数据、最小胶囊、no-network；敏感资料继续禁入 | 发现真实敏感/客户材料或读取越界证据              |
| 写入源工作区         | 胶囊唯一 writable root、canonical path、前后源 hash         | 源工作区任一未授权文件变化                       |
| 审批错配/重放        | 全身份匹配、rowVersion、request hash、一次性 response       | 请求 A 的决定可作用于请求 B，或终态可反转        |
| 取消残留             | interrupt + owned PID tree + 存活读回                       | 进程无法停止却准备写 CANCELLED                   |
| 断线重复副作用       | execution-start 后禁重租、UNKNOWN 只读核验                  | 不能证明是否执行却准备自动重跑                   |
| 权限或凭据泄漏       | 四眼、最小角色、Bridge 独立凭据、入库前脱敏                 | Cookie/credential/绝对敏感路径进入 UI、日志或 DB |
| 资源耗尽             | 3 并发、有界队列、超时、磁盘上限                            | R6016、线程/磁盘异常、控制命令饥饿               |

功能回滚：关闭 `WORKSPACE_WRITE` capability 和 Web 写入入口，Bridge 停止领取写命令；在途运行按取消规则结束或进入 UNKNOWN。数据库 migration 为新增结构，已承载事实后不 drop/cascade，只做前向修复。回滚后保留只读 R1，不允许改用 fixture 冒充 R2。

## 14. 交付状态与后续路线

- 实现状态：`NOT_STARTED`。
- 集成状态：`NOT_STARTED`。
- 验收状态：`NOT_STARTED`；M1 和 M2-R1 的具名验收阻断继续独立存在。
- 发布状态：`NOT_AUTHORIZED`；R2 只产生本地候选，不部署外部环境。
- 延后范围：M2-R3 的 ArtifactVersion 评审/Diff、双向追踪和只读 MCP 证据；M3 的 Zed/Web 交接、PFC-03-04 和 PFC-05。
- 设计确认前 POD 唯一路线保持 `POD-PFC-001/M2/R2/write-approval-cancel-design-confirmation`。
- 设计确认并完成 R2 后，唯一下一路线为 `POD-PFC-001/M2/R3/artifact-review-trace-mcp-design-confirmation`，不能直接宣称 M2 或平台完成。

## 15. 待产品负责人确认的执行授权包

请将“设计确认”和“本地执行授权”视为两个明确结论。本设计建议一次确认以下限定范围，减少中途重复审批：

1. **设计确认**：接受方案 A、四眼审批、R2 不直接写源工作区、网络永不批准、UNKNOWN 不自动重试、R2-T1 至 T6 串行实施及上述退出条件。
2. **本地源码与测试授权**：允许修改本仓库源码/测试/文档，运行项目固定 Node/npm 命令、isolated `codex_test_m2_r2_*` schema、`.local/run-capsules/CODEx_TEST_*` 胶囊和本机 Codex App Server Spike；不新增依赖。
3. **标准本地库与真实链路授权**：在 migration 预检和独立库验证通过后，允许向本机 `pfc_local/pfc` 应用精确 migration `202609060005`，创建两个 `CODEx_TEST_M2_R2_*` 验收账号及相关运行/审批/审计事实，重启现有 loopback API/Web/Bridge，并执行真实隔离写入、拒绝、取消和恢复试验。
4. **保留/清理**：自动化测试 schema、临时进程和测试胶囊完成后清理；标准 `pfc` 中的脱敏验收事实与人工验收胶囊分别保留，胶囊最长 24 小时，清理后保留 hash 和审计。
5. **明确不授权**：Codex 修改注册源工作区、客户/敏感数据、外部网络写入、remote Git、SIT/生产、commit、push、merge、deploy、依赖安装或防火墙变更。

本设计及第 15 节本地执行授权已于 2026-09-06 获得产品负责人明确确认。实施仍须逐项满足预检、隔离、读回、清理和停止条件；未授权范围继续 fail closed。

## 16. 依据

- `docs/implementation/POD-PFC-001-M2-controlled-agent-work-design-20260906.md`
- `docs/implementation/POD-PFC-001-M2-R1-implementation-checkpoint.md`
- `.quality-gate/delivery-plan.json`
- `product-full-chain/.work/reviews/estimation/POD-PFC-001/POD-PFC-001-产品作业全链路管理平台-主Spec_V0.1.md`
- OpenAI Codex App Server：<https://developers.openai.com/codex/app-server/>
- 本仓库固定生成协议：`packages/codex-adapter/src/generated/app-server-0.153.4/`
