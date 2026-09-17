# 真实工具执行：宿主控制补充方案（待确认）

2026-09-17；基线 **227ca65**，工作区核查干净后开展。本轮仅无生成协议核查与方案整理；**没有改产品源码、发模型请求、启动数据库或启用 EXEC**。这是 46/47 的后续补充，不把“继续”解释为接受未完成项或任意扩大范围。

## 已核实的可行入口

本机固定 Codex **0.154.0**（二进制 SHA256 be96b992178b1e467c225800da0d65f2c86d5eba1ef0b14632f65db381cbdfde）生成实验性 schema，七项结构检查通过。DynamicToolCallParams 必须包含 arguments/callId/threadId/turnId/tool，ThreadStartParams 支持 dynamicTools；CommandExecParams 的 command 是必填 argv 数组，并提供 sandboxPolicy、timeoutMs、processId 和输出上限。原始 schema 摘要和 hash 见 continuation-protocol-20260917.json。

官方说明动态工具由客户端响应，command/exec 使用服务器沙箱；process/spawn 与 thread/shellCommand 不属于同一沙箱路径。参见 [动态工具](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)、[命令执行](https://learn.chatgpt.com/docs/app-server#command-execution)。本文采用本机字段为准，在线文档中的额外权限字段不能直接假定此版本支持。

当前 protocol.mjs 拒绝所有服务端请求，conversation-provider.js 只允许文本项，execution-policy.js 固定关闭 EXEC；需要显式补接宿主请求分发。callId 与通知 item.id 的关联、原生工具禁用和 Windows 真实隔离尚未证明，**schema 检查通过不等于工具可用**。

## 方案选择

| 方案 | 具体方式 | 取舍 |
| --- | --- | --- |
| **A，推荐** | 保留现有 Codex/Express/PG：禁用模型原生副作用工具，注册五个 PFC 动态工具；宿主先校验后执行，固定命令只走带显式沙箱的 command/exec | 有完整结构化参数与逐次控制位置；需验证实验性协议及 Windows 隔离，不能预先承诺通过 |
| B，保留 | 继续补原生命令/文件审批回调，关联完整事件和变更后再决定 | 当前参数不足且执行前覆盖未证实，暂不放行；不能退回自动批准 |
| C，后备 | 另设独立隔离执行环境 | 会涉及新的环境/安装/运维边界，不在本补充包；仅当 A 的隔离实证失败后另行对齐 |

**推荐 A，选择待用户确认。** 没有供应商/模型切换，没有新依赖，仍从原版 index.html 工作台进入。材料与原型/PRD/AC 的既定方向不重问；本包解决阻断它们后续开发承接的执行控制，完成后回到 44 未完成业务链。

## 人机交互与实际执行

1. Owner 在当前开发需求确认工作区、允许文件、固定命令、版本、有效期和基线。已确认范围内连续执行不反复弹窗；越界只显示差异并等待新的明确决定。
2. 模型只看到 pfc_read_file、pfc_write_file、pfc_run_checks、pfc_git_status、pfc_git_diff。读写请求携带相对路径/内容/预期 hash，命令请求使用固定 commandId；cwd 和 argv 由服务器映射，不能提交任意解释器参数或客户端 approvedBy。
3. 每个请求必须对应已登记的 serverRequestId、threadId、turnId、callId 及经过实测的 item 关联。不能把 callId 直接冒充 itemId。先检查租户/Owner/当前阶段、lease、计划期限、上下文/文件 hash，再记录批准与执行；同一请求重复到达只返回原结果，不重放。
4. 写入使用当前独占工作区与逐文件所有权记录；拒绝路径穿越、盘符/UNC/ADS、链接/junction、超限与敏感路径。对既有文件要求预期 hash，新文件要求不存在；不提供任意删除工具。回收仅覆盖本作业拥有且未遭第三方改变的内容。
5. 固定命令只通过 command/exec 显式 sandboxPolicy 执行；禁止 process/spawn、thread/shellCommand、externalSandbox/dangerFullAccess、权限提升和自动 setup。清理后的最小环境不得传递 token/数据库连接。源码、测试及配置须列入冻结输入，不能仅以 argv 相同视为等价。
6. **OS 隔离是前置闸**：只在本轮合成 canary 上实际核实越界读/写、网络和进程收口，并核对隔离机制；单个 canary 被拒绝不足以宣称全目录隔离。若当前 Windows 无法证明边界，Shell 继续 BLOCKED，完成可独立验证的宿主控制部分并带回具体证据，不用提示词、Node permission 或事后回滚替代 OS 边界。
7. 停止先持久化取消，阻止新请求，然后中断模型、终止本轮 command processId 并等待结束，再归档 diff/退出码/时长。无法证明退出或恢复则 UNKNOWN；浏览器刷新读 PG 事实，禁止模型自行宣布测试通过。

本包的固定测试结果记为真实 tool_executions 证据；**不等于**完整 LOCAL_RUNNER 已写回产品套件/用例/缺陷。后者仍属 44 D6，需复用真实测试基线后接线。

## 精确实施与验证范围

机器清单：[host-exec-supplement-proposal-20260917.json](host-exec-supplement-proposal-20260917.json)。**31 个源码/测试路径（19 修改、12 新增）**逐项保存当前 hash 及与 44/46 的归属对照；8 项不在两份旧清单内。七份实施文档为 AGENTS、19、20、47、新 48、两个 README。48 文件在确认后创建，当前未越过旧白名单创建。

新实现证据只进入 docs/quality-gate/reports/ai-tools-host-exec-20260917/<runId>/；旧 44–47 证据不可覆盖，47 仅追加续接。原 SQL 001–007 和既有依赖复用；不改 SQL/依赖/系统配置/ACL/正式台账。R1 旧模型/API/运维测试复用断言，通过限定测试工厂/preload 写入新包目录，不能改原报告、把全部旧分支差异一概放行。

实施顺序：**P0 协议与隔离实证 → P1 请求绑定/审批/文件/取消 TDD → P2 PG/API/UI 接线 → P3 实际合成执行与回归 → P4 差异/清理/本地交付**。P0 不成立就停止相关执行路径；不额外花调用反复试错。无子代理，串行一组临时 API/浏览器/worker；进程与端口必须记录所有权，结束均关闭。

18 条实际入口在机器清单中逐项列出：六条新模型/协议/API/浏览器/真实/架构闸，三条受影响 R1 模型/API/运维闸，加 23 的九条基础闸。新 runner 默认 PLAN_ONLY，模型调用只在 --real 明确选择后执行。协议闸含配置禁用/native 工具负例、callId/item 关联、实际 command/exec 隔离与超时；API/UI 覆盖批准/拒绝、撤权、跨需求/租户、旧基线、重复请求和刷新；真实闸必须读回实际文件 diff、退出码、DB 事件和停止状态。全44/C4仍为后续整包退出条件。

## 需一次确认的资源补充

- **调用**：新增独立包最多 **8 次、每次 300 秒、总 2400 秒、全部串行**，失败/重试计入；不挪用 46 剩余一次、不改旧账本。前四次依次验证真实动态请求及拒绝、允许写入+固定测试、批准拒绝、取消；其余最多四次用于冲突/恢复/必要复测。每次派发前重核固定连接及已授权规则 SHA，超限即停。此为次数/时长上限，不是货币费用保证。
- **目标**：显式续用 codex_test_ai_fix_20260916_api/ops/browser 三个准确 schema（各不超过10000行）、5203/5204、006/007回归恢复5549/5205。每次先证实不存在或拥有，不清理不明旧对象。
- **服务**：仅此次补充任务临时启动 pfc-postgresql-18，初始须实测 Stopped；结束清理并确认无其他客户端后恢复 Stopped。5188/5199不启动，不修改个人业务库；若有其他客户端，不强停并报告。
- **文件**：新私有根 .local/ai-tools-host-exec-20260917/<runId>/；工作区50文件/5MiB、源及备份各100MiB。合成数据工厂明确Owner/非成员/Viewer、两版本、批准/拒绝/过期/撤权、越界/冲突/取消组合；记录runId/createdIds。回滚清理只触及本包拥有的文件/schema，报告和合成截图保留，凭据/原始运行文件清理。
- **Git**：保留当前 feat/ai-tools-integration，基于227ca65及本次文档草稿做本地开工/收工提交；提交前复核若被其他工具推进则重验。不推送、不合并main、不删分支。审批本包不等于接受R1或授权上线。

## 退出、风险与回退

技术退出需真实宿主请求→执行前校验→受限执行→PG/文件独立读回全部成立，最终源码指纹和完整适用闸一致，无未归属进程/数据。人工验收人为用户/陈立，审阅48、差异和具体证据后明确确认；自动通过不代签。保留实验性协议、当前Windows隔离和真实外部调用未测部分的风险状态。

本次不发布、不启用个人版本；发布冒烟、使用观察窗口与生产指标均未开始。失败回退为 EXEC 继续关闭，保护既有TEXT与R1修复；只回收拥有且未冲突的合成变更，不做整仓reset/checkout。每步记录耗时、失败闸、重试次数和缺陷来源供复盘。
