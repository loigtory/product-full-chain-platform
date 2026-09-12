# CAP-PFC-01 UI-R12 运营中心页面迁移设计

> 分类：System Iteration Requirement / strict  
> 状态：设计已确认，实施中  
> 确认方式：产品负责人确认 UI-R11 需求工作台“这版可以了”，获知下一步按同一模板迁移门禁中心、材料库和详情流程后回复“可以”  
> 版本：UI-R12

## 1. 目标与非目标

目标：把 `/gate-center` 和 `/material-library` 从 UI-R6 视觉骨架迁移到已验收的 UI-R11 设计系统，使全局导航、页面标题、信息摘要、筛选工具栏、数据表、加载/空/错误状态具有一致的字体、层级、密度和交互状态。

非目标：本轮不迁移正式需求首页 `/`、需求详情、问题抽屉、门禁执行面板或材料影响表单；不改变筛选含义、深链接、分页、详情跳转、API 合同、数据库结构或业务数据；不提交、推送、部署、发布或执行数据库写入。

## 2. 现状证据

两个页面共用 `OperationsPages.tsx` 和同一组 `operations-*` 样式。当前 UI-R6 的主要差距为：一级导航仍是 `需求 / 门禁 / 材料`；页面标题位于蓝灰色大色块；概览为 44px 单行统计条；筛选控件带外置标签且高 40px；运营表格数据行高 68px；页面没有与 UI-R11 一致的图标标题、双摘要结构和明确刷新动作。

业务能力已经存在且必须保留：URL/session 筛选恢复、关键词与多条件查询、当前/历史或全部/待影响切换、加载更多、引用展开、进入详情、返回原中心和焦点管理。

## 3. 方案比较与选择

1. 对整个正式应用直接启用 `.pfc-reference-theme`：改动少，但会在同一版本中连带改变未设计、未验收的需求详情与表单，回归范围过大。
2. 给两个运营中心增加页面级主题边界，并复用 UI-R11 的 `PageIntro`、`SummaryGrid`、`SummaryPanel`、`FilterToolbar`、`WorkPanel` 和表格 token；同时把原 `OperationsPages.tsx` 拆成门禁、材料和共享模块：影响可控，可逐页验收，且后续详情迁移仍能复用同一体系。
3. 在 `OperationsPages` 内复制一套专用 CSS：短期直观，但会重新产生字体、粗细和间距随意漂移，违背已确认的元素模板治理。

选择方案 2。全局顶栏在门禁/材料路由采用同一参考主题；中心页面正文由局部 `.pfc-reference-theme` 包裹，详情页暂不继承本轮正文样式。一级导航文案统一为 `需求管理 / 门禁中心 / 材料库`。

模块结构固定为：

- `apps/web/src/operations/gate-center/GateCenterPage.tsx`：只拥有门禁查询状态与页面组合；`GateCenterTable.tsx` 和 `filters.ts` 分别拥有表格视图和筛选模型。
- `apps/web/src/operations/material-library/MaterialLibraryPage.tsx`：只拥有材料查询状态与页面组合；`MaterialLibraryFilters.tsx`、`MaterialLibraryTable.tsx` 和 `filters.ts` 分别拥有筛选视图、表格/引用视图和筛选模型。
- `apps/web/src/operations/model.ts`：只放两个页面共用的标签映射、格式化、选择值转换和持久化读取；不导出 React 组件。
- `apps/web/src/operations/shared.tsx`：只放两个页面共用的加载、错误、空状态和更新时间 React 组件，保持 Fast Refresh 边界干净。
- `apps/web/src/operations/index.ts`：稳定导出边界；`App.tsx` 只负责路由、跨页状态和页面组合。
- `apps/server/src/operations`：现有 `routes.ts`、`application-service.ts`、`repository-port.ts`、`index.ts` 已满足入口、应用服务和存储端口分层，本轮无合同或行为变化，不做无意义后端改动。

不保留聚合两个独立页面实现的 `OperationsPages.tsx`。架构测试会锁定上述入口和前后端职责文件，防止后续重新合并成大文件。

## 4. 页面结构与可见信息

两个页面采用相同结构：

1. 65px 全局顶栏：品牌、三个真实一级模块、新建需求、当前账户。
2. `PageIntro`：模块图标、30/36 页面标题、一句业务说明、右侧更新时间；不使用装饰性 eyebrow。
3. 页面内子导航：门禁 `当前待办 / 历史记录`；材料 `全部材料 / 待确认影响`。
4. 两个 130px `SummaryPanel`：全部数字均从当前 API 返回列表推导，不新增接口、不制造指标。
5. 32px 筛选工具栏：搜索、既有下拉条件和只读刷新按钮；字段名称通过原生 label/ARIA 保留，但视觉隐藏以降低垂直噪声。
6. `WorkPanel`：18/26 区块标题、结果数量、40px 表头、56px 双行数据行、分页或加载/空/错误状态。

门禁摘要：

- 门禁执行：当前结果、需处理、未运行。
- 运行结构：自动、人工、尚未运行。

材料摘要：

- 材料基线：当前结果、材料引用、待确认影响。
- 基线结构：当前、候选、历史。

## 5. 设计系统与交互规格

- 字体与颜色完全继承 UI-R11 三层 token；不新增 raw color、字体、圆角或阴影。
- 新增运营双行表格行高 component token，语义层映射现有 56px primitive；单行表格继续使用 45px，不互相污染。
- 标题、摘要、筛选、表头和正文分别沿用 UI-R11 已验收的 30/36/700、20/28/700、14/20/400、14/20/500 和 14/20/400。
- 所有 Lucide 图标使用 1.8px stroke；图标按钮保留可见 tooltip/`aria-label`；刷新期间图标旋转但布局不位移。
- hover、focus、selected、disabled、loading、empty 和 error 状态继续使用共享组件语义；不能只靠颜色表达状态。
- PC 最小宽度仍为 1120px；验收视口为 1280x720、1440x900、1920x1080。

## 6. 数据、安全与性能边界

- 继续调用既有 `listGateCenter`、`listMaterialLibrary` 和需求详情 GET；刷新只增加列表 GET 请求。
- 不新增 mutation，不修改数据库，不创建测试业务数据；自动化使用 `CODEx_TEST_` 合成响应。
- URL 与 sessionStorage 仅保存非敏感筛选值；不记录 cookie、token、连接 URL 或数据库密码。
- 列表仍限制每页 50 条并显式加载更多；不引入新依赖、字体下载、图片或外部网络。

## 7. TDD、验收与退出标准

先新增并确认失败的契约：

- 两个中心具有 UI-R12 页面主题、图标标题、双摘要、刷新按钮和统一导航文案。
- 摘要值从测试响应确定性推导。
- Edge computed style：字体栈、65px 顶栏、30/36/700 H1、130px 摘要、32px 搜索/下拉/刷新、40px 表头、56px 数据行。
- 原有筛选深链接、加载更多、引用展开、详情进入/返回继续通过；页面无横向溢出、文本越界、重叠、控制台错误或非 GET 列表请求。

完成聚焦单元/E2E 后运行 Quick、Core 和 Full Gate。工程 PASS 不等于视觉验收；最终必须用 `view_image` 对照 UI-R11 已验收截图和 UI-R12 最新 Edge 截图。

## 8. 回滚、发布与责任人

回滚：移除中心页面主题包裹、摘要/工作面板组合和运营行高 token，恢复 UI-R6 `OverviewStrip` 与原表格容器；API 和数据库不需要回滚。

本轮不使用并行代理，因为两个页面共享同一 React 文件和 CSS 作用域。临时浏览器和测试进程在验证后关闭；用户要求保留的 Web、API 和 PostgreSQL 服务继续运行并在报告中列出。

代码评审=陈立；测试=陈立；安全=陈立。责任人已登记；正式发布仅继续受产品视觉验收、发布授权和运行证据约束。
