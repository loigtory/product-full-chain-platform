# POD-PFC-001 M2-R3 产物评审、追踪与 MCP 证据设计

> 设计日期：2026-09-08  
> 父级范围：`POD-PFC-001 / M2 受控作业闭环`  
> Unit 范围：`UNIT-PFC-02-03/04/05`、`UNIT-PFC-03-06`  
> 设计状态：`DESIGN_CONFIRMED`  
> 实施状态：`R3A_IN_PROGRESS`  
> 集成状态：`NOT_STARTED`  
> 验收状态：`NOT_STARTED`  
> 当前唯一路由：`POD-PFC-001/M2/R3a/artifact-collaboration-tdd`

## 1. 迭代分类与问题定义

本轮是严格级别的系统迭代。它新增用户可见的产物编辑、版本比较、评审确认、双向追踪和 MCP 查询交互，并改变 API、PostgreSQL 事实模型、Bridge 协议、Codex 适配、权限和审计边界，必须完整执行“需求 -> 设计 -> 开发 -> 测试 -> 验收 -> 发布 -> 观察 -> 复盘”。

当前已经具备不可变 `ArtifactVersion` 元数据、真实 Bridge/Codex 作业、工作会话和证据条，但仍有四个真实缺口：

1. `artifact_versions` 只保存来源引用和内容哈希，没有可查看、编辑和比较的权威正文快照。
2. 没有 `artifact_reviews` 和版本绑定的确认事实。
3. 没有 Requirement、CAP、Unit、AC、ArtifactVersion、AgentRun、Evidence 之间的类型化追踪事实。
4. Bridge capability snapshot 不含 MCP 清单；工作台的“MCP 未接入”是诚实的固定不可用状态，尚无真实调用和归档证据。

本轮不能用页面演示数据、进程内 Map、fixture、模型描述或一条普通 Agent 消息代替以上事实。

## 2. 目标、非目标与退出结果

### 2.1 目标

- `UNIT-PFC-02-03`：查看任一不可变版本正文；编辑时创建新版本；选择任意两个具备正文快照的版本得到可定位、可截断、可复验的服务端 Diff。
- `UNIT-PFC-02-04`：评审结论绑定准确的 ArtifactVersion ID、内容哈希、责任人、结论和时间；新版本不会篡改旧版本评审。
- `UNIT-PFC-02-05`：从任一节点查询入向和出向关系，定位 Requirement、CAP、Unit、AC、ArtifactVersion、AgentRun 和 Evidence；断链、失效和历史关系可见。
- `UNIT-PFC-03-06`：把 AgentRun、ProductWorkTurn 和只读 MCP 调用结果归档为持久、脱敏、可被版本或门禁引用的证据。
- 在同一产品作业工作空间中完成对话、工具状态、产物、Diff、评审和追踪，不再建立一套割裂的“AI 工具后台”。
- 使用标准本地 PostgreSQL `pfc_local/pfc` 完成真实读回，并以一个已登记、经过安全复核的本地只读 MCP 能力完成真实调用。

### 2.2 非目标

- 不实现 `UNIT-PFC-03-04` 的 Web/Zed 双端交接；Zed 仍留在 M3。
- 不接 SIT、生产、客户系统、远程数据库或远程 Git，不执行 commit、push、deploy 或发布。
- 不让浏览器直接访问文件系统、Bridge、Codex、MCP 或数据库。
- 不调用 `codex mcp add/remove/login/logout`，不改用户级或 Zed MCP 配置，不保存 MCP 凭据、Cookie、端点密钥或原始敏感输出。
- 不支持二进制产物正文和 Office 在线编辑；首版正文只支持受控 UTF-8 文本、Markdown 和 JSON。
- 不把运行事件的 30 天保留策略扩展为永久保存原始终端、完整 Prompt、隐藏推理或原始工具返回。
- 不因产品、开发、代码评审、测试和安全均由陈立承担而要求补充独立人员；人员配置不是阻断项。

### 2.3 R3 退出结果

四个 Unit 均达到真实本地 `INTEGRATED`；M2 的 11 个 Unit 全部完成集成；具名代码评审、测试、安全和产品验收分别有证据结论；一个只读 MCP 调用有能力登记、运行时匹配、调用、脱敏归档和页面读回。任何缺失证据不得用人员已登记、fixture 或自动门禁结果补写为 `PASS`。

## 3. 方案比较

| 方案                                   | 核心结构                                                                                   | 优点                                                                                          | 主要问题                                                                   | 结论             |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------- |
| A. 版本事实 + 追踪索引 + 受控 MCP 调用 | PostgreSQL 保存不可变正文、评审、追踪和证据；Bridge 经 Codex App Server 执行已登记只读 MCP | 数据真实、边界清楚、可审计；与现有 Artifact/AgentRun/WorkSession 复用；页面和 AI 对话共享事实 | 需要两次迁移和完整端到端改造                                               | **推荐，待确认** |
| B. 全部写入 WorkSession JSON/事件      | 把 Diff、评审、追踪、MCP 输出塞进会话事件                                                  | 表面开发快                                                                                    | 不能稳定查询双向关系；运行日志保留期会删除产品事实；版本和评审难做并发控制 | 拒绝             |
| C. 以文件、Git 或 MCP 服务为权威       | 平台只显示外部结果                                                                         | 避免平台建模                                                                                  | Bridge 离线即无法查看；外部配置漂移；不符合本地 PostgreSQL 产品事实政策    | 拒绝             |

选择方案 A。PostgreSQL 是产品事实源；文件、Git、Codex 和 MCP 是受控来源或执行依赖，不成为评审、追踪和归档事实源。

## 4. 核心业务规则

### 4.1 版本查看、编辑与 Diff

1. “编辑产物”永远创建新的 `ArtifactVersion`，禁止更新或删除旧版本正文。
2. 新建平台正文版本时，服务端从 UTF-8 正文计算 SHA-256；客户端不得指定最终哈希。
3. 工作区导入版本保留 `sourceRef` 作为来源，但只有 Bridge 在已验证工作区和允许相对路径内读回正文、服务端校验哈希并落库后，才标记 `CONTENT_AVAILABLE`。
4. 旧版本没有正文快照时仍保留元数据，页面明确显示“正文未归档，无法比较”，不得伪造空正文。
5. 单版本正文上限 512 KiB、最多 20,000 行；超过上限只登记来源和哈希，进入 `CONTENT_TOO_LARGE`，不尝试无界 Diff。
6. Diff 仅在服务端计算，绑定 `fromVersionId/fromContentHash/toVersionId/toContentHash`；默认行级比较，最多返回 2,000 个变更行和 200 个 hunk，超出时返回 `truncated=true` 和精确总量。
7. Windows `CRLF` 与 `LF` 只在比较视图中等价处理，原文哈希仍按落库正文计算；空白字符变化可单独切换查看，不改变原始事实。
8. 文本差异使用受维护的 `diff@9.0.0`，不手写差异算法。该包官方资料显示内置 TypeScript 类型、零依赖和 BSD-3-Clause 许可证；安装前仍须核验发布包 scripts、完整性、许可证、已知漏洞和 Node 24 兼容性。

### 4.2 评审与确认

- 评审提交即生成不可变确认事实，字段包括 ArtifactVersion ID、内容哈希、结论、意见、责任类型、`reviewedBy` 和时间。
- 结论为 `APPROVED / CHANGES_REQUESTED / REJECTED`。意见最多 8,000 字；`APPROVED` 可无意见，其他结论必须填写原因。
- 同一责任类型可对同一版本追加后续评审；后续评审以 `supersedesReviewId` 关联，不覆盖历史记录。
- 新版本产生后，旧版本评审继续有效但只适用于旧版本；页面显示 `HISTORICAL_VERSION`，不得自动沿用到当前版本。
- 评审接口使用 CSRF、`Idempotency-Key`、请求哈希和当前 Artifact `If-Match`。版本或哈希漂移时返回 `ARTIFACT_REVIEW_VERSION_STALE`。
- 产品、开发、代码评审、测试和安全责任均登记为陈立；相同人员承担多个责任不会阻止提交结论，但每类结论必须单独操作、单独留痕。

### 4.3 双向追踪

- `trace_subjects` 是追踪索引，不复制业务对象的权威状态。它保存对象类型、原生 ID、准确版本/哈希、来源定位和有效性。
- 类型固定为 `REQUIREMENT / CAPABILITY / UNIT / ACCEPTANCE_CRITERION / ARTIFACT_VERSION / AGENT_RUN / EVIDENCE`。
- CAP、Unit、AC 暂无独立业务表，必须绑定一个已确认的主 Spec ArtifactVersion 和稳定 locator；无权威版本/哈希的文本标签不能进入追踪图。
- `trace_links` 只保存一条有方向的边；双向查询由服务层返回 `INCOMING/OUTGOING`，禁止为“反向”复制第二条边。
- 关系固定为 `DECOMPOSES_TO / SATISFIES / PRODUCED_BY / IMPLEMENTS / EVIDENCED_BY / VERIFIED_BY`。不允许自由字符串关系。
- 链接必须处于同一 Requirement 范围。跨需求关系留到后续版本，不在 R3 以弱校验方式开放。
- 关系不能硬删除。来源版本失效或对象归档时记录 `invalidatedAt/reasonCode`，历史关系仍可读。
- AI 可以提出追踪建议，但只能形成 `ActionProposal`；经确认和服务端重新校验后才能落库，模型文本本身不是追踪事实。

### 4.4 结果与证据归档

- 新增 `execution_evidence` 保存持久证据摘要，来源为 `AGENT_RUN_RESULT / PRODUCT_WORK_TURN_RESULT / MCP_READ_RESULT / REVIEW_RESULT / TEST_RESULT`。
- 每条证据绑定 Requirement、当前基线、来源执行 ID、结果、脱敏摘要、内容哈希、敏感级别、发生时间和保留类别。
- 可选绑定 ArtifactVersion 和 GateRun；两者至少一个存在，或由有效 `trace_link` 把证据连接至一个业务版本。
- 原始 AgentRun/Event/Turn 可以按既定期限清理，但被产品版本或门禁引用的 `execution_evidence` 不随运行日志删除。
- 归档失败不得把 Run 或 Turn 标为完整闭环；页面显示 `RESULT_AVAILABLE / EVIDENCE_PENDING`，恢复操作重试归档而不重复执行外部动作。

## 5. MCP 采用与安全边界

### 5.1 单一权威

Codex 项目配置仍是 MCP 运行时权威。平台只登记允许使用的能力元数据并保存脱敏快照，不修改配置。R3 的真实调用通过已固定版本的 Codex App Server `mcpServerStatus/list` 和 `mcpServer/tool/call` 完成，不绕过 App Server 另建私有协议。

### 5.2 能力登记

新增 `mcp_capability_registrations`，每条登记包含：

- 逻辑能力 ID、MCP server 名称、tool 名称；
- tool input schema hash、运行时配置 fingerprint；
- 固定效果分类 `READ_ONLY`、风险等级、最大输入/输出、超时；
- 允许的 Requirement/team 范围、状态；
- 复核人、复核时间和复核证据引用。

运行时 `readOnlyHint` 只作为证据，不能单独证明无副作用。只有人工复核为只读、运行时 server/tool/schema/config 全部与登记匹配的能力才可执行。

### 5.3 Bridge capability v2

新增 `pfc-bridge-capabilities/2`，保留 v1 读取兼容。v2 增加有界 `mcp` 区域：总体状态、配置 fingerprint，以及最多 20 个 server、每个最多 50 个 tool 的名称、schema hash、运行状态、认证状态和 read-only hint。快照禁止包含命令、环境变量、Token、Cookie、URL 查询密钥或配置文件正文。

旧 Bridge 上报 v1 时 MCP 显示 `UNVERIFIED`，不能租用 MCP 命令；不能把缺字段解释为可用。

### 5.4 对话内调用流程

```text
产品经理在工作会话中提出查询意图
  -> Skill 只产生类型化 READ_MCP 建议，不直接调用工具
  -> Server 校验能力登记、team/Requirement、输入 schema 和敏感材料传输授权
  -> 低风险且不含受限材料的已登记只读查询可按策略自动确认；其余显示 ActionProposal
  -> PostgreSQL 创建 mcp_read_request 和 EXECUTE_MCP_READ 租约命令
  -> Bridge 重新匹配 capability snapshot 和配置 fingerprint
  -> App Server 初始化只读临时 thread 并调用精确 server/tool
  -> Bridge 在内存中限制、脱敏结果并回传状态/摘要/hash/duration
  -> Server 原子落 mcp_read_request、execution_evidence、trace、timeline/outbox/audit
  -> 会话显示工具调用卡片，EvidenceBar 从真实快照显示 MCP 状态
```

任何 MCP 写能力、OAuth 登录、配置 reload、server/tool 动态选择、schema 漂移、认证未知、输出超限或副作用语义不清都 fail closed。不存在已配置且可证明只读的本地 MCP 时，R3 真实集成保持 `BLOCKED_BY_MCP_CAPABILITY`，先提出最小工具安装/配置授权，不能降级为 mock 后宣称完成。

### 5.5 限额和脱敏

- 单次参数 JSON 不超过 32 KiB，默认超时 10 秒，绝对上限 30 秒；每个 WorkSession 同时最多 1 个 MCP 查询。
- Bridge 接收原始输出上限 256 KiB；持久摘要上限 16 KiB；超限结果只保存截断摘要、原始长度和完整内容哈希。
- 不记录凭据、Cookie、数据库 URL、用户目录、绝对路径、原始受限材料或隐藏推理。
- 输入引用受限材料时，`TRANSMISSION_TARGETS` 增加 `MCP`，必须有准确 materialRef、purpose、scopeHash 和有效期的授权。
- 调用结果未知时状态为 `UNKNOWN`，禁止自动重试；先用只读核验确认是否可安全重试。

## 6. PostgreSQL 设计与迁移计划

### 6.1 Migration 008：产物协作事实

文件计划：`packages/persistence/src/migrations/202609080008_create_artifact_review_trace.ts`

| 表                          | 关键字段和约束                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact_version_contents` | `artifact_version_id` PK/FK、media type、UTF-8 content、size、content hash、availability、createdAt；insert trigger 核对 `artifact_versions.content_hash`，update/delete trigger 拒绝变更 |
| `artifact_reviews`          | version/hash、conclusion、responsibility、reviewedBy、comment、supersedes、createdAt；确认事实不可修改/删除                                                                               |
| `trace_subjects`            | requirement、subjectType、nativeId、nativeVersion、contentHash、authorityArtifactVersionId、locator、validity                                                                             |
| `trace_links`               | requirement、sourceSubject、targetSubject、relationType、validity、createdBy、invalidatedAt/reason；同一有效边唯一                                                                        |

数据库约束保证同 Requirement、不可变版本和合法枚举；异构原生对象存在性由应用服务在同一事务内锁定并校验，不能依赖 UI。

### 6.2 Migration 009：MCP 和持久证据

文件计划：`packages/persistence/src/migrations/202609080009_create_execution_evidence_mcp.ts`

| 表或变更                       | 关键字段和约束                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_evidence`           | requirement/baseline、sourceType/sourceId、outcome、safeSummary、contentHash、sensitivity、artifactVersion/gateRun、retentionClass、createdAt；事实不可修改/删除 |
| `mcp_capability_registrations` | logical key、server/tool/schema/config hash、READ_ONLY、limits、scope、review evidence、status、rowVersion                                                       |
| `mcp_read_requests`            | session/turn/capability、input/hash、status、Bridge/thread IDs、output summary/hash、duration、evidenceId、rowVersion、timestamps                                |
| `product_work_turn_commands`   | 命令枚举增加 `EXECUTE_MCP_READ`，仍使用租约、幂等和 UNKNOWN 规则                                                                                                 |
| `product_action_proposals`     | kind 约束增加 `REGISTER_TRACE_LINK / READ_MCP`，target 约束增加 `TRACE_LINK / MCP_CAPABILITY`                                                                    |
| `scoped_action_authorizations` | transmission target 约束增加 `MCP`                                                                                                                               |

两份 migration 先后在独立 `codex_test_m2r3_<runId>` schema 正反向验证。标准 `pfc` 只执行 forward migration；一旦承载产品事实不使用 drop/cascade 回滚，只允许前向修复。

## 7. 模块和文件边界

| 模块                                                            | 单一职责                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/contracts/src/artifact-collaboration.ts`              | 版本正文、Diff、评审、追踪和证据 DTO/枚举/错误恢复动作；新增 `REGISTER_TRACE_LINK` proposal |
| `packages/contracts/src/mcp-evidence.ts`                        | MCP 登记、查询、状态和脱敏证据 DTO；新增 `READ_MCP` proposal                                |
| `packages/domain/src/artifact-review.ts`                        | 评审版本绑定、结论追加、失效规则                                                            |
| `packages/domain/src/traceability.ts`                           | subject/link 类型、同需求规则、关系方向和失效规则                                           |
| `packages/domain/src/mcp-read.ts`                               | capability 匹配、状态机、限额和 fail-closed 规则                                            |
| `packages/persistence/src/artifact-collaboration-repository.ts` | 正文、评审、trace 的事务和查询                                                              |
| `packages/persistence/src/execution-evidence-repository.ts`     | 持久执行证据归档与门禁引用                                                                  |
| `packages/persistence/src/mcp-read-repository.ts`               | MCP 登记、请求、租约结果和幂等                                                              |
| `packages/codex-adapter/src/mcp-read-session.ts`                | App Server MCP inventory/call、响应校验、超时和脱敏                                         |
| `apps/bridge/src/mcp-read-worker.ts`                            | 命令领取、运行时 fingerprint 复核、调用和回传                                               |
| `apps/server/src/artifact-collaboration/`                       | 内容、Diff、评审和追踪用例与 routes                                                         |
| `apps/server/src/mcp-reads/`                                    | 能力查询、请求、Bridge 回传和证据归档                                                       |
| `apps/web/src/artifact-workspace/`                              | 版本栏、正文编辑、Diff、评审和追踪面板                                                      |
| `apps/web/src/work-sessions/`                                   | 对话中的 MCP 调用状态和真实 EvidenceBar 映射                                                |
| `packages/test-data/src/m2-r3-factory.ts`                       | 确定性隔离数据，不进入标准业务 schema                                                       |

`ArtifactCatalogPage.tsx` 只保留路由级组装；版本栏、编辑器、Diff、评审、追踪分别拆分。`ProductWorkSessionPage.tsx` 只组合工作会话区域。新增 architecture test 禁止页面重新堆入单个大文件，禁止 repository 直接跨模块更新其他模块表。

## 8. API 与协议

### 8.1 Browser API

- `GET /api/v1/artifacts/:artifactId`
- `GET /api/v1/artifacts/:artifactId/versions/:versionId/content`
- `POST /api/v1/artifacts/:artifactId/versions`：扩展 v2 正文输入；旧来源登记保持兼容。
- `GET /api/v1/artifacts/:artifactId/diff?fromVersionId=&toVersionId=&whitespace=`
- `GET /api/v1/artifact-versions/:versionId/reviews`
- `POST /api/v1/artifact-versions/:versionId/reviews`
- `GET /api/v1/requirements/:requirementId/traces?subjectId=&direction=&cursor=`
- `POST /api/v1/requirements/:requirementId/trace-links`
- `POST /api/v1/trace-links/:traceLinkId/invalidations`
- `GET /api/v1/requirements/:requirementId/evidence?sourceType=&cursor=`
- `GET /api/v1/mcp-capabilities?requirementId=`：只返回允许且已脱敏的逻辑能力。
- `POST /api/v1/work-sessions/:sessionId/mcp-read-requests`

所有 mutation 使用 CSRF、`Idempotency-Key`、请求哈希和 ETag/rowVersion。授权先于正文、Diff、评审意见、MCP 参数和证据读取。列表默认 20、最大 100；Diff 和正文不通过 SSE 推送，SSE 只发送有界状态摘要。

### 8.2 Bridge 协议

- capability snapshot v2：有界 MCP inventory。
- command：`EXECUTE_MCP_READ`，只含 request/capability/schema/config/input hash 和租约信息；参数正文由已认证 Bridge 在租约内读取。
- event：`MCP_READ_STARTED / MCP_READ_COMPLETED / MCP_READ_FAILED / MCP_READ_UNKNOWN`。
- ACK 丢失但调用可能完成时进入 UNKNOWN，不自动重复调用。

### 8.3 错误和恢复

新增稳定错误码：

`ARTIFACT_CONTENT_UNAVAILABLE / ARTIFACT_CONTENT_TOO_LARGE / ARTIFACT_DIFF_LIMIT_EXCEEDED / ARTIFACT_REVIEW_VERSION_STALE / TRACE_SUBJECT_UNVERIFIED / TRACE_CROSS_REQUIREMENT_FORBIDDEN / TRACE_LINK_ALREADY_EXISTS / EVIDENCE_ARCHIVE_PENDING / MCP_CAPABILITY_UNAVAILABLE / MCP_CAPABILITY_DRIFTED / MCP_READ_NOT_ALLOWED / MCP_OUTPUT_LIMIT_EXCEEDED / MCP_RESULT_UNKNOWN`

每个错误返回明确恢复动作，例如 `IMPORT_CONTENT / SELECT_OTHER_VERSION / RELOAD_CURRENT / VERIFY_AUTHORITY / REQUEST_TRANSMISSION_AUTHORIZATION / VERIFY_MCP_RESULT`。

## 9. 前端交互和视觉模板

R3 延续已经接受的 AI-UX-R1 视觉基线和 `packages/ui` 三层 token，不新建页面本地颜色、字号、圆角、阴影或动效。

### 9.1 产物工作区

- 页面顶部保留需求和产物身份、当前版本、评审状态和主操作，不使用营销 Hero。
- 左侧窄版本栏用于扫描版本、作者、时间和评审状态；中间为正文/编辑/Diff 主区；右侧上下文栏显示评审和追踪。
- “编辑”切换为新版本草稿；保存按钮明确写“保存为新版本”，从交互上阻止覆盖历史。
- Diff 使用统一/并排分段控件，增加/删除/上下文使用语义 token；键盘可以跳转下一个变更，超限时显示截断原因。
- 评审结论使用单选菜单和“确认评审”命令；新版本生成后旧结论标为历史版本。
- 追踪使用可扫描的分组列表和方向筛选，不在首版引入难以操作的自由拖动画布。

### 9.2 AI 工作会话

- MCP 查询表现为对话时间线中的工具调用行，包含逻辑能力、状态、耗时、结果摘要和证据入口；不展示服务器端点、凭据或原始参数。
- `WorkspaceEvidence` 的 MCP 状态来自 capability snapshot 和登记匹配结果，状态为“可用 / 配置漂移 / 未核验 / 未接入”，不再硬编码。
- 产物建议确认后可在同一页面右侧产物画布查看新版本、Diff、评审和追踪，不跳到另一套后台。

### 9.3 视觉验收

- 在本地 `/ui-kit` 先补版本栏、Diff hunk、评审状态、追踪行和工具调用五类组件状态。
- 代表页先在 1280、1440、1920 宽度完成截图与人工验收，再迁移产物目录和工作会话。
- 覆盖 hover、focus-visible、键盘切换、加载、空、错误、无正文、超限、MCP UNKNOWN 和 URL 刷新恢复。
- PC Web 之外的移动布局不在本轮范围，但 1280 宽度不能出现遮挡、水平溢出或文本截断失去含义。

## 10. 测试数据设计

本轮触发确定性 factory。所有自动化写入只进入 `codex_test_m2r3_<runId>` schema 和隔离临时 Git 工作区，ID 以 `CODEx_TEST_M2R3_<runId>_` 开头，结束后按 createdIds 精确清理并读回为空。

| 场景                                                      | 风险/断言                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| 两个正文版本、纯换行变化、空白变化、超长正文              | 版本不可覆盖；hash 正确；Diff 稳定、可截断、不会无界占用 CPU/内存 |
| 旧元数据版本无正文                                        | 显示不可用；不能输出伪 Diff                                       |
| APPROVED/CHANGES_REQUESTED/REJECTED、后续复核、新版本产生 | 结论绑定准确版本；非批准必填原因；历史评审不自动沿用              |
| Requirement/CAP/Unit/AC/Version/Run/Evidence 完整链和断链 | 双向查询一致；跨需求拒绝；失效历史仍可读                          |
| AgentRun/Turn 成功但证据归档失败                          | 不产生伪闭环；可只重试归档                                        |
| MCP 可用、未登记、schema/config 漂移、超时、超限、UNKNOWN | 只有精确匹配的 READ_ONLY 能力执行；不自动重试 UNKNOWN             |
| PUBLIC/INTERNAL/RESTRICTED 材料和有/无授权                | 受限材料无 `MCP` 传输授权时拒绝；日志与页面不泄露正文或凭据       |
| 同一版本并发追加、并发评审、重复 trace/MCP 请求           | ETag、唯一约束、幂等和租约保持单一事实                            |
| 陈立承担全部登记责任                                      | 不因缺少第二个人阻断；各类结论仍是独立审计记录                    |

Factory 构造 Requirement、Baseline、Artifact 两版本、Review、Trace subjects/links、AgentRun/Turn、Capability registration 和 MCP request，避免手工超过三步的脆弱设置。真实 MCP 调用只使用已登记的本地非敏感只读输入；不把自动化 factory 结果作为产品验收。

## 11. TDD、质量门禁与验收证据

### 11.1 TDD 顺序

1. 领域失败测试：不可变正文、评审版本漂移、trace 同需求、MCP capability 漂移和 UNKNOWN。
2. 协议契约测试：capability v1/v2 兼容、有界 MCP inventory、DTO 和错误恢复动作。
3. migration/repository 集成失败测试：约束、幂等、并发、正反向隔离迁移和证据事务。
4. server/bridge/adapter 测试：鉴权、正文上限、Diff 超时、MCP allowlist、脱敏和 ACK 丢失。
5. Web 组件和 Edge E2E：正文、Diff、评审、追踪、MCP 状态、刷新恢复、权限和三档视觉证据。

### 11.2 门禁

- 每个子阶段执行 focused tests 和 `npm run test:gate:quick`。
- migration/repository、Bridge/MCP 和标准本地读回完成后执行 `npm run test:gate:core`。
- R3 集成候选必须执行 `npm run test:gate:full`；dry-run 不能记为 PASS。
- 额外执行 `npm run check:delivery-governance`、`npm run check:ui-design` 和安全检查。
- `diff@9.0.0` 安装后执行锁文件审阅、依赖审计、构建和功能回归；任何 install script、许可证不符、漏洞或异常传递依赖立即停止。

### 11.3 具名结论

| 活动          | 责任人 | 完成口径                                         |
| ------------- | ------ | ------------------------------------------------ |
| 产品设计/验收 | 陈立   | 明确确认本设计；人工验收真实页面和业务链         |
| 开发          | 陈立   | 实现、读回和架构边界证据完整                     |
| 代码评审      | 陈立   | correctness、回归、并发、边界和缺测结论          |
| 测试          | 陈立   | focused/quick/core/full、真实 MCP 和 PC E2E 结论 |
| 安全          | 陈立   | MCP 只读性、敏感传输、脱敏、权限和依赖结论       |

同一人员兼任不构成阻断。尚未执行的评审、测试、安全或产品验收仍保持 `NOT_STARTED/PENDING`，原因是证据未形成，不是人员缺失。

## 12. 标准本地集成与数据边界

隔离门禁通过后，标准本地集成按以下顺序执行：

1. 对 `pfc_local/pfc` 做只读 migration plan、表/约束/版本预检和备份可用性核验。
2. 在单独授权范围内应用 migration 008/009，只执行已审阅 forward migration。
3. 优先复用标准 schema 中真实的 `REQ-PFC-001`、当前 Baseline、Artifact、AgentRun 和 WorkSession；不存在所需业务事实时保持产品验收待办，不写 fixture 或演示 seed 冒充。
4. 通过正常 API 创建一个真实新 ArtifactVersion、一个版本评审、一组 trace links 和一条 execution evidence；每个 createdId 都记录并读回。
5. 选择一个已经配置、登记并证明只读的本地 MCP 能力，执行一次非敏感、无外部写入调用；读回 request、evidence、trace、audit 和页面状态。
6. 重启 API/Web/Bridge 后再次读取，证明数据库事实和恢复状态不依赖进程内存。

标准业务事实默认保留，不按测试数据清理；若用户明确要求撤销，只能通过正常 API 失效/归档并保留审计历史，不能直接 SQL 删除。

## 13. 风险、性能、停止条件和回滚

| 风险                       | 控制                                                            | 停止条件                                   |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| 大正文或退化 Diff 耗尽资源 | 512 KiB/20,000 行、2 秒计算预算、`diff` timeout、有界结果       | 超限仍无界计算或 API P95 明显失控          |
| 评审指向错误版本           | version ID + hash + ETag + 事务锁                               | hash/版本不一致仍能确认                    |
| 异构 trace 形成幽灵关系    | authority ArtifactVersion、同 Requirement 校验、失效而不删除    | CAP/Unit/AC 无权威定位仍可入库             |
| MCP 声称只读但有副作用     | 人工登记、schema/config fingerprint、精确 allowlist、一次一请求 | 工具语义不清、配置漂移或出现写入           |
| MCP 泄露敏感数据           | scoped transmission、输入/输出限额、Bridge 脱敏、摘要持久化     | 凭据、受限正文或绝对路径进入日志/数据库/UI |
| ACK 丢失导致重复调用       | 租约、幂等、UNKNOWN、人工核验                                   | 不能证明调用结果却准备自动重试             |
| UI 再次变成传统割裂后台    | 同一 WorkSession、`packages/ui`、代表页先验收                   | 未完成代表页视觉验收即批量迁移             |

性能目标：正文和普通 trace 列表本地 P95 小于 300 ms；256 KiB 两版本 Diff P95 小于 1 s、硬超时 2 s；MCP 调用独立显示耗时，不计入普通页面加载。所有查询分页并限制连接池和并发，不启动隐藏后台无限循环。

代码回滚使用版本控制反向修改。标准 schema 已写事实后 migration 不做 destructive down；功能开关关闭新入口并保留只读查看，数据库通过前向 migration 修复。MCP 异常时撤销能力登记、停止新命令并把不确定请求保留为 UNKNOWN。

## 14. 版本计划、并行和进程清理

### R3a：Artifact 协作内核

完成 migration 008、正文、Diff、评审、trace contracts/domain/repository/API 和确定性 factory；代表产物页视觉验收后执行 quick/core。

### R3b：持久证据与 MCP

完成 migration 009、capability v2、MCP 登记/请求/Bridge/Codex adapter、WorkSession 状态和证据归档；完成真实只读 MCP 调用后执行 quick/core。

### R3c：M2 全量整合

把产物画布、评审、追踪和工具证据并入同一 WorkSession；完成权限、并发、恢复、安全、性能和 Edge E2E，执行 full、具名结论和产品验收。

当前不使用并行 Agent。contracts、两份 migration、trace/evidence 事务和 MCP 协议紧密耦合，先由控制者串行稳定接口；接口稳定后如需并行，最多 2 个 Agent，且必须按不重叠所有权拆为“artifact UI”与“MCP adapter tests”，集成顺序为 contracts/domain -> persistence -> adapter/bridge -> server -> web -> gates。

每次验证结束关闭 API、Web、Bridge、App Server、Playwright 和测试 runner。若用户要求保留体验服务，交付时列出 PID、端口、用途和关闭命令。

## 15. 待确认实施授权包

确认本设计后，授权范围建议一次覆盖以下动作，避免实施中反复等待：

1. 在本仓库内按第 7 节模块边界修改源代码、测试、文档、质量配置和锁文件；不提交、不推送。
2. 在完成供应链复核后执行 `npm install --save-exact diff@9.0.0`；只允许该一个直接依赖，不允许无关升级。
3. 创建 migration 008/009，并在 `codex_test_m2r3_<runId>` schema 执行正反向隔离迁移、确定性测试写入、createdIds 清理和空读回。
4. 允许只读检查 Codex App Server 的 MCP inventory；只输出脱敏能力和 fingerprint，不打印配置正文或凭据。
5. 允许在隔离测试范围执行一个已证明只读、无敏感输入、无外部写入的 MCP 调用；若不存在合适能力，停止并提交最小安装/配置授权，不使用替代演示数据。
6. 隔离 quick/core 通过后，先提交标准 `pfc` migration plan 和精确变更摘要。应用 migration 008/009、标准 API 业务事实写入和标准 MCP 调用仍需用户在看到预检后再次明确授权，不由本次设计确认自动获得。
7. 允许启动 loopback API/Web/Bridge、App Server 和 Edge E2E；不开放防火墙，不接远程环境，结束后清理进程。

以下始终不在本包：标准 `pfc` migration 应用及业务写入、MCP 配置变更或安装新 MCP 服务、MCP 写调用、SIT/生产、远程 Git、commit、push、deploy、发布、删除历史事实或打印敏感值。

## 16. 接受、发布、观察和父级路由

- R3 的人工验收人是陈立；人员配置不会阻断验收。
- M2 接受仍取决于四个 R3 Unit 的真实标准本地集成、真实只读 MCP、Full 门禁、视觉验收及代码评审/测试/安全/产品四类独立结论。
- M2 只形成本地候选，不等于 `RELEASED`。发布和部署未授权。
- M2 候选完成后观察至少一个本地工作日，关注 Diff 超时、评审冲突、trace 断链、MCP 失败/UNKNOWN、证据归档积压、日志增长、敏感字段命中、Bridge 进程和事件延迟。
- 观察后记录 lead time、返工次数、失败门禁、缺陷来源、MCP 能力漂移和视觉反馈。
- R3 设计确认后的下一路由是 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`；R3 全部验收后返回父级 `POD-PFC-001/M2/acceptance-and-observation`，不能直接宣称平台整体完成。

## 17. 设计确认记录

产品负责人陈立于 2026-09-09 在收到完整设计、方案 A 结论、第 15 节边界和建议确认语句后，以“继续”确认按已展示范围实施。该确认只启动仓库源代码、受控依赖、隔离 schema、只读 MCP inventory/隔离调用和本机测试；标准 `pfc` migration 及业务写入仍在隔离 Core 通过并展示精确预检后单独授权。

当前进入 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`。产品、开发、代码评审、测试和安全责任人均为陈立，不因人员兼任等待；未执行的技术门禁继续按证据状态管理。

## 18. 设计依据

- 已确认的 M2 总体设计：`docs/implementation/POD-PFC-001-M2-controlled-agent-work-design-20260906.md`。
- 已确认的 AI 工作空间设计：`docs/implementation/POD-PFC-001-M2-AI-UX-D1-WORK-SESSION-DESIGN-20260907.md`。
- jsdiff 官方仓库和 API：<https://github.com/kpdecker/jsdiff>。
- `diff@9.0.0` npm 包信息：<https://www.npmjs.com/package/diff/v/9.0.0>。
