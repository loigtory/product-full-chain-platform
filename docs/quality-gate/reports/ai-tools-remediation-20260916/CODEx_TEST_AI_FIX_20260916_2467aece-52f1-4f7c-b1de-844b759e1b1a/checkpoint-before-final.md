# 47 · 控制与验收修复实施检查点

> 实际开工日期 2026-09-17；文件名沿用 46 已确认白名单。状态 IN_PROGRESS，未验收/未发布。当前 feature 基线 `2ce418c0ad542a3c84acb88738f464ad8ee4e329`。

## 确认与范围

用户对 46 号的具体补充包回复“确认”，覆盖 A1–A5、38 个源码/测试路径、七份实施文档、三个指定隔离 schema/临时恢复环境、最多 8 次真实模型调用、当前 feature 的本地开工/收工提交。主线、交互、数据/调用限额和停止条件按 46；不重复询问已经确认的包内操作。

授权及方案 hash：[authorization.json](../../quality-gate/reports/ai-tools-remediation-20260916/CODEx_TEST_AI_FIX_20260916_2467aece-52f1-4f7c-b1de-844b759e1b1a/authorization.json)。保护基线为同目录 `protected-baseline.json`，共 3894 文件；26 份既有源码指纹全部匹配，12 个新路径均不存在。runId 为 `CODEx_TEST_AI_FIX_20260916_2467aece-52f1-4f7c-b1de-844b759e1b1a`。

本轮为 system iteration/strict。父级 `POD-PFC-001 / M2`，保留 5 CAP / 26 Unit；正式 next route 仍为 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`。本轮只处理 F1–F5，44 的材料/联产/LOCAL_RUNNER 业务闭环仍有后续工作。

## 执行计划

| 步骤 | 状态 | 验收依据 |
| --- | --- | --- |
| R1.0 基线/环境/开工提交 | 进行中 | 26 源码 + 3894 保护指纹、依赖、隔离目标、授权记录 |
| R1.1 停止/终态/证据/预算 | 待实施 | 先复现失败，再通过确定性回归 |
| R1.2 执行审批/上下文/UI | 待实施 | 协议桩、真实 PG/API 与实际工具能力分别核实 |
| R1.3 006/007 备份恢复 | 待实施 | 合成源备份、5549 隔离恢复、文件与数据独立读回 |
| R1.4 综合闸/差异/清理 | 待实施 | 新专项 + 九条原型基础闸，真实调用不超过八次 |

## 已执行核验

- `git status --short --branch`：当前 `feat/ai-tools-integration`；仅携带上轮六份方案/入口文档及两份 JSON，无其他未提交改动。
- `git ls-remote --heads origin refs/heads/main refs/heads/feat/ai-tools-integration`：默认沙箱网络失败后，受审核的只读查询成功，main=`a20e16e53fa0d5661bd81f830749864a31dba3fd`，feature 未公布。未推送、未合并。
- 固定 Node `--version`：v24.20.0；已安装 express/pg/ws/jsonwebtoken/eslint/prettier/playwright 解析成功，无依赖安装。
- `node scripts/run-gate.mjs quick --dry-run`：READY_TO_RUN，仅规划，不是 Quick PASS。

## 数据、进程和诚实边界

执行数据设计沿用 46 第五、六节：确定性合成工厂，准确的 schema/端口/目录、runId/createdIds、状态/角色/版本负例、finally 清理与独立读回。现有个人 5188、验证 5199、PostgreSQL 5432 均保留。尚未创建测试库/服务，未调用模型。

只建立本轮拥有的短期 API/浏览器/worker/恢复 cluster；无子代理。旧账本不清零、不冲销，新增八次额度独立记账。真实协议若不能在执行前约束所有工具，EXEC 闸保留 BLOCKED，继续不依赖它的工作；不以 CLI 自动放行替代。

实现、集成、人工验收、启用和发布分开记录。本轮未承诺个人 5188 的版本切换、备份操作或生产发布；最终陈立按提交、差异和可复现实操证据验收。无上线观察结论。

## R1 中途核验

本地开工提交 c1d22ac。模型回归先 FAIL 8/8、修复后 PASS 8/8；后续 worker/protocol 变更仍待集成验证。新增三个隔离 schema 被白名单外 connection.js 明确拒绝，preflight.js 又固定报告 006；两个文件最小补充已列在本轮 scope-amendment-connection-preflight.json，待用户确认，尚未修改它们，未绕过目标校验。继续白名单内的独立修复。

用户已回复“同意补入这两个文件”。白名单增至 40 个源码/测试路径；其余额度、目标与禁令不变。批准记录 scope-amendment-connection-preflight-confirmed.json；原方案和 3894 保护指纹保留，核验时只将这两个明确补充路径单独对照批准前 SHA。

用户已确认临时启动 pfc-postgresql-18，仅本轮隔离测试；结束清理并确认无其他客户端后恢复原 Stopped。service-start-confirmed.json 为具体授权。既有 5188/5199 不启动。已完成真实 TEXT 4 次：正常、取消、并行两次；19 秒结算，未决 0。EXEC 和真实业务链仍 BLOCKED。

## 2026-09-17 持续执行检查点（取代上文开工时状态）

- R1.0 已完成，本地开工提交 `c1d22ac`；40 个源码/测试路径有效，两个文件及临时服务操作均已获用户明确补充确认。
- R1.1/R1.2 已实现停止事务、lease 终态约束、服务端上下文、独立预算与失败关闭。最近模型 12 项、PG/API/worker 8 项通过；随后增加的新回归和会员权限/退出收尾检查尚需重跑。真实审批协议无法证明全工具执行前覆盖，EXEC 保持 BLOCKED。
- R1.3 首次实际 006 备份/5549 恢复通过，007 暴露 manifest 固定 006，已修复；现用合成附件及 007 作业历史重跑。此前失败原始证据保留。
- R1.4 尚未完成。浏览器旧报告仅模拟域接口，不能代表 PG/WS 集成；主宽度改为 46 规定的 1280/1440/1920 并增加溢出断言，待复测。九条基础闸及最终范围/格式/差异检查待执行。
- 已启动的 `pfc-postgresql-18` 当前为 Running，只用于三处隔离 schema；结束必须独立确认 schema/文件/进程清理及无其他客户端后恢复 Stopped。5188/5199 保持未启动。真实模型已用 4/8 次、19 秒，无未决；唯一一次双作业并行已用，不得重跑该并行场景。
- 当前源代码未完成收工提交；不标记完整验收、发布或主线完成。
