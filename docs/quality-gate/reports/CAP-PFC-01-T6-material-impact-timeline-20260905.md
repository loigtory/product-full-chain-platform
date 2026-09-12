# CAP-PFC-01 T6 材料影响、恢复与时间线质量报告

> 记录时间：2026-09-05 07:54:35 +08:00  
> 授权：用户授权 T4 后连续执行后续 Txx；本阶段只执行本地 T6  
> 分类：System Iteration / strict  
> 需求与设计：`REQ-PFC-001 V0.7`、`CAP-PFC-01 V0.1/R4`、`G9-A DESIGN_CONFIRMED`

## 1. 结论

| 结论层级        | 状态           | 说明                                                                                                                              |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| T6 技术实现候选 | PASS           | 候选基线、影响确认、事务切换、下游结论失效、NO_IMPACT、分页时间线、SSE 重放和撤权清屏均有本地自动化、数据库与浏览器证据           |
| T6 正式业务验收 | BLOCKED        | 责任人现统一登记为陈立；本报告形成时尚未记录代码评审、测试和安全人工结论                                                          |
| Core 门禁       | PASS           | 项目固定 Node 下 unit/contract `126/126`、integration `49/49`、构建、迁移计划、测试数据清理和本地 PostgreSQL 检查均通过           |
| PC 浏览器回归   | PASS           | 系统 Edge 三种桌面视口完整回归 `24/24`；T6 新增材料影响和权限撤销场景 `6/6`                                                       |
| Full 门禁       | BLOCKED        | dry-run 明确缺 `pc-e2e,permission,concurrency,recovery,security,performance` profile 证据；独立测试通过不等于 Full profile 已闭环 |
| 合入/发布/部署  | NOT AUTHORIZED | 未 commit、push、merge、发布、部署、执行默认 `pfc` migration 或写入外部环境                                                       |

## 2. 实施范围

- Contracts/Domain：增加材料影响决策、确认角色、候选/当前/历史 baseline、分页时间线和 SSE 事件 DTO；限制受影响门禁不得晚于当前阶段。
- Application/API：产品经理登记候选；产品负责人或业务责任人按本人当前角色确认；每次写入及幂等重放前重新执行对象级授权。
- Persistence：同一 Requirement 最多一个 PENDING；确认事务原子完成 baseline 切换、Requirement 回退、CURRENT GateRun 失效、impact、timeline、outbox 和幂等记录。
- Recovery/SSE：当前对象始终为权威；REST 时间线按 sequence 分页；SSE 支持 `Last-Event-ID`/`after` 重放、坏游标 reset 和逐连接重新鉴权。
- PC Web：展示 baseline 历史、PENDING/CONFIRMED 影响、确认表单、失效计数与时间线；SSE 只触发权威重读；权限撤销立即清空详情和旧时间线。
- 明确未进入：T7 全量 UI/安全/性能 hardening、真实 PFC-02～05、真实会话、默认 schema migration、外部环境与发布操作。

## 3. 关键业务与安全不变量

| 不变量                           | 结果 | 证据                                                                                                 |
| -------------------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| PENDING 不改变当前状态           | PASS | domain/application/API/browser；候选为 CANDIDATE，当前 baseline、stage、GateRun 均保持原值           |
| IMPACTS 全有或全无               | PASS | PostgreSQL 故障注入；最终 outbox 冲突时 baseline、Requirement、GateRun、impact、idempotency 全部回滚 |
| NO_IMPACT 不回退、不失效         | PASS | domain/application/PostgreSQL/UI；形成新 CURRENT baseline，但 stage 和旧 CURRENT 结论保持            |
| 只失效旧当前基线的有效下游结论   | PASS | 评审回归；忽略早已 INVALIDATED 的历史运行，仅处理 selected stage 及以后 CURRENT GateRun              |
| 双确认只有一个成功               | PASS | PostgreSQL 并发；两个不同幂等键同时确认仅一个切换，Requirement 最终 rowVersion 只增加一次            |
| 当前敏感边界不可降级绕过         | PASS | 评审回归；当前为 RESTRICTED 时，即使候选声明 INTERNAL 也必须先通过当前对象权限                       |
| 撤权后不得借幂等键或页面缓存读回 | PASS | application/UI/browser；重放前重新鉴权，详情和旧时间线在 403 后清除                                  |
| Timeline/SSE 不含正文            | PASS | API/PostgreSQL/browser/扫描；事件仅含有界标量摘要，不含原始想法、回答、材料正文或确认原因            |

## 4. AC 映射

| AC                       | 结果    | 自动化证据                                                                           |
| ------------------------ | ------- | ------------------------------------------------------------------------------------ |
| `02-07` 新材料影响预览   | PASS    | contract/domain/application/UI；登记候选和推荐门禁，确认前零切换                     |
| `02-08` 确认切换或不影响 | PASS    | domain/API/PostgreSQL/browser；IMPACTS 回退并失效，NO_IMPACT 保持阶段与结论          |
| `05-01` 刷新恢复         | PASS    | UI/browser；sessionStorage 只保存 scope/view/search，详情从 API 权威重读且不重复命令 |
| `05-02` 错误恢复         | PASS    | UI；依赖失败显示 WARN 和最近成功时间，提供显式重试，不显示成功占位                   |
| `05-03` 版本变化         | PASS    | detail/browser；CURRENT/HISTORICAL/CANDIDATE 和失效范围同时可见                      |
| `05-04` 推进一致性       | PASS    | T5+T6 回归；列表、详情、轨迹和时间线均由持久化当前对象及唯一事件读取                 |
| `05-05` 权限撤销         | PASS    | API/UI/browser；SSE 通知后重新鉴权，403 清除正文并显示无权结果                       |
| `05-06` 受限材料恢复     | PASS    | application/API；当前与候选敏感边界分别校验，未知或缺权限 fail-closed，事件不含正文  |
| `CAP AC 05～07/09～12`   | PARTIAL | T6 覆盖基线、失效、恢复、权限和审计；全量 UI、安全、性能与人工验收仍由 T7 闭环       |

## 5. TDD、缺陷与复核

| 层级            | 首次红测/发现                                                                                           | 最终结果                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Contract/Domain | 新合同与规则缺失，定向 `5/5` 失败                                                                       | 定向通过；Quick 汇总纳入 `126/126`                                  |
| Application     | 服务不存在，定向 `4/4` 失败                                                                             | 扩展到 `7` 个场景；含权限、角色、幂等、敏感级别和当前失效范围       |
| HTTP/SSE        | 初次 `2/3`，health stage 仍为 T3                                                                        | 修正装配优先级后 `3/3`；分页、重放、reset、撤权均覆盖               |
| Persistence     | 先后发现 fixture aggregateVersion 过期、JSONB 数组编码不符约束                                          | 修正测试数据和结构化编码后 `4/4`；含故障回滚、并发与 NO_IMPACT      |
| React           | 面板缺失后新增；首次 Quick 被 effect 同步置状态规则拦截                                                 | 改为可取消异步初读、按 requirement key 隔离；组件回归 `5/5`         |
| Browser         | T6 定向首个 1280 Edge 冷启动超时；全量首次旧 E2E mock 出现 9 个测试桩失败                               | 1280 单独复跑 `2/2`；补空 timeline/SSE 与视图存储契约后全量 `24/24` |
| Review          | 错误 baseline 审计 ID、URL 反解析回放、历史运行误计数、低敏候选绕权、撤权重放、旧表单 stage、403 旧摘要 | 全部修复并增加定向回归；最终 Quick/Core/E2E 通过                    |

## 6. 最终门禁

| 命令                                  | 环境/数据                                                         | 结果                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`             | 项目 Node `24.20.0`；合成 fixture                                 | PASS：config、lint、format、types、unit/contract `126/126`                                  |
| `npm run test:gate:core`              | 项目 Node `24.20.0`；本机 `pfc_local`；隔离 `codex_test_*` schema | PASS：Quick、migration dry-run、integration `49/49`、cleanup、server/web build、DB check    |
| `npm run test:e2e:pc`                 | 系统 Edge；mock API；1280x720、1440x900、1920x1080                | PASS：完整 PC 回归 `24/24`；无 console error、横向溢出或敏感请求头                          |
| `npm run test:gate:full -- --dry-run` | 只读 gate planning                                                | BLOCKED：缺 `pc-e2e,permission,concurrency,recovery,security,performance` profile 证据      |
| 三组敏感值定向扫描                    | 源码、测试、实施文档和 `.env.example`，排除构建/依赖              | PASS：无私钥、带认证信息 PostgreSQL URL 或 secret 实值；仅命中空的 `SESSION_SECRET=` 示例键 |

## 7. 浏览器、数据与清理

- Browser 插件未提供，按测试技能回退到项目 Playwright 和已安装的系统 Edge；没有下载浏览器或新增依赖。
- 三档 PC 截图位于 `docs/quality-gate/reports/assets/CAP-PFC-01-T6/`；人工检查无重叠、截断或空白主视图。
- 测试数据只来自 `packages/test-data` T6 factory、fixture adapters、E2E route mocks 和 `CODEx_TEST_` + runId 标识。
- PostgreSQL 用例只创建 `codex_test_t6_*` 等隔离 schema；`afterAll` 删除，Core 读回 `TEST_SCHEMA_CLEANUP_OK remaining=0`。
- sessionStorage 只包含 `pfc.workbench.view.v1` 的 scope/view/search，不保存需求名称、原始想法、材料或回答；localStorage 为空。
- Playwright/Vite 已退出；`3001/5173` 无 LISTENING。保留项目既有 PostgreSQL `pfc-postgresql-18`，PID `24620`，监听 `127.0.0.1:5432`。

## 8. 风险、边界与下一阶段

- 当前 SSE 响应按 sequence 重放后结束，由 EventSource 自动重连，满足单节点通知与恢复语义；连接/重连指标、P95 可见延迟和退化轮询尚未量测，属于 T7 性能与可观测性范围。
- 当前真实授权、会话和材料端口仍不可用；fixture 只证明 fail-closed 契约，不证明 PFC-04/PFC-02 的真实联调结果。
- Full profile 尚未把已执行的 PC E2E、权限、并发、恢复和安全测试注册为可验证命令，且 performance 证据缺失；因此不是 Full PASS 或 release-ready。
- 未执行 axe 自动扫描、完整人工键盘巡检、弱网/超时量测、1000 条清单性能预算或一个工作日观察。
- 回滚范围仅为未提交的 T6 源文件；未写默认 `pfc` schema、外部环境或 Git remote，不存在远程数据回滚动作。
- 依据连续执行授权，本报告完成后自动进入 T7 UI 整合与工程加固；正式接受继续等待真实代码评审、测试和安全陈立及各自结论。
