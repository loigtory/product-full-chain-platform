# M2-R2 真实依赖阻断与局部验证报告

> 日期：2026-09-07  
> Parent POD / Milestone：`POD-PFC-001 / M2`  
> 范围：R2-T1 至 T6 当前候选  
> 总结论：`BLOCKED`  
> 阻断：App Server 的文件审批请求不是确定性事件，当前写运行可在审批请求数为 0 时修改隔离胶囊。

## 验证环境与数据策略

- 运行时：项目固定 Node `24.20.0`、Codex App Server `0.153.4`、本机 PostgreSQL `pfc_local`。
- 配置来源：忽略文件 `.env.local`；报告只记录 key 名，不记录 binary 路径、数据库 URL 或凭据。
- 数据来源：`CODEx_TEST_` 合成本地文件和自动清理的 `codex_test_*` schema；未使用 fixture 作为产品事实。
- 真实外部副作用授权：无。未执行注册源工作区写入、远程 Git、SIT/生产、部署或发布。

## 执行结果

| 检查                               | 命令/证据                                             | 结果                                                                            |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Quick Gate                         | `npm.cmd run test:gate:quick`（固定 Node PATH）       | PASS；66 files，301 tests                                                       |
| Core Gate                          | `npm.cmd run test:gate:core`（固定 Node PATH）        | PASS；unit/contract 301，integration 100，build PASS，测试 schema `remaining=0` |
| R2 聚焦 API/DB                     | R2 的 5 个 isolation integration files                | PASS；28/28                                                                     |
| R2 聚焦 contract/domain/adapter/UI | 13 个 R2 files                                        | PASS；64/64                                                                     |
| UI 治理                            | `node scripts/check-ui-governance.mjs`                | PASS；`raw_visual_values=0`                                                     |
| R1 App Server 对照                 | `.local/m2-spikes/20260907-r2/r1-control-result.json` | PASS；只读 marker、同线程恢复、interrupt、thread delete 均通过                  |
| R2 App Server 写入                 | `.local/m2-spikes/20260907-r2/app-server-result.json` | **FAIL CLOSED**；`M2_R2_APPROVAL_NOT_REQUESTED`                                 |

## R2 真实烟测读回

- runId：`CODEx_TEST_M2_R2_APP_SERVER_baf175d22caf`。
- App Server transport：`SUCCEEDED`。
- approval count：`0`；approval kinds：空。
- 胶囊变更：`1` 个文件，仅 `docs/requirements/acceptance.md`。
- 源工作区：前后 hash 一致。
- manifest：before/after hash 不同，证明真实胶囊写入发生。
- thread：删除成功；仅保留 thread id 的 16 位 SHA-256 摘要。
- 临时数据：App Server 已关闭；合成源目录和胶囊已清理。

该结果不是 R2 写入 PASS。它只证明隔离与真实写入有效，同时证明原设计的四眼触发假设无效。

## 缺陷与修正状态

1. `thread/start`/`turn/start` 在固定 `0.153.4` 上拒绝冗余 `runtimeWorkspaceRoots`，而 `cwd` 与 `workspaceWrite.writableRoots` 可正常建立唯一写入边界；已移除冗余参数，禁网和 writable root 未放宽。
2. Windows 结束 App Server 后胶囊目录可能短暂 `EBUSY`；`RunCapsuleManager` 已使用 15 秒有界重试，并删除每个执行对应的空 run 父目录。本轮遗留的全部精确 `CODEx_TEST_M2_R2_*` 空目录已清理。
3. JSONL request error 原来丢失方法名；现只保留 request method 和数值错误码，不保留服务端 message、参数、路径或 stderr。
4. 权限动作稳定契约测试遗漏 R2 新动作；已更新并由 Quick/Core Gate 验证。

## 阻断与残余风险

- 待产品负责人确认 `POD-PFC-001-M2-R2-platform-start-approval-amendment-20260907.md` 的方案 A：平台 `RUN_START` 前置审批，批准事务提交前启动命令必须为 0。
- 标准 `pfc` migration 未应用；标准库双账号、审批、审计、文件和 diff hash 尚未形成真实读回。
- 浏览器 1280/1440/1920 和人工视觉验收未执行；Full Gate 未运行。
- 代码评审、测试、安全 owner 仍为 `陈立`，R2 不得标记 `ACCEPTED`。
- M1/M2-R1 已接受的并行验收偏差仍独立存在。

## 下一路线

`POD-PFC-001/M2/R2/platform-start-approval-amendment-confirmation`

确认后返工 R2-T1/T3/T5，隔离验证通过后再进入 R2-T6 的标准库 migration、双账号真实链路、浏览器和 Full Gate。未确认前写入口保持不可验收，R3 不启动。
