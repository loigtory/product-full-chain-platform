# CAP-PFC-01 T7 UI 整合与工程加固报告

> 执行时间：2026-09-05 08:00～08:31 +08:00  
> 分类：System Iteration / strict  
> 环境：Windows、本项目 Node `24.20.0` / npm `11.x`、本地 PostgreSQL 18、Microsoft Edge  
> 配置来源：忽略提交的 `.env.local`，仅记录 key 与脱敏结论，不记录值

## 1. 结论

- **T7 本地技术结论：PASS。** 当前代码上的 Quick、Core、Full 均已真实执行；最终 Full 输出 `GATE_PASS full`。
- **G9-A 正式接受：BLOCKED。** 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全人工结论。
- **发布与业务结论：NOT AUTHORIZED / NOT ACCEPTED。** 本轮没有 commit、push、merge、部署、默认 `pfc` migration、真实外部调用或生产写入。
- PFC-02/04 真实联调、G10 产品验收、一个工作日隔离观察、G11 发布授权和 G12 业务验收仍未执行，不能由本地 Full PASS 替代。

## 2. 实施范围

1. 新建/补齐对话框、问题抽屉、人工 GateRun 对话框统一实现初始焦点、Tab 边界约束、Escape 关闭和关闭后焦点恢复。
2. `<1120px` 显示桌面支持范围提示，并将侧栏下移避免遮挡；正式 PC 验收仍只覆盖 1280/1440/1920。
3. 页面实现波次从错误的 `W2` 修正为权威计划中的 `W3`。
4. Full gate 真实串行执行 core、权限、并发、恢复、静态安全、安全回归、性能 smoke、PC E2E 和依赖审计；任一步失败即停止。
5. 增加 T7 确定性性能 factory：1,000 条 Requirement、目标 Requirement 100 条时间线、10 并发读，以及同一 PASS 100 次重放。
6. 增加只读静态安全检查：示例配置、`.env` 忽略边界、loopback、Helmet/body limit/安全错误、浏览器存储、动态执行、浏览器分层、private key 和鉴权数据库 URL。

没有新增或升级依赖，没有改变 T1～T6 的业务状态机、API 或数据库 schema。

## 3. TDD 与评审证据

| 阶段            | 命令/检查                                                                   | 结果                                                                                      |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 浮层 RED        | 定向运行 `requirements-ui`、`question-drawer`、`gate-run-panel`             | 新增 4 条断言均按预期失败：缺 Escape、焦点恢复、Tab 约束和宽度提示                        |
| 浮层 GREEN      | 同上                                                                        | 3 files、18/18 PASS                                                                       |
| 安全/性能 RED   | 定向运行 `security-policy`、`local-budgets`                                 | 两套件因缺少安全模块和 T7 factory 按预期失败                                              |
| 安全/性能 GREEN | 同上                                                                        | 2 files、5/5 PASS                                                                         |
| 评审 RED/GREEN  | `requirements-ui.test.tsx`                                                  | `W3` 断言修复前 1/9 FAIL，修复后 9/9 PASS                                                 |
| 代码评审        | 聚焦正确性、回归、权限/敏感边界、门禁失真、资源清理；复核 T7 变更与确认设计 | 修复 1 个波次显示错误；修复后未发现待解决的代码问题                                       |
| 安全复核        | `npm run check:security` + 安全测试 + E2E storage/header 断言               | `SECURITY_CHECK_OK checks=10 findings=0`；5 files、24/24 PASS；未发现凭据或受保护正文泄露 |
| 视觉复核        | 查看最终 1280/1440/1920 全页截图；E2E 几何和文本溢出断言                    | W3 标识正确，无正文/侧栏重叠、无横向溢出、无关键文本裁切                                  |

代码评审人与安全评审人现统一登记为陈立；以上仍是本轮 AI/本地工程复核，不替代对应人工结论。

## 4. 最终门禁证据

统一运行时前置：将 `.tools/node-v24.20.0-win-x64` 置于当前 PowerShell `Path` 首位。

| 命令                                  | 当前结果                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`             | PASS；config/lint/format/type；26 个 unit/contract files，132/132 tests                                                                |
| `npm run test:gate:core`              | PASS；Quick、migration plan、9 个 integration files 49/49、cleanup `remaining=0`、server/web build、PostgreSQL loopback 读回           |
| `npm run test:gate:full -- --dry-run` | `READY_TO_RUN`；列出 18 个串行步骤；dry-run 未作为 PASS                                                                                |
| `npm run test:gate:full`              | **最终 PASS**；权限 44/44、并发 20/20、恢复 30/30、静态安全 0 finding、安全 24/24、性能 3/3、Edge 24/24、`npm audit` 0 vulnerabilities |
| `npm run db:test-cleanup-check`       | Full 后额外读回 PASS；`TEST_SCHEMA_CLEANUP_OK remaining=0`                                                                             |
| 定向 Edge `pc-1440x900` GateRun 用例  | 首轮 Full 导航超时后单独复现 PASS，2.4s                                                                                                |
| 最终 Edge PC 矩阵                     | 1280×720、1440×900、1920×1080 各 8 条，共 24/24 PASS；43.3s                                                                            |

最终 Full 对应 W3 当前代码。期间失败均未隐藏：首次 Full 的 1440×900 GateRun 用例在 `page.goto` 发生一次 30s 导航/上下文关闭超时，另外 23 条通过；同一用例定向复现 2.4s PASS，后续两次完整 E2E 矩阵均 24/24 PASS。没有放宽 timeout 或增加 retry。W3 修复后的首次 Full 在格式阶段提前失败，机械格式化后才取得最终完整 PASS。

## 5. 性能 smoke

以下为进程内 repository + Fastify inject 的本地工程预算，不是生产 SLA：

| 指标                                  | 实测 P95 | 预算       | 结论 |
| ------------------------------------- | -------- | ---------- | ---- |
| 1,000 条 Requirement、10 并发清单读取 | 11.90ms  | <= 500ms   | PASS |
| 需求详情读取                          | 1.85ms   | <= 800ms   | PASS |
| 100 条时间线、每页 50 条              | 1.53ms   | <= 800ms   | PASS |
| 100 条 SSE 重放可见                   | 1.56ms   | <= 2,000ms | PASS |
| 状态命令及同一 PASS 100 次并发重放    | 2.38ms   | <= 1,000ms | PASS |

100 次重复 PASS 全部按幂等重放读回，GateRun 数为 1，`requirement.advanced` 时间线事件数为 1。

## 6. 测试数据与留存

- 性能测试数据全部由 `createT7PerformanceFixture` 生成，ID 使用 `CODEx_TEST_` + runId；进程结束后释放。
- PostgreSQL 只创建测试前缀隔离 schema；最终读回 `remaining=0`，未执行默认 `pfc` migration。
- E2E 只访问 loopback Vite 和本地 route mock；没有真实 API、客户数据、授权头或 cookie。
- `docs/quality-gate/reports/assets/CAP-PFC-01-T6/` 保留三张脱敏最终截图作为 durable evidence。
- `test-results/` 保留 Playwright 生成的合成截图与 `.last-run.json`，已被 `.gitignore` 排除；没有真实正文或凭据。

## 7. G9-A 实现状态

| 项目                    | 状态               | 证据/阻断                                                          |
| ----------------------- | ------------------ | ------------------------------------------------------------------ |
| 需求与方案确认          | PASS               | `CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`                      |
| T1～T7 本地实现         | PASS               | 五个 Unit、12 条 CAP AC 的本地实现与分层测试                       |
| Quick/Core/Full         | PASS               | 本报告第 4 节                                                      |
| 代码评审责任人          | **REGISTERED**     | 陈立；本报告形成时未记录人工结论                                   |
| 测试责任人/人工 PC 验收 | **REGISTERED**     | 陈立；自动化 PASS 不等于产品验收                                   |
| 安全责任人/人工安全确认 | **REGISTERED**     | 陈立；自动化安全检查不等于人工安全结论                             |
| PFC-02/04 真实端口联调  | **BLOCKED**        | 当前仍为 fixture/unavailable，未授权真实集成                       |
| 一个工作日隔离观察      | **NOT STARTED**    | UNKNOWN、重复推进、拒绝、SSE、CPU/内存、数据库增长尚无观察窗口证据 |
| G10 产品验收            | **NOT STARTED**    | 需要具名验收人和确认方式                                           |
| G11 发布                | **NOT AUTHORIZED** | 无目标环境、Owner、rollback/monitoring、发布授权                   |
| G12 业务验收            | **NOT STARTED**    | 无真实外部效果证据                                                 |

综合状态：`G9-A_IMPLEMENTATION_EVIDENCE_PASS / FORMAL_ACCEPTANCE_BLOCKED`。

## 8. 过程与资源

- T7 本地 lead time 约 31 分钟；实际门禁失败 4 次：格式 2、类型 1、Edge 导航瞬时超时 1。评审发现并修复 1 个版本波次显示问题。
- 本轮未使用子代理。没有并行运行 test runner、浏览器或 dev server。
- 结束审计：3001/5173 无监听；当日启动的 Node/Edge 测试进程为 0。
- 保留进程：Windows 服务 `pfc-postgresql-18`，`Running/Manual`，PID `24620`，`127.0.0.1:5432`，用途为项目既有本地数据库；本轮未启动也未停止。需要管理员权限时可用 `Stop-Service -Name pfc-postgresql-18` 停止。
- 回滚：仅回退未提交的 T7 源文件/配置/测试/报告；不删除默认 schema 或非测试数据。当前分支仍无 commit，未配置本轮远程发布动作。

T7 是权威设计清单中的最后一个实现任务；不存在已确认的下一 Txx，因此不自行发明 T8。下一生命周期动作是补齐具名责任人、真实跨 CAP 联调与人工验收授权。
