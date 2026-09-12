# POD-PFC-001 M2-R2 平台启动审批设计补充

> 状态：`CONFIRMED`  
> 日期：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> CAP / Unit：`CAP-PFC-03 / UNIT-PFC-03-03、UNIT-PFC-03-05`，`CAP-PFC-04 / UNIT-PFC-04-05`  
> 原设计：`POD-PFC-001-M2-R2-write-approval-cancel-design-20260906.md`  
> 确认：产品负责人于 2026-09-07 明确采用方案 A，并授权在原第 15 节边界内返工 R2-T1/T3/T5/T6；修订 migration 隔离验证通过后，允许向本机 `pfc_local/pfc` 应用唯一 migration `202609060005`。  
> 下一路线：`POD-PFC-001/M2/R2/platform-start-approval-implementation`

## 1. 触发原因与证据

R2-T6 的真实本机 Codex App Server `0.153.4` 隔离烟测证明：`workspaceWrite` 回合可在不产生任何 server-initiated approval request 的情况下修改胶囊内文件。烟测因此按 `M2_R2_APPROVAL_NOT_REQUESTED` 失败，没有把真实写入误报成“四眼审批通过”。

OpenAI 官方 App Server 文档说明，命令执行和文件变更是否需要审批取决于用户 Codex 设置；`item/fileChange/requestApproval`、`item/commandExecution/requestApproval` 和 `item/permissions/requestApproval` 是条件性请求，不能充当平台始终存在的启动门禁。

本次事实边界：

- 固定 App Server 版本、初始化、只读运行、恢复和取消对照烟测通过。
- R2 `thread/start` 和 `turn/start` 已在固定生成协议下成功，胶囊是唯一 writable root，网络关闭。
- 真实回合结束后审批请求数为 0；测试按预设停止条件失败。
- 注册源工作区 hash 未变化；合成源目录、App Server 和测试胶囊已清理。
- 标准 `pfc` schema 未应用 R2 migration，标准库验收数据未创建。

## 2. 目标、不变项与非目标

目标是让四眼批准成为平台数据库和命令队列的确定性前置条件，而不是依赖 Codex 用户设置。批准前不得向 Bridge 创建任何 `START_WORKSPACE_WRITE_RUN` 命令。

保持不变：Codex 只写隔离胶囊；注册源工作区不回写；网络永不批准；审批者不得等于发起者；UNKNOWN 不自动重跑；App Server 的额外权限请求继续 fail closed；R3 才做产物 Diff 评审和回写决策。

本补充不授权依赖升级、远程 Git、SIT/生产、commit、push、merge、deploy、客户数据或注册源工作区写入。

## 3. 方案比较

| 方案                              | 核心流程                                                                  | 优点                                              | 风险/代价                                                | 结论     |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | -------- |
| A. 平台 `RUN_START` 前置审批      | 创建写 Run 与待审批事实，但不创建启动命令；独立审批者批准后事务内创建命令 | 确定性四眼；沿用现有审批、审计、rowVersion 和队列 | 需调整领域、migration、repository、API/UI 和测试         | **推荐** |
| B. 依赖 App Server 文件/权限请求  | 保留当前流程并调整 Codex 设置                                             | 改动较小                                          | 官方语义和真实烟测均证明请求不是必然；无法形成平台不变量 | 拒绝     |
| C. 只读生成 patch，平台批准后应用 | 模型不直接写；批准精确 patch 后由平台应用胶囊                             | 可批准具体 diff                                   | 引入平台 patch 执行器，改变 R2 目标且与 R3 Diff 评审重叠 | 延后评估 |

## 4. 推荐流程

1. Browser 提交固定 `CONTROLLED_ARTIFACT_EDIT` 与最小 RunScope。
2. Server 完成权限、基线、workspace、ArtifactVersion 和 SkillRelease 校验。
3. 同一事务创建 `WORKSPACE_WRITE` AgentRun（状态 `WAITING_APPROVAL`）、`RUN_START` approval、事件、审计、outbox 和幂等事实；此时启动命令数必须为 0。
4. 审批箱展示请求人、目标相对路径、动作、文件/字节上限、网络关闭、基线和失效时间。批准者必须是同一需求团队内的 `PRODUCT_OWNER`、`ENGINEERING_OWNER` 或 `TEAM_ADMIN`，且不得是请求人。
5. `APPROVE` 使用 If-Match 和 Idempotency-Key；审批事务内再次校验 RunScope、基线、Bridge、Skill、有效期和人员分离，再创建唯一 `START_WORKSPACE_WRITE_RUN`，Run 进入 `QUEUED`。
6. `DECLINE/EXPIRE` 终结 approval 和 Run，不创建启动命令。重复决定只读回原结果；冲突返回 409。
7. Bridge 领取后仍执行胶囊、hash、路径、禁网和固定 Skill 校验。App Server 后续如请求 command/file/permissions，只能在已批准 RunScope 内处理；网络、范围扩大、会话级批准和未知请求始终拒绝。
8. 真实写入结束后保存 manifest/diff hash；内容评审和是否回写注册源工作区仍属于 R3，不由启动批准替代。

## 5. 数据、接口和状态修正

- `AgentApprovalKind` 增加 `RUN_START`；原有三类保留为运行中额外权限审批。
- `approval_requests` 的 App Server identity 对 `RUN_START` 允许为空，但必须绑定 `run_id + execution_instance_id + run_scope_hash`；两类审批使用互斥约束。
- 写 Run 初始状态从 `QUEUED` 改为 `WAITING_APPROVAL`；批准后才进入 `QUEUED`，拒绝/过期进入明确终态。
- `AgentRunApplicationService.create` 不再创建写启动命令；repository 事务创建 run + start approval。
- `AgentApprovalApplicationService.decide` 对 `RUN_START/APPROVE` 原子创建唯一启动命令；App Server approval 决定仍创建 `RESOLVE_APPROVAL`。
- Web 启动作业后跳转审批等待状态；审批详情明确区分“启动范围审批”和“运行中额外权限审批”。

## 6. TDD、迁移和验证计划

先增加失败测试：批准前零启动命令、自批 403、过期零命令、批准事务创建唯一命令、并发批准只生成一条命令、拒绝后不可启动、App Server 0 请求仍不能绕过平台审批。然后依次修改 contract/domain、migration/repository、application/API、Bridge/UI。

隔离 schema 全量通过后，重新运行真实 App Server 三场景：平台批准后写入、平台拒绝零 App Server/零写入、批准后运行中取消。标准 `pfc` migration、双账号验收和浏览器验收仍使用原第 15 节限定授权，但必须在本补充确认并通过隔离验证后执行。

退出条件补充：任何 `WORKSPACE_WRITE` run 在 `RUN_START` approval 终态为 `APPROVED` 且对应审计提交前，数据库与 Bridge 均必须读回启动命令数为 0。

## 7. 风险、回滚和确认结论

主要风险是批准与命令创建非原子导致无批准启动，或并发决定生成重复命令；通过单事务、唯一约束、rowVersion 和并发集成测试控制。回滚为关闭 `WORKSPACE_WRITE` capability 和写入口，保留只读 R1；数据库只做前向修复，不 drop 已有审计事实。

产品负责人已确认采用方案 A，并允许在原第 15 节边界内返工 R2-T1/T3/T5/T6。确认不扩大原授权范围；标准 `pfc` migration 仅在修订 migration 完成、独立 schema 预检通过后执行。该 schema 变更持久化，回滚仅做前向修复。

## 8. 依据

- OpenAI Codex App Server：<https://developers.openai.com/codex/app-server/>
- 本仓库固定生成协议：`packages/codex-adapter/src/generated/app-server-0.153.4/`
- `.local/m2-spikes/20260907-r2/r1-control-result.json`（本地忽略证据）
- `scripts/spikes/m2-r2-app-server-spike.ts`
