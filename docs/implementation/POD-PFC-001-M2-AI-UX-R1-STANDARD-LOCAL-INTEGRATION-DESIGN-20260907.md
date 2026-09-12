# POD-PFC-001 M2 AI-UX-R1 Stage E 标准本地集成设计

> 分类：System Iteration Requirement / strict / 设计阶段  
> 状态：`CONFIRMED_FOR_STAGE_E_SOURCE_AND_ISOLATED_TEST_IMPLEMENTATION`  
> 日期：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 影响 CAP：`CAP-PFC-01/02/03/04`；不改变 5 CAP / 26 Unit 权威集合  
> 当前事实：Stage D 视觉已验收，006/007 已在标准 `pfc_local/pfc` 读回  
> 当前 POD 唯一路线：`POD-PFC-001/M2/AI-UX-R1/standard-local-execution-authorization-package`
> 产品负责人确认：`确认 AI-UX-R1 Stage E 设计及第 13 节实施授权范围`（2026-09-07）

## 1. 本轮决策

采用“服务端就绪投影 + 对话流内显式确认上下文与 Skill + 原有回合提交”的方案，补齐空会话的第一轮真实作业，不增加第二套会话状态，也不通过 fixture、seed 或上一回合数据制造可用状态。

本设计确认后，先完成 source、隔离 PostgreSQL、API 和 UI 实现；标准 `pfc` 业务事实写入、功能开关启用和真实标准首轮验收仍使用后续精确执行授权包。

## 2. 目标、非目标与前提

### 2.1 目标

- 产品经理从一条有权访问的真实需求进入工作台，创建或恢复会话后即可看见当前基线的可用材料和实际兼容 Skill。
- 新会话不依赖历史 turn；首轮选择来自服务端对当前 Requirement、MaterialBaseline、SkillRelease 和 Bridge capability 的同一时点投影。
- 上下文和 Skill 在发送前可见、可核对、可调整；点击发送才执行材料传输授权和不可变 binding 创建。
- 标准首轮走 `Web -> Fastify/SSE -> PostgreSQL -> Bridge -> Codex App Server`，并从标准数据库读回 session、turn、context、command、event 和外部 thread/turn 引用。
- 页面保持 Stage D 已验收的信息架构、字体、配色和密度，只补齐对话流的就绪与恢复状态。

### 2.2 非目标

- 不增加通用聊天、自由 prompt、自动执行、模型自主选权、自动门禁、自动验收或自动发布。
- 不把“推荐”伪装成模型判断；推荐规则必须确定、可解释并可在服务端测试。
- 不直接从 work-session repository 更新 Requirement、Material、Skill、Bridge 或其他模块权威表。
- 不用 seed、演示记录、`pfc_experience`、内存状态或 mock 回复完成标准集成验收。
- 本阶段不实现 Zed 交接、MCP 动态工具、CAP-PFC-05、生产部署或外部系统调用。

### 2.3 已采用前提

- 006/007 已就绪且本设计预计不需要 008 migration；若实现发现必须改 schema，立即停止并重新走设计和迁移授权。
- 一个会话仍绑定一条 Requirement；同一 actor/requirement/WEB 的未归档会话继续幂等恢复。
- 每个回合最多 50 个材料引用、一个 SkillRelease 和一个实际 Bridge；提交时重新鉴权和重新解析，readiness 不是授权凭证。
- 标准业务数据必须来自平台正常业务流程。自动化数据只允许存在于可清理的 `codex_test_*` schema。

## 3. 当前代码事实与根因

- `POST /api/v1/requirements/:id/work-sessions` 已能创建或恢复标准会话，但 session 创建时不生成 context binding，符合“每回合不可变绑定”的既有模型。
- 当前 Web 首轮 `submitTurn` 要求 `latestTurn.skillReleaseId`；空会话没有 latest turn，因此 composer 永远不能提交。
- 当前 Web 把历史 `snapshot.contextItems` 去重后作为下一回合候选；空会话没有 context item，且历史 binding 也不能代表当前基线全部可用来源。
- 当前 `resolveProductWorkCapability` 只验证 SkillRelease ACTIVE/PASSED 和任一 Bridge 的 `productWorkTurn/1` 能力，没有同时验证该 Bridge 最新快照中声明了所选 releaseId 与 contentHash。
- scoped transmission domain/repository 已存在，但没有面向产品工作台的 grant/revoke 应用服务和 HTTP 入口；RESTRICTED 首轮无法通过正常产品交互取得精确授权。

因此问题不在视觉组件，而在首轮就绪 read model、同一 Bridge/Skill 匹配和传输授权入口缺失。

## 4. 方案比较

| 方案                       | 做法                                                                                 | 优点                                             | 风险                                                                    | 结论     |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- | -------- |
| A. 浏览器拼接现有接口      | Web 分别读取 Requirement、Material Library、Skills 和 Bridges 后自行筛选             | 后端改动少                                       | 客户端承担权限和兼容性判断；多次读取竞态；容易把不可用 Skill 显示为可用 | 不采用   |
| B. 服务端 readiness 投影   | work-session 服务返回当前 session 的可选材料、同一快照兼容 Skill、传输状态和恢复动作 | 单一可信判断；仍由提交接口二次校验；适合刷新恢复 | 需要新增 contract、read port 和 UI 状态                                 | **采用** |
| C. create-and-run 原子接口 | 创建会话时直接选择材料、Skill 并启动首轮                                             | 表面步骤最少                                     | 混合持久化会话与 AI 副作用；失败恢复和权限边界不清晰                    | 不采用   |

## 5. 选定交互

### 5.1 首次进入

1. 页面先调用现有 session list；有 `session` URL 参数时优先恢复指定会话，没有时恢复最近未归档会话。
2. 没有会话时主操作仍是“创建工作会话”。成功后立即读取 snapshot 和 readiness，不自动发送消息。
3. 对话流在第一条消息前显示紧凑的 `WorkReadiness` 状态区，不新增全屏向导或营销卡片。
4. 当前基线存在 1-50 个有效、可读取且有 contentHash 的材料时全部预选；用户可在上下文面板取消或重新选择，发送前始终显示准确数量和最高敏感级别。
5. 只有一个兼容 Skill 时确定性推荐并预选；多个兼容 Skill 时必须由用户选择；零个时 composer 保持禁用并显示可恢复原因。
6. readiness 完整后 composer 获得正常焦点。发送按钮是页面唯一主操作；创建、授权、刷新和切换 Skill 为次级操作。

### 5.2 后续回合

- 当前 baseline 未变时，默认沿用最近成功回合中仍有效的 material target；新增材料可由用户显式加入。
- baseline 或 Requirement rowVersion 变化时不沿用旧选择，页面重新读取 readiness，并将焦点移动到可恢复错误摘要。
- 最近 Skill 只有在仍被同一在线 Bridge 最新快照声明且 contentHash 一致时才可继续预选。
- URL 继续只保存 session 和页面导航状态，不把材料 ID、Skill ID、授权 ID 或敏感状态写入 URL。

### 5.3 RESTRICTED 材料

- readiness 可以显示用户有权查看的材料元数据，但无当前精确授权时返回 `AUTHORIZATION_REQUIRED`，不能排队 turn。
- PRODUCT_OWNER/TEAM_ADMIN 可在当前工作台为 session owner、当前 requirement、当前所选 material refs、固定 `APPROVED_AI/product-work-session` 授予最长 30 分钟权限。
- PRODUCT_MANAGER 无 grant 权限时只显示“需产品负责人授权”和所选范围，不提供无效按钮，也不自动降低为 INTERNAL 或移除受限材料。
- 授权可显式撤销；到期、撤销、material 变化或范围变化后，下一次 submit 必须重新拒绝。

## 6. HTTP 与 Contract

### 6.1 新增只读接口

`GET /api/v1/work-sessions/:sessionId/readiness`

返回 `product-work-session-readiness/1`：

- `sessionId/sessionRowVersion/requirementRowVersion/baselineId/checkedAt`；
- `contextOptions[]`：materialRefId、referenceType、version、sensitivity、selectedByDefault 和可解释 reason；不返回 `material_refs.source`，因为该字段可能承载正文，也不返回绝对路径；
- `skillOptions[]`：releaseId、displayName、version、riskLevel、contextCost、availability 和 disabledReason；
- `recommendedContextIds/recommendedSkillReleaseId`；
- `transmissionStatus`：`READY/AUTHORIZATION_REQUIRED/DENIED/UNKNOWN`；
- `bridgeStatus`：`AVAILABLE/UNAVAILABLE/UNVERIFIED`；
- `blockers[]`：稳定 code、面向用户的恢复动作，不包含底层异常和敏感值。

读取接口只返回 actor 有权查看的候选；结果不能替代 `POST turns` 时的 ETag、权限、基线、材料哈希、授权和 Bridge 能力复核。

### 6.2 新增授权接口

- `POST /api/v1/work-sessions/:sessionId/transmission-authorizations`：固定 action/target/purpose，仅接受 beneficiary actor、materialRefIds 和 1-30 分钟有效期；要求 Cookie、CSRF、Idempotency-Key 和 grantor 的 `GRANT_MATERIAL_TRANSMISSION` 权限。
- `POST /api/v1/transmission-authorizations/:authorizationId/revocations`：要求 If-Match、Idempotency-Key 和同等级 grant 权限；结果按 PostgreSQL rowVersion 收敛。
- 两个接口都由 work-session application service 编排 scoped authorization port；repository 不能接受客户端传入 scopeHash、grantor、requirement、target 或 purpose。

### 6.3 保持不变

- `CreateProductWorkSessionRequest` 和 `CreateProductWorkTurnRequest` schema version 保持不变。
- turn 请求仍只提交选择后的 material target IDs 和 SkillRelease ID；服务端创建新的不可变 ContextBinding ID。
- SSE、proposal、cancel 和 verify contract 保持不变，避免把本次首轮补齐扩大成协议重写。

## 7. 后端、数据库与模块边界

- `packages/contracts/src/work-sessions.ts`：新增 readiness、context option、skill option、transmission grant/revoke DTO 和稳定 blocker code。
- `apps/server/src/work-sessions/repository-port.ts`：新增只读 readiness 候选和同快照 Bridge/Skill 兼容查询；scoped authorization 保持独立 port。
- `packages/persistence/src/work-session-repository.ts`：读取当前 baseline 有效 refs；解析 ONLINE 且未过期的最新 capability snapshot；Skill 必须 ACTIVE、PASSED、releaseId 和 contentHash 均出现在同一 Bridge snapshot，且该 snapshot 声明 `product-work-turn/1 AVAILABLE`。
- `apps/server/src/work-sessions/readiness-application-service.ts`：生成确定性 recommendation、计算 transmission 状态、grant/revoke 编排；既有 `application-service.ts` 保留路由门面和 `submitTurn` 二次校验，避免继续扩大超大文件。
- `apps/server/src/work-sessions/routes.ts`：新增三个 route schema，不把授权判断下放浏览器。
- `apps/web/src/work-sessions/`：新增 feature-owned readiness hook/panel/selection state；`ProductWorkSessionPage.tsx` 只组合，不继续膨胀。
- `packages/ui`：只有确有复用价值时新增无业务依赖的 readiness/selector primitive，并先登记 `/ui-kit`；不新增页面局部色值、字体、字号、圆角、阴影或 motion。
- 不新增 migration，不修改 006/007，不在启动时自动建表，不直接编辑生成 bundle。

## 8. 确定性规则与并发

- context 候选只来自 session Requirement 的当前 baseline、`VALID` material_ref 和非空 contentHash；按稳定 source/id 排序。
- 1-50 个候选可全选推荐；超过 50 个时 `recommendedContextIds=[]` 并返回 `CONTEXT_SELECTION_REQUIRED`，禁止静默截断。
- 一个兼容 Skill 才自动推荐；多个时按 displayName/version 稳定展示但不替用户选择；零个返回 `NO_COMPATIBLE_SKILL`。
- Bridge 匹配必须在同一 snapshot 内同时满足在线、未过期、productWorkTurn AVAILABLE、协议版本、Skill releaseId 和 contentHash。
- readiness 带回读取时的 session/requirement 版本；submit 仍使用当前 session If-Match 并重新读取 baseline/refs/capability，竞态返回 `CONTEXT_STALE` 或 `BRIDGE_CAPABILITY_UNAVAILABLE`。
- 不缓存授权结论；readiness 可做单请求生命周期内合并查询，客户端不得把旧 READY 当作继续授权。

## 9. 安全、隐私、容量与降级

- 材料正文只在 Bridge 租约内按不可变 binding 读取；readiness、事件、日志和授权列表不含正文、凭据、数据库 URL、绝对路径或 prompt。
- 受限材料的 grant 必须精确绑定 actor、requirement、material refs、target、purpose 和有效期；scopeHash 由服务端生成。
- 无 baseline、无材料、无 Skill、Bridge offline、授权未知、版本冲突和超过 50 项均 fail closed，并给出具体恢复动作。
- readiness 目标本地 p95 不高于 300ms；候选查询最多 50 项自动选择、100 项展示，超量使用分页或缩小范围，不做无限数组和无界并发。
- AI 首事件目标沿用 D1 的本地 p95 3s；未形成 20 回合观察数据前不宣称达标。
- 关闭 `PFC_AI_WORKSPACE_ENABLED` 即隐藏/拒绝工作台与 Bridge 回合入口；已持久化会话保持只读，不删除标准事实。

## 10. 测试数据设计

自动化继续使用 `packages/test-data/src/ai-work-session-factory.ts` 和一次性 `codex_test_aiux_{runId}` schema，所有 ID 使用 `CODEx_TEST_AIUX_{runId}_` 前缀，结束后删除 schema 并读回 `remaining=0`。

| ID               | 场景                   | 构造与断言                                                                                                     |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AIUX-E-DATA-01` | 空会话首轮 ready       | 当前 baseline、2 个 INTERNAL refs、唯一同快照 Skill/Bridge；返回推荐，未 submit 前 turn/context/command 均为 0 |
| `AIUX-E-DATA-02` | 多 Skill               | 两个实际兼容 release；不自动选择，用户选择后只把所选 release 绑定到 turn                                       |
| `AIUX-E-DATA-03` | Skill 未被 Bridge 声明 | DB 中 ACTIVE/PASSED，但 snapshot 无 releaseId；不可用、零 command                                              |
| `AIUX-E-DATA-04` | Skill hash/能力漂移    | release hash 不一致、snapshot 过期或协议不可用；fail closed，重新 heartbeat 后恢复                             |
| `AIUX-E-DATA-05` | 无基线/无有效材料      | 返回准确 blocker 和业务恢复入口，不创建 seed 或假 context                                                      |
| `AIUX-E-DATA-06` | RESTRICTED 授权        | PM 无 grant 被拒；Owner 精确 grant 后可 submit；过期/撤销/改范围后再次拒绝                                     |
| `AIUX-E-DATA-07` | 版本竞态               | readiness 后 baseline 或 rowVersion 变化；submit 返回 stale，零重复 turn/command                               |
| `AIUX-E-DATA-08` | 数量边界               | 50 项可显式提交，51 项不自动选择，缩小到 50 后通过                                                             |
| `AIUX-E-DATA-09` | 幂等/并发              | 重复 create、grant、revoke、submit 不重复；并发提交仅一个活动 turn                                             |
| `AIUX-E-DATA-10` | UI/键盘/恢复           | 空、loading、ready、授权阻断、Bridge 离线、SSE 断线；焦点、aria-live、URL/session 恢复正确                     |

标准本地验收不运行 factory、不创建 seed。预检必须找到通过平台正常流程形成的非 `CODEx_TEST_` Requirement、当前 baseline、有效 material refs、团队 assignment、SkillRelease 和 Bridge registration；任何事实缺失都报告 `BLOCKED`，由对应业务页面补齐，不由验收脚本插入。

## 11. TDD、质量门禁与验收

### 11.1 TDD 顺序

1. Contract/domain：readiness shape、blocker、推荐和 transmission grant/revoke 规则先红后绿。
2. Repository/API：同快照 Bridge/Skill/hash、baseline material、权限、ETag、幂等、过期和 50/51 边界。
3. UI：空会话首轮、选择、禁用原因、错误焦点、刷新和 URL 恢复。
4. Isolated full chain：真实 PostgreSQL、Fastify/SSE、Bridge、Codex App Server 完成首轮，清理并读回。
5. Standard integration：只在后续授权包下启用 flag、使用标准业务事实创建 session/turn 并读回。

### 11.2 自动化门槛

- Targeted：新增 contract/domain/repository/API/UI tests 全部 PASS。
- Quick：config、delivery governance、UI governance、lint、format、types 和 unit 全部 PASS。
- Core：隔离 migration/repository/API/SSE、build、cleanup 和本地 PostgreSQL 全部 PASS。
- Full：PC browser、permission、concurrency、recovery、security、performance、dependency audit 和真实隔离 Bridge/Codex 首轮全部 PASS。
- 标准首轮是单独 evidence，不由 isolated Full、fixture、mock 或 console 输出代替。

### 11.3 Stage E 退出标准

- 新会话无需历史 turn 即可完成上下文与 Skill 选择并提交第一轮。
- 选定 Skill 必须由实际执行 Bridge 的同一有效 snapshot 声明，releaseId/contentHash 一致。
- 标准数据库可读回 session、turn、context bindings、command、events、Skill、Bridge 和 external thread/turn；数量和关联一致。
- 缺少任一事实、权限、能力或版本一致性时零 AI 命令、零材料传输、零业务建议应用。
- 产品负责人完成代表任务验收；代码评审、测试和安全责任人均已登记为陈立，各项结论仍须引用实际证据，人员登记本身不再阻断 AI-UX-R1。

## 12. 版本计划、风险和回滚

| 阶段 | 范围                             | 退出条件                                                    |
| ---- | -------------------------------- | ----------------------------------------------------------- |
| E0   | 本设计确认                       | 目标、接口、推荐规则、授权、测试、标准写入边界明确确认      |
| E1   | contracts/domain/repository/API  | targeted + Quick PASS；只用隔离 schema                      |
| E2   | Web interaction + UI kit         | 首轮状态测试、UI governance、1280/1440/1920 无回归          |
| E3   | isolated Bridge/Codex full chain | Core/Full PASS，schema/process cleanup 完成                 |
| E4   | 标准本地执行授权包               | 精确账号/需求/材料/Skill/Bridge/flag/写入/保留/停止条件确认 |
| E5   | 标准首轮与验收                   | 标准数据库/API/UI 读回，代表任务与实名结论完成              |

主要风险及控制：

- 错误 Skill/Bridge 配对：强制同 snapshot releaseId/contentHash 匹配，并在 submit 二次校验。
- readiness 与 submit 竞态：If-Match、baseline 和 capability 复核；不自动重试。
- restricted 误传：服务端精确 grant、最长 30 分钟、可撤销；无 grant 零命令。
- UI 再次偏离：复用 Stage D shell/token；新 primitive 先进入 `packages/ui` 和 `/ui-kit`，三宽度对照。
- 资源残留：临时 API/Web/Bridge/Codex/browser 全部由验收脚本拥有并关闭；最终报告 PID、端口和停止命令。

回滚：代码可回退到 Stage D 路径；运行时保持或恢复 `PFC_AI_WORKSPACE_ENABLED=false`；已创建标准 session/turn 不删除，只能按业务状态归档并保留审计。任何 schema 新需求、未授权传输、错误 Bridge 配对、重复 command、UNKNOWN 显示成功、敏感日志或测试 schema 残留都立即停止。

## 13. 影响面、授权边界与执行准备

设计确认后允许的实施范围：

- 写入：`packages/contracts`、`packages/domain`、`packages/persistence`、`packages/ui`、`apps/server`、`apps/web`、`packages/test-data`、相关 `tests`、交付账本和本地文档。
- 命令：targeted Vitest、`npm run test:gate:quick/core/full`、格式和治理检查。
- 测试副作用：仅一次性 `codex_test_*` schema；Full 可临时启动 loopback Fastify/Vite/Bridge/Codex App Server/Edge，并在同次运行关闭和读回。
- 无网络安装、无新增依赖、无并行 Agent、无标准 `pfc` 业务数据写入、无 `.env.local` flag 修改、无 commit/push/merge、无 SIT/生产/发布/部署。

后续 E4 标准执行包必须另行列出环境、账号、Requirement、材料、Skill、Bridge、允许创建的 session/turn/authorization ID 前缀、是否保留、flag 恢复、进程和停止条件。Auto-review 只能审核该包内的具体动作，不能扩大授权。

## 14. 责任、指标与确认项

- 产品负责人/当前工程 Owner：陈立。
- 代码评审：`陈立`。
- 测试：`陈立`。
- 安全：`陈立`。
- 当前返工来源：Stage D 的空会话首轮被历史 turn 依赖阻断；根因是缺少 server-owned readiness，并非单纯 UI 状态缺失。
- 本设计不使用并行 Agent；实现也保持串行 controller ownership，避免共同修改 work-session contract 和状态流。

产品负责人已于 2026-09-07 组合确认以下七项：

1. 采用方案 B，不新增 create-and-run 接口。
2. 1-50 个有效当前材料默认预选但发送前可见可改；51 个及以上不自动截断。
3. 唯一兼容 Skill 才自动推荐；多个必须人工选择。
4. Bridge 必须在同一有效 capability snapshot 中声明 Skill releaseId/contentHash 和 `product-work-turn/1`。
5. RESTRICTED 由 Owner/Admin 精确 grant，PM 不能自批或降级。
6. 本实现不新增 migration，且标准业务数据、flag 和标准首轮仍需 E4 精确授权。
7. 确认后授权第 13 节 source + isolated test 实施范围；不授权 commit、远程或发布。
