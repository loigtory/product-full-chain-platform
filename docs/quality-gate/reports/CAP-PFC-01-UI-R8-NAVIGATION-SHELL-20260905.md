# CAP-PFC-01 UI-R8 导航与页面骨架质量报告

> 执行日期：2026-09-05  
> 分类：System Iteration / standard  
> 设计确认：用户确认方案 B“全宽顶栏、模块一级导航、页面内二级菜单、居中工作区”  
> 责任人：代码评审=陈立；测试=陈立；安全=陈立

## 1. 交付结论

- 工程结论：`PASS`。UI-R8 源码、共享模板、业务页迁移、设计治理、构建、数据库集成和全套本地质量门禁均通过。
- 产品体验结论：可在本地数据库体验环境继续验收，入口为 `http://127.0.0.1:5173/`。
- 正式验收与发布结论：`BLOCKED`。代码评审、测试和安全责任人现统一登记为陈立；G10-G12、真实集成和一个工作日观察仍未完成。
- 外部副作用：无。未修改 API、数据库结构、业务数据、权限模型、远程 Git 或外部环境。

## 2. 实施范围

- 使用全宽 `GlobalHeader` 替换固定左侧栏；一级导航固定为“需求 / 门禁 / 材料”。
- 使用 `PageIntro` 和 `SubNav` 建立统一页面标题区与模块内二级菜单。
- 需求二级菜单：全部需求 / 待我处理 / 阻断项。
- 门禁二级菜单：当前待办 / 历史记录。
- 材料二级菜单：全部材料 / 待确认影响；当前仅筛选已读取的真实结果，不扩展后端查询契约。
- 新增需求蓝、门禁紫、材料青绿的模块令牌；橙色和红色继续只表达关注与阻断。
- `/ui-kit` 已同步 GlobalHeader、PrimaryNav、SubNav、PageIntro、ModuleAccent 和 28px 页面标题规范。
- 清除 UI-R7 已废弃的 sidebar、sidebar nav 和 workspace topbar 样式，避免后续页面继续引用旧骨架。

## 3. 参考吸收与视觉检查

从 `https://ai-dev.hzins.com/` 吸收以下可迁移特征：

- 顶部横向信息架构和明确当前位置。
- 大标题、说明、搜索之间的清晰层级。
- 居中最大内容宽度与浅色内容带。
- 多类别使用独立识别色，同时保留大量白色表面。

本平台保留高密度运营表格，没有复制参考站的大型营销首屏、渐变背景、分类卡片墙或品牌内容。

最终 1440px 实拍：

- `assets/CAP-PFC-01-UI-R8/workbench-1440.png`
- `assets/CAP-PFC-01-UI-R8/gate-center-1440.png`
- `assets/CAP-PFC-01-UI-R8/material-library-1440.png`
- `assets/CAP-PFC-01-UI-R8/ui-kit-1440.png`

三档自动化截图与详情截图：

- `assets/CAP-PFC-01-T3/pc-1280x720-worklist.png`
- `assets/CAP-PFC-01-T3/pc-1440x900-worklist.png`
- `assets/CAP-PFC-01-T3/pc-1920x1080-worklist.png`
- 同目录对应 `detail.png`。

人工读图结论：1280、1440、1920 下顶栏、标题、搜索、二级菜单、筛选器和表格无重叠；宽屏内容保持居中；门禁和材料的一级/二级活动态分别使用紫色与青绿色。

## 4. 测试与门禁证据

### TDD 与定向回归

- 首个组件测试按预期失败：`GlobalHeader`、`PrimaryNav`、`SubNav`、`PageIntro` 尚未导出。
- 实现后定向 UI 回归：3 个测试文件、24 项测试全部通过。
- 首轮 E2E：24 通过、9 失败。6 个失败来自 Playwright 对短菜单名的包含匹配；3 个失败来自已删除 `.sidebar` 的旧几何断言；另有一个失败链路后的 Edge 1920 启动超时。
- 修正测试契约后整套复跑：33/33 通过，1920 启动超时未复现。
- 最终评审发现并移除一条对废弃 `.sidebar` 的空值几何检查，改为验证全局顶栏与工作区不重叠；三视口定向复跑 3/3 通过。

### Quick

命令：`scripts\project-npm.cmd run test:gate:quick`

- 配置、UI 设计治理、Lint、Prettier、TypeScript：通过。
- UI 治理：`raw_visual_values=0`。
- 单元与契约：33 个文件、161 项测试通过。
- 结论：`GATE_PASS quick`。

### Core

命令：`scripts\project-npm.cmd run test:gate:core`

- Quick 全部步骤通过。
- 集成测试：12 个文件、56 项测试通过。
- 隔离测试 schema 清理读回：`remaining=0`。
- Server/Web 生产构建通过；PostgreSQL 读回 `pfc_local`、`pfc_app_local`、`127.0.0.1:5432`。
- 结论：`GATE_PASS core`。

### Full

命令：`scripts\project-npm.cmd run test:gate:full`

- 权限：44 项通过。
- 并发：20 项通过。
- 恢复：32 项通过。
- 安全：静态 11 项、自动化 25 项通过，0 finding。
- 性能 smoke：3 项通过。
- Edge PC E2E：1280、1440、1920 共 33/33 通过。
- 依赖审计：0 个高危及以上漏洞。
- 结论：`GATE_PASS full`。

## 5. 测试数据与安全

- 单元、集成和 E2E 沿用 `CODEx_TEST_` 合成数据、确定性工厂、隔离测试 schema 或浏览器 mock。
- 最终实拍只读本地体验数据库；未创建新业务记录，`createdIds=[]`，无需清理。
- 未输出数据库口令、连接 URL、令牌、Cookie 或客户数据。
- Web、API、PostgreSQL 均只监听 `127.0.0.1`。

## 6. 运行读回与保留进程

- Web：`http://127.0.0.1:5173/` 返回 HTTP 200；PID 14508；experience 模式。
- API：`http://127.0.0.1:3001/health` 返回 `status=ok`、`businessFeatures=true`；PID 28052。
- PostgreSQL：`127.0.0.1:5432`；PID 24620；Core/Full 连通性检查通过。
- 需求列表通过 Web 代理从本地数据库成功读回，未做写入。

按用户体验要求保留上述三个进程。关闭命令分别为：

```powershell
Stop-Process -Id 14508
Stop-Process -Id 28052
Stop-Process -Id 24620
```

## 7. 风险、回滚与后续门槛

- 已知限制：材料“待确认影响”是对当前已加载页的客户端视图；当后续数据量需要跨页精确总数时，应另行确认后端查询契约。
- 性能/容量：未新增请求或依赖；最大内容宽度和现有 50 条分页边界保持不变。
- 回滚：恢复 App/OperationsPages 的 UI-R7 页面组合以及 `@pfc/ui` 导出和令牌即可；无数据库或外部环境回滚。
- 发布前仍需：登记真实代码评审、测试、安全责任人；完成产品验收、发布授权、业务验收、发布后 smoke 和一个工作日观察。

## 8. 轻量复盘

- 本轮从设计确认到最终实拍约 45 分钟。
- 返工来源：1 次 TypeScript 原生属性命名冲突；1 次 E2E 旧选择器/几何契约更新。
- 有效防回归项：共享组件可访问语义测试、UI 原始视觉值治理、三档 Edge 几何检查、完整 Full 门禁。
- 发布后问题：未发布，无数据。
