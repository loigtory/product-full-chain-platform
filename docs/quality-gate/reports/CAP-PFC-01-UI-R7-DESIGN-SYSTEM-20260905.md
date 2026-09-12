# CAP-PFC-01 UI-R7 设计系统质量报告

> 执行日期：2026-09-05  
> 迭代分类：System Iteration / strict  
> 环境：Windows 本地工作区、Node.js 24.20.0、Edge、Vite experience、本地 PostgreSQL 18  
> 设计确认：用户确认方案 B，建设 `@pfc/ui` 设计系统并迁移核心页面  
> 责任人：代码评审=陈立；测试=陈立；安全=陈立

## 1. 验收结论

- **工程质量门禁：PASS。** Quick、Core、Full 均通过。
- **UI-R7 范围验收：PASS。** 三层令牌、共享组件、运营模式、元素目录和核心页面迁移均已落地。
- **正式业务验收/发布：BLOCKED。** 代码评审、测试和安全责任人现统一登记为陈立；G10-G12、真实集成和一个工作日观察不在本迭代授权范围内。
- 本次未提交、推送、部署或访问外部写环境；未改变 API、权限、领域状态机或数据库结构。

## 2. 交付范围

- `packages/ui/src/tokens`：基础、语义、组件三层设计令牌。
- `packages/ui/src/components`：Button、Badge、SearchField、SegmentedControl、SelectField、Surface。
- `packages/ui/src/patterns`：OverviewStrip、FilterToolbar、DataTableFrame、EmptyState。
- `/ui-kit`：颜色、排版、操作状态、筛选输入和数据表格的可交互目录。
- 需求工作台、门禁中心、材料库：迁移到共享组件与运营模式。
- `scripts/check-ui-governance.mjs`：阻止业务 CSS 直接写颜色、字体、字号、行高、圆角、阴影和动效时长。

## 3. TDD 与自动化证据

| 阶段       | 证据                                                                                                                                                     | 结果                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| RED-1      | 先增加设计系统组件测试，组件和令牌尚不存在                                                                                                               | 6 项按预期失败                            |
| GREEN-1    | 实现三层令牌与基础组件后复跑                                                                                                                             | 6/6 通过                                  |
| RED-2      | 先增加运营页面模式测试，模式尚不存在                                                                                                                     | 1 项按预期失败                            |
| GREEN-2    | 实现 OverviewStrip、FilterToolbar、DataTableFrame、EmptyState 后复跑                                                                                     | 通过                                      |
| RED-3      | 代码审查发现 SearchField 的清除按钮嵌套在 label 内，先增加 DOM 语义断言                                                                                  | 1 项按预期失败                            |
| GREEN-3    | 搜索框改用非标签容器，保留输入框 aria-label 后复跑                                                                                                       | 组件与核心页面 3 文件、23 项通过          |
| 聚焦回归   | `vitest run tests/unit/ui-design-system.test.tsx tests/unit/ui-governance.test.ts tests/unit/requirements-ui.test.tsx tests/unit/operations-ui.test.tsx` | 4 文件、25 项通过                         |
| UI 治理    | `node scripts/check-ui-governance.mjs`                                                                                                                   | `UI_GOVERNANCE_PASS raw_visual_values=0`  |
| 类型检查   | `tsc --noEmit --pretty false`                                                                                                                            | PASS                                      |
| UI Kit E2E | `npm run test:e2e:pc -- --grep "reusable UI catalog"`                                                                                                    | 1280x720、1440x900、1920x1080 共 3 项通过 |

首次聚焦回归在 Windows 沙箱内因 Vite 派生进程触发 `spawn EPERM`；经批准在沙箱外以同一命令复跑通过。该失败归类为执行环境限制，不是产品代码失败。

最终 Full 前一次复跑中，Edge 在启动 1440px 项目时以进程码 `3221225477` 退出，该用例尚未进入页面步骤；其余 32 项通过。失败用例随后单独复跑 1/1 通过，最后对当前源码重新执行完整 Full，33/33 E2E 及全部门禁一次性通过并输出 `GATE_PASS full`。

## 4. 项目质量门禁

| 命令                                          | 结果 | 关键证据                                                                                         |
| --------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `scripts/project-npm.cmd run test:gate:quick` | PASS | 配置、UI 治理、lint、format、types；33 文件、160 项单元/契约测试通过                             |
| `scripts/project-npm.cmd run test:gate:core`  | PASS | 12 文件、56 项集成测试；测试数据清理剩余 0；生产构建；PostgreSQL 连通性通过                      |
| `scripts/project-npm.cmd run test:gate:full`  | PASS | 权限 44、并发 20、恢复 32、安全 25、性能 3、Edge E2E 33 项通过；安全检查 11 项零发现；依赖漏洞 0 |

生产构建：Web 共转换 1863 个模块，CSS 61.71 kB（gzip 9.57 kB），JS 282.90 kB（gzip 83.16 kB）。本地测试仅使用 `CODEx_TEST_` 合成数据和 mock；集成测试创建的数据已由门禁确认清理，`remaining=0`。

## 5. 浏览器与视觉验收

浏览器插件在当前会话不可用，按前端测试流程降级到项目 Playwright + 本机 Edge。最终复核同时查看参考站截图和当前实现截图，检查页面非空、布局边界、文本适配、控件状态、信息密度和视觉层级。

| 对照项   | 参考吸收                       | 平台结论                                                        |
| -------- | ------------------------------ | --------------------------------------------------------------- |
| 品牌语言 | 明亮画布、蓝色主操作、青色强调 | 已转为平台品牌令牌；业务状态使用独立绿/黄/红语义色              |
| 字体层级 | 清晰的中文标题、正文和说明层级 | 已形成 24/18/14/13/12 五级排版令牌，不加载外部字体              |
| 筛选交互 | 搜索、选中态、组合筛选清晰     | 三个核心页面统一使用 SearchField、SegmentedControl、SelectField |
| 内容层级 | 明确区块和轻边界               | 运营页以 OverviewStrip + FilterToolbar + DataTableFrame 组织    |
| 反馈状态 | 轻量 hover/focus/pressed       | 已统一组件状态并支持 `prefers-reduced-motion`                   |

有意保留的差异：平台首屏直接进入业务工作台，不照搬营销 Hero、透视背景、装饰渐变和卡片瀑布流；高频运营信息继续用表格呈现。1280x720、1440x900、1920x1080 自动验收通过，1280 与 1440 最终实拍未发现文字遮挡、控件重叠、横向溢出或空白渲染。

实拍文件位于本机临时目录，未进入仓库，包含工作台、门禁中心、材料库和 `/ui-kit`；仅含确定性本地体验数据，由系统临时目录策略保留/清理。

## 6. 风险、回滚与发布边界

- PC Web 是当前唯一兼容范围；移动端未设计、未验收。
- 系统字体在不同 Windows 机器可能产生细微字宽差异，组件使用稳定高度与表格列约束降低布局风险。
- 回滚只需撤销 UI-R7 的 `packages/ui`、`apps/web`、测试、门禁和文档变更；没有数据库迁移或外部环境副作用。
- 未获授权执行 Git 提交、推送、部署或发布。正式接受前必须登记真实代码评审、测试和安全责任人，并补齐后续生命周期证据。

## 7. 观察与回顾

- 本地体验服务继续保留用于产品查看；观察重点为长文本、不同数据量、筛选组合和复杂详情对共享令牌的继承情况。
- 本轮返工：浏览器用例移除 1 条与元素目录无关的负向断言；代码审查修复 1 个 SearchField 交互元素嵌套问题；Vite HMR 中间态语法错误在类型/构建前已修正，无遗留失败。
- 防回归：后续页面必须先复用 `/ui-kit` 已登记元素；新增视觉规则需要先进入 `@pfc/ui`，业务 CSS 原始视觉值由 Quick 门禁阻断。
