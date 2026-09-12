# POD-PFC-001 M2-R2 实施检查点

> 最近更新：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 授权：AI-UX-R1 分阶段执行授权包已确认，包含 R2 精确标准本地收口  
> 当前路线：`POD-PFC-001/M2/R2/standard-local-migration-authorization`

## 范围与状态

| 子任务 | 范围                                           | 实施状态      | 集成状态         | 验收状态  |
| ------ | ---------------------------------------------- | ------------- | ---------------- | --------- |
| R2-T1  | 协议、领域、migration、repository 骨架         | `IMPLEMENTED` | `LOCAL_VERIFIED` | `BLOCKED` |
| R2-T2  | 隔离胶囊、workspace-write session、会话池      | `IMPLEMENTED` | `LOCAL_VERIFIED` | `BLOCKED` |
| R2-T3  | 审批请求、人员决策、Bridge 回送                | `IMPLEMENTED` | `LOCAL_VERIFIED` | `BLOCKED` |
| R2-T4  | 取消、UNKNOWN 核验、重试、Bridge 撤销、审计    | `IMPLEMENTED` | `LOCAL_VERIFIED` | `BLOCKED` |
| R2-T5  | UI Kit、作业详情、审批、Bridge、Skills、审计   | `IMPLEMENTED` | `LOCAL_VERIFIED` | `BLOCKED` |
| R2-T6  | migration、真实本地链路、浏览器验收、Full Gate | `PARTIAL`     | `BLOCKED`        | `BLOCKED` |

## 已验证事实

- 固定依赖安装完成，`package-lock.json` 未变化。
- `RUN_START` 已成为平台写作业和写重试的确定性前置审批；批准前零启动命令，批准事务内唯一创建启动命令，拒绝/过期/取消不创建启动命令。启动审批不接受 App Server identity，且批准范围必须与已展示并绑定的固定 RunScope 完全一致。
- 聚焦 contract/domain/application/UI/architecture 测试 31/31 通过；R2 PostgreSQL/API/Bridge/control 集成测试 29/29 通过，完整 persistence 文件 13/13 通过。
- workspace-write adapter 使用胶囊作为唯一 writable root，网络关闭；Bridge session pool 上限为 3。
- 真实 App Server `0.153.4` 三场景隔离烟测已通过：平台批准后胶囊仅改 1 个授权文件；平台拒绝时不创建胶囊、不启动 App Server；批准后取消在 `TURN_STARTED` 后中断。App Server 自身审批请求仍为 0，但已不再承担平台前置门禁。
- 注册源工作区 hash 未变化；两个 App Server thread 均删除，合成源目录、胶囊和 App Server 均已清理。
- Quick/Full Gate 的 unit/contract 阶段 PASS：66 files / 303 tests。Core/Full Gate 的 integration 阶段 PASS：22 files / 101 tests；build、PostgreSQL、测试 schema 清理、权限、并发、恢复、安全、性能、36 项 PC 浏览器回归和依赖审计均通过。
- 修订 migration 已通过隔离 schema 验证；尚未向标准 `pfc` schema 应用。

## 当前工作与阻断

- 方案 A 已确认，R2-T1/T3/T5 返工及 R2-T6 的隔离 App Server/Full Gate 部分已完成。
- 2026-09-07 已按 AI-UX-R1 分阶段执行授权包完成 Stage 0：项目固定 Node `24.20.0`、npm `11.19.0`、依赖与 lockfile 存在，配置脱敏指纹为本机 `127.0.0.1:5432/pfc_local`，fixture 与体验模式关闭，PostgreSQL TCP 连通，Quick/Core/Full Gate dry-run 均为 `READY_TO_RUN`。
- `npm run db:migrate:m2-r2-preflight` 已零写通过，读回标准 `pfc` 中 004 已应用、005 未应用，`agent_runs` 与 `agent_run_commands` 存在且 `approval_requests` 不存在。
- 标准 `pfc` migration 仍未执行；提交精确命令 `npm run db:migrate:m2-r2` 时，上下文风险审查仍要求产品负责人直接点名本次 `pfc_local/pfc` 的 005 持久化 schema 写入。该拒绝不能绕过，因此分阶段执行在 Stage 1 强制停点暂停。
- 因 migration 未应用，标准库双账号、审批/审计/API 读回和 R2 专项浏览器链路均未执行；Full Gate 的通用 PC 回归不能替代这些验收。
- 代码评审、测试和安全验收人均已登记为陈立；是否将 R2 或 Unit 标记为 `ACCEPTED` 仍取决于各项结论本身，不因人员登记阻断。
- M2-R1 人工验收并行偏差仍存在，不因 R2 实施而自动关闭。

## AI 原生交互纠偏检查点

- 2026-09-07，产品负责人指出现有需求与受控作业页面仍以传统后台模块为主，要求先核验国内外最佳实践，再固化本平台 AI 原生产品作业交互基线。
- 行业研究和主 Spec 复核表明，目标应为“Agent 作业主界面 + 结构化成果画布 + 生命周期状态导航 + 可审计执行时间线”，不能降级为全局 AI 侧栏或 Chat-only。
- `AI-UX-D0` 已由产品负责人于 2026-09-07 在当前协作会话明确回复“同意”完成确认；目标固定为 Agent 作业主界面、结构化成果画布、生命周期状态导航和可审计执行时间线。
- `AI-UX-D1` 详细设计已由产品负责人于 2026-09-07 在当前协作会话明确回复“确认”；contract、状态机、PostgreSQL migration、API/SSE、真实 Codex Bridge、Skill、权限安全、测试数据和验收边界已固定。
- 产品负责人于 2026-09-07 在当前协作会话明确回复“确认 AI-UX-R1 分阶段执行授权包”；现已授权该包第 1-8 节内的 R2 精确 005 migration 与标准合成验收、AI-UX-R1 源码与隔离验证、短生命周期本地进程及合成上下文真实 Codex 请求。006/007 标准 `pfc` 落库、依赖变更、注册源写入、远程 Git、SIT/生产、发布和部署仍未授权。
- 本次设计纠偏不修改 5 个 CAP、26 个 Unit、M1-M3 成员、R2 实施结论或标准库阻断；当前 POD 唯一路线继续保持 `POD-PFC-001/M2/R2/standard-local-migration-authorization`。
- 设计文档通过 Prettier、UI 设计治理和交付治理检查；使用项目固定 Node `24.20.0` 的 Quick Gate 最终 `PASS`，66 个测试文件、303 项测试通过。首次沙箱内运行在 Vitest 启动阶段因 `spawn EPERM` 被阻断，未形成测试断言失败；相同命令经受控沙箱外重跑通过。
- AI-UX-D1 文档首轮直接调用 `npm.cmd` 时子脚本误用系统旧 Node，交付治理未进入检查逻辑；按项目规定注入固定 Node `24.20.0` 后重跑 `PASS`。本轮 Quick Gate 在沙箱内同样被 Vitest `spawn EPERM` 阻断，经受控沙箱外原命令重跑最终 `PASS`：66 个测试文件、303 项测试通过。
- D1 确认记录与 AI-UX-R1 分阶段执行授权包通过 Prettier、UI 设计治理和交付治理复核；使用固定 Node `24.20.0` 的 Quick Gate `PASS`：66 个测试文件、303 项测试通过。此次验证未启动业务服务、未执行 migration、未写数据库或调用 Bridge/Codex。

## 2026-09-07 标准本地收口

- 精确 migration `202609060005_create_m2_approval_control` 已应用到本机 `pfc_local/pfc` 并读回。
- `R2_REAL_20260907_A` 双账号标准事实已建立并保留；自批拒绝、批准成功、拒绝、取消和 UNKNOWN 核验均通过。
- 真实批准路径经 Bridge/Codex 写入胶囊，结果 `SUCCEEDED/PASS`；注册源 Git baseline 与目标文件保持不变。
- API、PostgreSQL 与三宽度 Web 读回通过；脱敏报告见 `docs/quality-gate/reports/2026-09-07-m2-r2-closeout.md`。
- Quick、Core、Full Gate 最终均 PASS；R2 集成状态为 `INTEGRATED`，具名 acceptance 继续 `BLOCKED`。
- Ledger 唯一路线已切换为 `POD-PFC-001/M2/AI-UX-R1/contracts-domain-security`。

## 后续顺序

`AI-UX-R1-A contracts/domain/security -> R1-B isolated persistence/API/SSE -> R1-C ProductWorkTurn -> R1-D UI Kit 与代表页 -> 006/007 标准 migration 精确授权`

## 进程与副作用

- 保留的本地 PostgreSQL：PID `25312`，端口 `5432`，用途为授权的标准本地持久化验证。
- API、Web、Bridge、Codex App Server、Edge 和测试 runner 当前未保留运行。
- 本次 Stage 0 未启动 API、Web、Bridge、Codex App Server、浏览器或测试 runner；端口 5432 仅完成 TCP 与零写 migration 预检。
- 已执行本包精确授权的 005；未执行 006/007 标准落库、dependency change、注册源工作区写入、remote Git、SIT/生产、commit、push、merge、deploy。
