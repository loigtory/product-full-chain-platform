# POD-PFC-001 M2-R1 实施检查点

> 状态：`INTEGRATED / ACCEPTANCE_BLOCKED / RELEASE_NOT_AUTHORIZED`  
> 日期：2026-09-06  
> 迭代分类：严格系统迭代，涉及本地工具进程、权限、协议、API、PostgreSQL、Skill 和 PC UI。  
> 设计依据：`POD-PFC-001-M2-controlled-agent-work-design-20260906.md`（`DESIGN_CONFIRMED`）

## 交付定位

| 字段       | 内容                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| Parent POD | `POD-PFC-001`                                                                          |
| 当前里程碑 | `M2`；M1 仍为 `IN_PROGRESS / ACCEPTANCE_BLOCKED`                                       |
| CAP / Unit | `CAP-PFC-02 / 02-02`、`CAP-PFC-03 / 03-01～02`、`CAP-PFC-04 / 04-04`                   |
| 权威版本   | 主 Spec `V0.1/R3`                                                                      |
| 实现状态   | 上述 4 个 Unit 为 `INTEGRATED`                                                         |
| 集成状态   | `INTEGRATED`；标准 `pfc` 数据已贯通 Server、Bridge、固定 Skill 和真实 Codex App Server |
| 验收状态   | `BLOCKED`；自动化视觉检查通过，具名评审、安全、测试和产品人工验收尚未完成              |
| 依赖来源   | 标准本地 PostgreSQL + 本机 Codex App Server `0.153.4`；Zed 仍为 `DETECTED/UNVERIFIED`  |

## 当前版本

- 目标：从当前需求基线、已验证工作区和固定 SkillRelease 创建只读 AgentRun，经本机 Bridge 调用 Codex App Server 并回传事件。
- 非目标：工作区写入、审批、取消恢复、MCP 调用、完整 Web/Zed 交接、远程环境和发布。
- 已实现：版本化 Bridge 协议、AgentRun 状态模型、M2 migration/repository、Server API、HTTP Bridge、Codex adapter、固定只读 Skill、作业/Bridge/Skills 页面和需求详情启动入口。
- 协议固定：本机 CLI 已复核为 `0.153.4`，827 个 TypeScript 绑定由 CLI 生成、格式化并以 bundle hash 受门禁保护；adapter 的 initialize/thread/start/turn/start 参数直接受生成类型约束。
- 安全收口：创建、选项读取和命令领取均校验未过期能力快照、Bridge 在线状态、工作区 Git 基线、Skill 发布 ID/哈希/启用状态及 Codex major/minor 兼容性；浏览器不能提交 Git 基线或本地路径。
- 容量边界：App Server 事件投递使用最多 100 条待处理事件的有界队列；溢出立即终止本次 adapter 结果并由 Bridge 归为 `UNKNOWN`，不继续无界占用内存。
- 配对边界：配对码一次性使用，持久化仅保存摘要；本地凭据只写入 gitignored `.local` 文件，API/UI 不回显凭据。
- 真实链路：标准 `pfc` 已应用 M2 migration，固定 SkillRelease 已注册，Bridge 已配对并上报 Codex `0.153.4` 能力。运行 `CODEx_TEST_M2_R1_REAL_20260906_agent-run-42e3f082-0b34-4cfd-b5e1-a60433fd1e29` 产生 27 条连续事件，终态 `FAILED / AGENT_RESULT_BLOCKED`，最后一条 Agent 消息与归档结果一致。
- 结果语义：本次 `BLOCKED` 是被检产物证据链确有缺口，不是链路失败。Skill 复核了产物路径、SHA-256 和 Git 基线，并指出评估结论引用的支撑准入报告不在授权路径内；平台按 fail-closed 归档，未制造 PASS。
- 运行期修复：补齐产物版本/路径/hash 绑定；强制 App Server 加载精确固定 Skill；解析 Skill 首行状态；允许 2000 字符 Agent 消息；Bridge 对瞬时 5xx/fetch 失败可恢复；FAILED 结果同样归档末条 Agent 消息。
- R1 退出条件：实现、真实本地集成、服务重启读回和自动化视觉检查已满足；产品人工视觉验收和具名工程验收仍未满足，因此不进入 `ACCEPTED`。

## 数据与验证

- 测试数据 factory：`createM2R1TestData(runId)`，标识前缀 `CODEx_TEST_M2_`，只允许进入可清理的 `codex_test_m2_*` schema。
- 覆盖场景：当前基线、Bridge 在线和降级、快照过期、Git/Skill 哈希漂移、配对重放、命令租约、事件去重/序号缺口、UNKNOWN、只读拒绝边界和角色权限。
- 确定性标准库验收数据：runId `R1_REAL_20260906`，业务对象均使用 `CODEx_TEST_M2_R1_REAL_20260906_` 前缀；数据保留供本地体验和复核，不含客户数据。
- 目标产物：`evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md`；版本 `CODEx_TEST_M2_R1_REAL_20260906_ARTIFACT_VERSION_EVAL`；内容 hash `sha256:d2c9f1ae39b8ebb09c51ce4a6dd506083e363473582da5222ac6e962756c3560`。
- 测试 schema 由 factory 创建并在测试结束后清理；标准 `pfc` 只保留明确的本地体验/验收对象、失败诊断运行和审计事件，以便重启读回。
- `package-lock.json` 已由项目固定 npm 同步，新增 workspace 可由 `npm ci` 复现。
- 完整门禁结果见 `docs/quality-gate/reports/2026-09-06-m2-r1-local-verification.md`。

## 授权及执行边界

- PostgreSQL 使用仓库内二进制与 `%LOCALAPPDATA%\PFCPlatform` 当前用户 junction，绑定 `127.0.0.1:5432`；不依赖管理员服务控制权限。
- 2026-09-06 16:26（UTC+08:00）用户确认本轮授权：启动本地 PostgreSQL；同步依赖锁文件；向标准 `pfc` schema 应用 M2 migration 并注册固定 SkillRelease；启动真实 Server/Web/Bridge/Codex 链路并运行浏览器视觉验收和 Full Gate。
- 授权仅适用于本机 `pfc_local`、固定 M2 migration、`pfc-readonly-artifact-check` SkillRelease 和本轮 `CODEx_TEST_` 数据；不包含 commit、push、deploy、远程写入、客户数据或扩大 Bridge 写权限。
- 停止条件：目标数据库指纹不符、迁移预检失败、非测试数据可能被覆盖、凭据将被回显或落入受跟踪文件、Bridge/Codex 无法保持 read-only、Full Gate 发现安全或数据清理失败。
- 真实链路验证不得回退到 fixture 或 `pfc_experience` 数据；所有测试数据必须记录 runId、createdIds、读回及清理状态。
- 代码评审、测试和安全责任人均已登记为陈立。本检查点形成时尚未记录相应人工结论；自动化验收不替代这些结论。发布和观察均未开始。

## POD 回写

- `UNIT-PFC-02-02`、`UNIT-PFC-03-01/02`、`UNIT-PFC-04-04`：`LOCAL_VERIFIED -> INTEGRATED`。
- M2：保持 `IN_PROGRESS`；11 个 Unit 的跨 CAP 退出条件远未满足。
- M1：保持 `IN_PROGRESS / ACCEPTANCE_BLOCKED`，M2 结果不覆盖 M1 缺口。
- 平台总体：`PARTIAL / M1_INTEGRATED_M2_IMPLEMENTING / ACCEPTANCE_BLOCKED / RELEASE_NOT_AUTHORIZED`。
- 唯一下一路线：`POD-PFC-001/M2/R2/write-approval-cancel-design-confirmation`。R2 只进入方案确认，未授权工作区写入、审批或取消副作用。

## 轻量复盘

- 返工次数：10。除早期 4 项外，真实链路进一步发现并修复了假成功、运行未绑定精确产物、Agent 消息 API 长度不一致、Server 短暂重启导致 Bridge 退出、长结果在 1280 宽度裁切、符号链接/junction 可绕过词法授权范围等问题。
- 防回归：新增注册 workspace、授权 scope、产物路径/hash 的三层 `realpath` 规范路径绑定、固定 Skill 运行时加载验证、结果首行状态解析、FAILED 结果归档、2000 字符 Agent 消息、Bridge 瞬时故障恢复、预期失败浏览器验收和多宽度裁切检查。
- 已知安全边界：Codex App Server `readOnly` 禁写/禁网，但不构成 OS 级目录读取白名单；R1 仅用于非客户本地资料，敏感资料接入前必须设计并验证独立 checkout 或 Windows AppContainer 等强隔离。
- 失败运行：诊断运行与最终真实 `BLOCKED` 运行均保留在标准 `pfc`，用于证明 fail-closed 与可审计性；它们不是门禁测试失败。
- 发布后问题：不适用，尚未发布。
