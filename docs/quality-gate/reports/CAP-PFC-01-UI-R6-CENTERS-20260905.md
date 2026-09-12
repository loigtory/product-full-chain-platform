# CAP-PFC-01 UI-R6 门禁中心与材料库质量报告

## 1. 结论

- 本地技术验收：PASS。门禁中心、材料库、聚合 API、PostgreSQL 读模型、筛选、深链、详情返回、权限收敛和分页均已实现。
- 数据边界：仅使用本机 `pfc_local.pfc_experience` 与隔离 `codex_test_*` schema；无新迁移，无外部环境或真实客户数据。
- 正式业务验收：BLOCKED。代码评审、测试和安全责任人现统一登记为陈立；PFC-02/PFC-04、G10-G12、发布和观测仍不在本轮授权范围。
- 发布结论：未发布，也未执行 Git 提交、推送或部署。

## 2. 实现与审查

- 新增 `GET /api/v1/gate-center` 与 `GET /api/v1/material-library` 服务端聚合读取，浏览器列表不逐行读取详情。
- 新增 `/gate-center` 与 `/material-library` PC 页面，支持组合筛选、加载/空/错误/重试、当前与历史、材料引用、待确认影响和“加载更多”。
- URL 查询串优先恢复深链筛选；从详情返回时恢复原中心和会话筛选。
- 应用层在权限过滤后有界补页，单次最多扫描 10 个数据库页；异常重复游标失败关闭。
- 材料授权使用基线和引用中的最高敏感级，顺序为 `RESTRICTED > INTERNAL > PUBLIC`；响应不返回材料位置或内容哈希。
- 数据库游标仅接受纯十进制安全整数，拒绝部分解析。
- 代码审查发现并修复：深链筛选丢失、敏感级降级、受限引用遗漏、无权限首屏遮蔽后续数据、UI 忽略下一页、游标部分解析、React effect 同步状态写入。

## 3. TDD 与自动化证据

- 契约 RED 2/2 后 GREEN 2/2；应用服务 RED 后 GREEN。
- PostgreSQL 聚合 RED 后 GREEN；最终 UI-R6 持久化定向测试 3/3。
- HTTP 聚合 API RED 3/3 后 GREEN 3/3。
- 前端页面、深链、分页和返回路径最终定向回归 6/6；应用授权聚合 4/4。
- Edge 定向验收：1280x720、1440x900、1920x1080 共 6/6；无横向溢出、无控制台错误、进入详情前无逐行详情请求。
- Browser 插件在当前环境不可用，按 `frontend-testing-debugging` 回退到仓库 Playwright 1.62.1 与本机 Edge；浏览器进程均在测试后退出。

## 4. 质量门禁

| 命令                           | 结果 | 主要证据                                                                                                                                  |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:gate:quick`      | PASS | 配置、Lint、格式、类型；31 files / 152 tests                                                                                              |
| `npm run test:gate:core`       | PASS | 12 files / 56 integration tests；前后端构建；PostgreSQL 目标检查；测试 schema 余量 0                                                      |
| `npm run test:gate:full`       | PASS | 权限 7/44；并发 4/20；恢复 6/32；安全 5/25；性能 1/3；Edge 30/30；高危依赖漏洞 0                                                          |
| `npm run db:experience:verify` | PASS | requirements=3, questions=3, gateRuns=3, materialBaselines=3, materialRefs=2, materialImpacts=1                                           |
| `npm run test:experience:live` | PASS | gateCenter=PASS, materialLibrary=PASS, stage=G1, reload=PASS, question=CONFIRMED, materialImpact=NO_IMPACT, consoleErrors=0, httpErrors=0 |

## 5. 数据与验收读回

- 授权写入范围：仅重建 `pfc_experience`，且所有业务 ID 使用 `CODEx_TEST_EXPERIENCE_` 前缀。
- 浏览器验收创建临时需求 `CODEx_TEST_EXPERIENCE_REQUIREMENT_b1a2dae3-9729-4ffe-9927-4b21edc4921c`，并完成门禁、问题与材料影响写入。
- 验收后已停止 API、精确重置 `pfc_experience` 并重启；临时需求及其关联记录已清理。
- 最终数据库读回：3 个需求、3 个问题、3 次门禁、3 条材料基线、2 个引用、1 项待确认影响。
- 最终 API/UI 读回：`/health=ok`，当前门禁 3，候选基线 1，待确认影响 1，前端 HTTP 200。
- 截图为合成数据，保存在忽略目录 `output/playwright/local-experience-gate-center.png` 与 `output/playwright/local-experience-material-library.png`。

## 6. 验收、回滚与观测

- 当前验收方法：自动化测试、真实本机 PostgreSQL/API/UI 读回和产品负责人当前轮确认；正式测试、安全和代码评审待实名。
- 回滚：撤销 UI-R6 的 operations 契约/服务/页面及对应接线；数据库无结构变更；执行 `npm run db:experience:setup -- --reset` 可恢复体验数据。
- 发布后 smoke/readiness 与观测窗口：不适用，本轮未获发布授权。若后续发布，需另行确认环境、负责人、回滚、监控、观察窗口和停止条件。
- 残余风险：外部权限、Gate、材料与 SSE 能力仍为本地 fixture；未验证 PFC-02/PFC-04 或真实部署容量。

## 7. 交付指标与保留进程

- 交付日期：2026-09-05；质量门禁失败次数：0；实现期回归修正组：4；发布后缺陷：不适用。
- API launcher `33176`，npm `5276`，cmd `40812`，listener `28052`，用途：UI-R6 API，`127.0.0.1:3001`。
- Web launcher `29688`，npm `31652`，cmd `1632`，listener `30740`，用途：体验前端，`127.0.0.1:5173`。
- PostgreSQL `24620`，用途：既有本地数据库，`127.0.0.1:5432`，服务名 `pfc-postgresql-18`。
- 停止 API：`Stop-Process -Id 28052,40812,5276,33176 -Force`。
- 停止 Web：`Stop-Process -Id 30740,1632,31652,29688 -Force`。
- 停止 PostgreSQL：管理员执行 `Stop-Service -Name pfc-postgresql-18`。
