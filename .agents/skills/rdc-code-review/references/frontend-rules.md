# Frontend Review Rules

> Severity: L0(致命) > L1(严重) > L2(一般) > L3(轻微)
> L0/L1 阻断 push，L2 警告，L3 提示

## Security

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| SEC-F01 | XSS：使用 `innerHTML`、`v-html`、`dangerouslySetInnerHTML` 渲染未过滤的用户输入 | L0 | 可直接窃取用户凭证或执行恶意操作 |
| SEC-F02 | XSS：通过 `document.write()`、`eval()`、`new Function()` 将用户输入构建为 DOM | L0 | 等同于任意代码执行 |
| SEC-F03 | 前端代码中包含敏感数据：JS 包中的 API 密钥、密码、令牌 | L0 | 前端代码完全暴露，凭证直接泄露 |
| SEC-F04 | 不安全存储：将令牌/密码存储在 `localStorage` 而非 HttpOnly Cookie | L2 | XSS 攻击可直接读取 localStorage 中的令牌 |
| SEC-F05 | 状态变更请求缺少 CSRF Token | L2 | 需要用户交互才能利用 |
| SEC-F06 | 开放重定向：`window.location` 或 `<a href>` 使用用户可控 URL 且未校验 | L2 | 可被利用进行钓鱼攻击 |
| SEC-F07 | 原型链污染：对用户可控输入执行深度合并 / Object.assign | L1 | 可导致属性注入，严重时可 RCE (Node SSR) |
| SEC-F08 | 不安全 HTTP 请求：API 调用硬编码 `http://` 而非 `https://` | L2 | 数据传输未加密，存在中间人攻击风险 |
| SEC-F09 | 正则 DoS（ReDoS）：用户输入匹配存在灾难性回溯的复杂正则 | L2 | 可导致页面卡死，影响用户体验 |
| SEC-F10 | 敏感路由缺少鉴权守卫：受保护的页面/组件无需认证即可访问 | L1 | 未授权用户可直接访问敏感页面 |

## Logic

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| LOG-F01 | 空值解引用：访问属性时未使用可选链或空值守卫 | L2 | 前端最常见的运行时错误 |
| LOG-F02 | Async/await 使用不当：遗漏 `await`、未处理 Promise 拒绝 | L2 | 导致数据丢失或不一致的执行顺序 |
| LOG-F03 | 状态直接修改：直接修改 React state / Vue 响应式数据而非使用 setter | L1 | 导致 UI 不更新或不可预测的渲染行为 |
| LOG-F04 | 过期闭包：`useEffect` / 事件处理器中因缺少依赖导致使用过期变量 | L2 | 导致使用过期数据，行为不符合预期 |
| LOG-F05 | 内存泄漏：`useEffect` / `onUnmounted` 中缺少定时器、事件监听、订阅的清理 | L2 | 长时间使用后页面卡顿甚至崩溃 |
| LOG-F06 | 竞态条件：并发异步操作缺少取消机制或顺序追踪 | L2 | 导致显示过期数据或操作顺序错乱 |
| LOG-F07 | 数组/字符串操作的边界偏差（`slice`、`substring` 边界值错误） | L3 | 边界条件下导致数据截断或遗漏 |
| LOG-F08 | 无限渲染循环：`useEffect` 中更新状态但未正确设置依赖数组 | L1 | 页面卡死，浏览器无响应 |
| LOG-F09 | 未处理的异步错误：事件处理器或生命周期钩子中的异步操作缺少错误处理，导致静默失败或未处理的 Promise 拒绝 | L2 | 错误被静默吞掉，用户操作无反馈 |

## Design & Maintainability

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| BP-F01 | 缺少错误边界（React ErrorBoundary）或异步操作的全局错误处理 | L2 | 单个组件错误导致整个页面白屏 |
| BP-F02 | 异步数据获取缺少 loading/error 状态 | L3 | 用户无法感知加载状态，体验差 |
| BP-F03 | 列表渲染缺少 `key`（React）或 `:key`（Vue `v-for`） | L2 | 导致渲染错误、状态错位和性能问题 |
| BP-F04 | 提交 API 前缺少输入校验/过滤 | L2 | 前端作为系统边界应拦截非法输入 |
| BP-F05 | 过于宽泛的 `try-catch` 静默吞没错误 | L3 | 隐藏真实错误，影响问题排查 |
| BP-F06 | 魔法值：业务逻辑中使用字面量而非命名常量 | L3 | 业界共识的可维护性问题，降低代码可读性且易在多处修改时遗漏 |

## Performance

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| PERF-F01 | 整包引入：仅需部分功能却导入整个库（如 `import _ from 'lodash'`） | L3 | 增大打包体积，影响首屏加载速度 |
| PERF-F02 | 大列表（>100 项）缺少分页或虚拟滚动 | L2 | 大数据量下页面卡顿甚至崩溃 |
| PERF-F03 | 主线程执行同步密集计算（应使用 Web Worker） | L2 | 阻塞主线程导致页面无响应 |
| PERF-F04 | 高频事件处理器缺少 debounce/throttle（scroll、resize、输入搜索） | L3 | 高频触发导致性能下降和不必要的请求 |
