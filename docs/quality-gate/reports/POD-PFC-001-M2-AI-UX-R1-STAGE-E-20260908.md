# POD-PFC-001 M2 AI-UX-R1 Stage E E1-E3 验证报告

> 日期：2026-09-08  
> 环境：本机 loopback / PostgreSQL `pfc_local` 隔离 `codex_test_aiux_*` schema  
> 数据：确定性合成数据，ID 前缀 `CODEx_TEST_AIUX_`  
> 结论：`LOCAL_VERIFIED / STANDARD_INTEGRATION_NOT_AUTHORIZED / ACCEPTANCE_BLOCKED`

## 范围与状态

- Parent POD / Milestone：`POD-PFC-001 / M2`。
- CAP/Unit：横切 `CAP-PFC-01/02/03/04`，不改变权威 5 CAP / 26 Unit 集合与 Unit 状态。
- Implementation：Stage E E1-E3 `LOCAL_VERIFIED`。
- Integration：隔离 PostgreSQL、Fastify/SSE、Bridge、真实 Codex App Server、PC Web `LOCAL_VERIFIED`；标准 `pfc` 业务首轮尚未执行。
- Acceptance：Stage D 视觉验收已确认；标准首轮与实名代码评审/测试/安全结论缺失，AI-UX-R1 总体验收保持 `BLOCKED`。
- Release / observation：`NOT_AUTHORIZED / NOT_STARTED`。
- POD next route：`POD-PFC-001/M2/AI-UX-R1/standard-local-execution-authorization-package`。

## 验证覆盖

| 场景                | 数据与环境                | 关键断言                                                                                | 结果 |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------- | ---- |
| 空会话首轮          | API + isolated PostgreSQL | 无历史 turn 即返回材料/Skill 推荐；读取不创建 turn/command                              | PASS |
| Bridge/Skill 同快照 | isolated PostgreSQL       | releaseId/contentHash/协议/harness 同时匹配；最新快照格式无效或过期时不回退             | PASS |
| 多 Skill 与材料子集 | unit/UI                   | 多 Skill 必须人工选择；移除 RESTRICTED 后 INTERNAL 子集可提交                           | PASS |
| 精确授权            | API/UI                    | PM 无 grant 权限；Owner grant/revoke 幂等；有效 exact grant 刷新后仍可恢复              | PASS |
| 首回合执行          | real local Bridge/Codex   | readiness READY 后完成回合，持久化可见回复、事件和外部引用                              | PASS |
| 取消与未知恢复      | real local Bridge/Codex   | `CANCELLED`；超时收敛为 `UNKNOWN/BLOCKED -> VERIFY_TURN`                                | PASS |
| PC 视觉与交互       | Edge 1280/1440/1920       | 页面真实路由、提交、字体、无横向/面板溢出、零 console error                             | PASS |
| 清理与敏感数据      | local                     | schema remaining=0；owned App Server/Fastify/Vite/Edge closed；报告不含正文/凭据/连接串 | PASS |

## 命令证据

最终门禁结果以本报告收口后的命令输出为准：

- `npm run check:types`：PASS。
- 定向 Vitest：readiness/domain/API/UI/architecture PASS。
- `npm run test:ai-ux:r1:c:live -- --output docs/quality-gate/reports/POD-PFC-001-M2-AI-UX-R1-STAGE-E-isolated-bridge-codex-20260908.json`：PASS；`COMPLETED/CANCELLED/UNKNOWN` 三类结果及 `schemaRemainingTableCount=0`。
- `npm run test:gate:full`：PASS；76 个文件 / 344 项 unit+contract、26 个文件 / 119 项 integration、44 项 permission、20 项 concurrency、32 项 recovery、25 项 security、3 项 performance、39 项 PC E2E 全部通过；11 项安全扫描零发现，依赖审计 0 漏洞，测试 schema remaining=0。

## 失败与修复记录

1. 新 E2E 首次进入旧工作台，因为测试环境变量覆盖了真实 work-session route；修复为只对该认证路由放行，1280/1440/1920 全部通过。
2. 旧 live harness 只更新 Skill 表哈希，未同步 synthetic Bridge snapshot；同快照校验正确失败为 `BRIDGE_CAPABILITY_UNAVAILABLE`。修复测试装配并在提交前断言 readiness。
3. UI 传输状态最初按全部候选保留授权阻断；补充材料子集用例后修复为按当前选择映射，服务端 submit 仍二次鉴权。
4. repository 首次会忽略已过期的最新快照并回退旧快照；新增红测后改为先锁定最新快照，再判断有效期。
5. Stage E 逻辑最初继续堆入超大 lifecycle service；已抽出 readiness application service，并用架构测试限制回流。

## 边界与剩余风险

- 没有标准 `pfc` 业务行写入、功能开关修改、migration、`.env.local` 修改、依赖安装、commit/push/merge、SIT/生产、部署或发布。
- Browser 插件在本会话不可用，按前端测试技能降级规则使用仓库既有 Playwright + Edge；没有降低分辨率、交互或截图验收范围。
- 性能仅为本地 smoke；尚无 20 个真实回合的 p95 观察数据。
- Zed 交接、MCP 动态工具、CAP-PFC-05、标准本地首轮、发布后观察仍属后续范围。
- 代码评审：陈立；测试：陈立；安全：陈立。责任人已登记，各项结论仍以实际证据为准；未完成产品验收或发布证据前不得宣称发布就绪。
