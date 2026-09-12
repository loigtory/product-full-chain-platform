# M2-R1 本地验证报告

> 状态：`INTEGRATED / AUTOMATED_GATES_PASS / ACCEPTANCE_BLOCKED`  
> 日期：2026-09-06  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 范围：`UNIT-PFC-02-02`、`UNIT-PFC-03-01/02`、`UNIT-PFC-04-04`

## 验证结论

| 验证项                              | 环境与数据                           | 结果                                                                                  |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| M2 聚焦回归                         | 本地合成对象，无数据库               | PASS，11 files / 62 tests                                                             |
| M2 PostgreSQL 仓储/API 集成         | `.env.local`，隔离 `codex_test_m2_*` | PASS，2 files / 9 tests；schema 已清理                                                |
| App Server 协议固定                 | 本机 `codex-cli 0.153.4`             | PASS，827 files；生成 bundle hash 由 `check:codex-protocol` 校验                      |
| 标准 `pfc` migration                | 本地 `pfc_local/pfc`                 | PASS，4 条 migration；最新 `202609060004_create_m2_agent_run`；M2 9 表/128 个约束读回 |
| 真实 Server/Bridge/Codex/Skill 链路 | 标准 `pfc` + 本机进程                | PASS，命令领取、Skill 加载、Codex 执行、27 条连续事件、FAILED 结果归档及 API 读回     |
| 1280/1440/1920 浏览器验收           | 真实标准库运行，不使用 fixture       | PASS，3 宽度无横向溢出、无遮挡、无裁切、0 console error；终态按预期显示“失败”         |
| Quick Gate                          | 项目 Node 24.20.0                    | PASS，60 files / 276 tests；配置、协议、台账、UI、lint、格式、类型全部通过            |
| Core Gate                           | 项目 Node 24.20.0 + `pfc_local`      | PASS，20 files / 87 integration tests；0 残留测试 schema；生产构建和数据库检查通过    |
| Full Gate                           | 本机 PC 环境                         | PASS；权限 44、并发 20、恢复 32、安全 25、性能 3、Playwright 36，依赖漏洞 0           |

真实作业 `CODEx_TEST_M2_R1_REAL_20260906_agent-run-42e3f082-0b34-4cfd-b5e1-a60433fd1e29` 的 `FAILED / AGENT_RESULT_BLOCKED` 是业务检查结果，不是集成失败。固定 Skill 确认目标文件、内容 hash 和 Git baseline 匹配，但该评估记录引用的支撑准入报告不在授权相对路径内，因此 fail-closed；最后一条 Agent 消息与结果摘要一致。

## 测试数据与安全

- 场景来源：`packages/test-data` 确定性 M2 factory；前缀 `CODEx_TEST_M2_`。标准库验收 runId 为 `R1_REAL_20260906`。
- 业务有效性：需求处于 G8，绑定真实方法库的 RDC 接入前向评估记录，适合验证只读产物复核、证据链不足和 fail-closed 归档。
- 隔离策略：自动化数据库测试只允许 `codex_test_m2_*` 并清理；标准 `pfc` 仅保留明确的本地验收记录与诊断运行，供重启和人工读回。
- 权限与状态：覆盖认证、团队角色、只读强制、Bridge 凭据摘要、配对重放、快照有效期、Git/Skill 哈希及 Codex harness 漂移、事件有界背压、事件所有权和 UNKNOWN。
- 敏感数据：凭据值不写报告、源码或 UI；本地 Bridge credential 仅允许 `.local` 文件并由 `.gitignore` 排除。
- 本地写入：经授权向标准 `pfc` 写入 1 条 M2 migration、1 个本地账号、固定 SkillRelease、`CODEx_TEST_M2_R1_REAL_20260906_` 验收对象、诊断运行及审计事件；这些数据保留供本地体验和复核。
- 外部副作用：无 commit、push、deploy、远程数据库/网络写或客户数据。

## 未完成项与残余风险

- 服务重启读回 PASS：固定 runId 在 PostgreSQL 中仍为 `FAILED / AGENT_RESULT_BLOCKED`，27 条事件连续，thread/turn/result 齐全，结果与末条 Agent 消息一致；重新登录 UI 后 1280/1440/1920 均无溢出、遮挡、裁切或控制台错误。
- 当前 R1 每个需求只允许一个活跃的 `WORKSPACE_RELATIVE` 当前产物，尚未提供从多个候选产物中显式选择的 UI/API；后续版本需扩展目标选择并保持同样的 hash/path 校验。
- `WARN` 当前作为成功终态归档，`BLOCKED` 映射为 `FAILED`；报告正文保留真实首行，但尚无独立 `resultOutcome` 字段，后续应拆分“执行状态”和“业务结论”。
- Bridge 对瞬时网络/5xx 进行重试，但还没有独立的 DEGRADED 健康状态和运维告警；恢复治理属于 M2 后续 Unit。
- Codex App Server 的 `readOnly` sandbox 禁止写入并关闭网络，但不是 OS 级目录读取白名单。Bridge 已对注册 workspace、授权 scope 和目标 artifact 的规范路径做三层校验；当前仍只允许非客户本地资料。在补齐独立 checkout/AppContainer 等强隔离前，不得把 R1 宣称为可安全处理敏感资料。
- Zed 只证明配置可检测，未证明界面可见打开或 ACP 已连接；完整交接仍属 M3。
- 代码评审、测试、安全：`陈立`，均未登记结论；产品人工验收、发布授权和观察窗口均未开始。

协议生成首次尝试把 827 个文件一次性交给 Prettier，触发 Windows 命令行长度错误 `os error 206`；随后按“先生成、再对目录格式化”分成两个命令，生成物 hash、类型检查和 Quick Gate 均通过。该处理已固化在 `packages/codex-adapter/PROTOCOL.md`。

最终门禁共出现两次启动性失败：首次 Quick 子进程误用系统 Node `18.17.1`，被 `NODE_VERSION_MISMATCH` fail-fast；第二次 Quick 在格式检查发现遗漏的 M2 pairing client 测试文件。显式激活项目 Node `24.20.0` 并机械格式化后，Quick、Core、Full 均从头重跑并通过；没有绕过或 allowlist。

交付前代码评审另发现授权目录中的符号链接或 Windows junction 可使词法路径检查失效。文件检查器现先对注册 workspace、授权 scope 和目标文件执行 `realpath`，确认三层规范路径仍逐级包含后才读取和计算 hash；范围逃逸与不可读分别以 `ARTIFACT_PATH_OUTSIDE_SCOPE`、`ARTIFACT_NOT_READABLE` 拒绝。新增 6 条回归断言后，Full Gate 从头重跑通过。

浏览器证据位于 `output/playwright/m2-r1-real/`，包含需求入口、作业详情三个宽度、Skill 目录和 Bridge 中心截图；结构化结果位于 gitignored `.local/m2-acceptance/browser-result.json`。截图和本地登录文件仅供本机验收，不进入版本库。

## 保留进程

| PID     | 端口              | 用途                    | 停止命令                                                                                                                                                                          |
| ------- | ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `25312` | `127.0.0.1:5432`  | 本地 PostgreSQL 18      | `& "C:\Users\hz19114673\AppData\Local\PFCPlatform\.tools\postgresql-18.6\bin\pg_ctl.exe" stop -D "C:\Users\hz19114673\AppData\Local\PFCPlatform\.local\postgres-data" -m fast -w` |
| `26140` | `127.0.0.1:3001`  | Fastify API             | `Stop-Process -Id 26140`                                                                                                                                                          |
| `19484` | `127.0.0.1:5173`  | Vite PC Web             | `Stop-Process -Id 19484`                                                                                                                                                          |
| `26036` | 无监听，连接 3001 | 本地只读 Bridge / Codex | `Stop-Process -Id 26036`                                                                                                                                                          |

Playwright、测试 runner 和门禁临时 Vite 均已退出。保留进程的 stderr 日志位于 gitignored `.local/logs/`，最终审计长度均为 0。

本报告支持上述 4 个 Unit 达到真实本地 `INTEGRATED`；不支持 `ACCEPTED`、`RELEASED`、M2 完成或“平台已完成”结论。
