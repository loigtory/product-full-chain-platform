# @pfc/ui

`@pfc/ui` 是产品全链路平台唯一的视觉令牌、基础组件和跨页面交互模式来源。

## 使用顺序

1. 在本地打开 `/ui-kit`，确认已有元素和状态是否满足需求。
2. 页面直接从 `@pfc/ui` 引用组件或运营模式，不复制其内部结构与样式。
3. 确需新增元素时，先补三层令牌、组件状态、元素目录示例和测试，再进入业务页面。
4. 运行 `npm run check:ui-design`；业务 CSS 出现原始颜色、字体、字号、行高、圆角、阴影或动效时长会失败。

## 令牌层级

- `tokens/primitives.css`：仅保存不可带业务语义的基础值。
- `tokens/semantic.css`：把基础值映射为主操作、文字、表面、边框和业务状态。
- `tokens/components.css`：按钮、输入、分段控件、面板、表格和导航的组件专用值。

业务页面只能使用语义或组件令牌，不直接引用基础色值。

## 基础组件

- `Button`：`primary`、`secondary`、`ghost`、`danger`，包含禁用和加载状态。
- `SearchField`：统一搜索图标、清除动作、焦点和可访问名称。
- `SegmentedControl`：统一单选视图/范围切换和 `aria-pressed`。
- `SelectField`：统一标签、选择框高度和焦点反馈。
- `Badge`：`neutral`、`info`、`success`、`warning`、`danger`。
- `Surface`：`plain`、`outlined`、`raised`，仅用于真实独立容器。

## 运营页面模式

- `GlobalHeader`：平台品牌、一级模块导航、全局动作和账户区域；业务页不得自建侧栏或顶栏。
- `PrimaryNav`：固定承载“需求 / 门禁 / 材料”等一级模块，使用 `aria-current`。
- `PageIntro`：统一上下文、28px 页面标题、说明、搜索或主要操作以及模块识别色。
- `SubNav`：承载模块内视图，使用 `aria-pressed` 并继承当前模块色。
- `ModuleAccent`：只用于元素目录或需要显式说明模块归属的界面。
- `OverviewStrip`：列表结果、待处理数量和更新时间。
- `FilterToolbar`：搜索、分段控件和组合筛选的布局边界。
- `DataTableFrame`：高密度业务表格容器。
- `EmptyState`：空数据、读取失败和恢复动作。

模块色固定为需求蓝、门禁紫、材料青绿。橙色和红色只表达关注、阻断等业务状态，不得作为模块装饰色。

```tsx
import {
  DataTableFrame,
  FilterToolbar,
  GlobalHeader,
  PageIntro,
  PrimaryNav,
  SearchField,
  SubNav,
} from '@pfc/ui';
```

页面可以定义业务列宽和领域状态映射，但不得重新定义组件字体、颜色、圆角、阴影或状态动效。
