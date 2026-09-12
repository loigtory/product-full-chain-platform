# M2b-2 本地验收收尾报告

> 后续验收记录（2026-09-12）：陈立对 `6dedc41` 明确回复“评审通过，继续”。本报告限定的本地协议/UI 范围已人工接受；以下自动化输出及测试时状态保留。生产、持久化、权限和真实工具边界不因此提升。

结论：**LOCAL_VERIFIED / READY_FOR_REVIEW**。七类闸的九条入口均有通过输出；新增浏览器 19/19。最终产品/视觉验收人为陈立，等待差异与截图评审，尚未 ACCEPTED、合并或发布。授权、白名单及与交接包差异见 [24 号](../../planning/prototype-v3/24-M2b-2验收收尾-20260912.md)。

父级 POD-PFC-001，原型 M2b-2，CAP-PFC-01/02/03 交互参考；不提升正式 Unit 或 PostgreSQL 集成状态。正式 next route 为 `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`；原型人工评审后才准备 M2c。

## 实际链路与修复

首页登记新需求 → 开始澄清并回答两问 → idea/req/design 版本确认与 API 阶段推进 → 计划批准 → 模拟 Bridge 接收 job.start → 完成前双终端可见输出 → SUCCEEDED、exit 0 → 独立 GET 回读 5 行与 5 步回放。用户界面保留原版三栏，未重画页面。自由文本自动建需求和真实 AI 没有被本报告算作完成。

修复了执行来源混淆、虚构 Git/租约/计量结果、远程作业仍进入模拟预览/控制、右侧外层滚动容器不跟随、取消后旧状态竞争、演示场景污染远程状态。服务端使用已有 revision 字段，没有新增协议路径或迁移。文件级增删行数见 [file-changes.tsv](m2b2-acceptance-20260912/file-changes.tsv)。

## 环境与数据

Windows、固定 Node 24.20.0 / npm 11.19.0，现有依赖离线预检通过。Browser plugin not available，按现有工作流使用 Playwright + Edge；PC 1280/1440/1920 × 960，文件入口 `output/pfc-workbench-prototype/index.html`。HTTP/WS 仅 `127.0.0.1`，新测试端口 5194，`PFC_DB=memory`、`DATABASE_URL=''`。无数据库迁移、真实工具执行、真实材料、客户系统或外部业务写入。

确定性工厂 `m2b2-browser-fixture.mjs` 通过 UI 创建前缀 `CODEx_TEST_M2B2_20260912` 的需求与合成输入；不通过注入业务状态绕过创建和确认步骤。角色切换使用既有演示入口，模型隔离用例直接调用模型以证明它会拒绝远程对象。受控模拟 Bridge 发送有界 47 行，模拟取消 ACK 和断线；真实 sim-bridge 脚本负责主链路。测试 JWT 只在进程内和独立浏览器上下文使用，不保存 token。

全部用例由 Codex 执行自动化，陈立为验收负责人。场景设计与业务依据如下，均以相同的合成范围隔离，清理责任归测试父进程。

| 场景/风险 | 前置与步骤 | 预期断言 | 自动化 |
| --- | --- | --- | --- |
| 主链路/页面可用 | 独立 API context；登记、回答、确认、推进、批准 | 页面有内容与 API 徽标；服务端三阶段版本已确认；执行前双终端有行 | 浏览器 1–5 |
| 结果与来源诚实 | 模拟 Bridge 在线或全部离线 | 有明确来源，未知 Git/租约，质量门仍待执行；无远程模拟预览 | 浏览器 4–6、10 |
| 刷新/尺寸 | 作业完成后重载与三宽度切换 | 同一 run/行恢复、无页面横向溢出、终端可见 | 浏览器 7–8 |
| 拒绝/审计 | 开计划先提交空理由，再提交有效理由 | 空理由不新增 run；有效理由 FAILED、无执行行、有审计和通知 | 浏览器 9 |
| 重复提交 | 批准按钮连续触发两次 | 仅一个领域 run、一次 Bridge job.start | 浏览器 11；领域幂等专项 |
| 长日志/阅读 | 45 行后用户向上读，再新增行 | 尾部跟随；镜像阅读位置不跳，右侧仍显示新行 | 浏览器 12 |
| Web 断线 | 断开 Web 订阅、服务端收到新行、恢复订阅 | GET 恢复缺失行，无本地补造 | 浏览器 13 |
| 取消/晚到完成 | UI 停止，等待 Bridge ACK，再发送晚到 done | CANCELLING→CANCELLED；晚到成功被忽略，revision 增长 | 浏览器 14；模型/领域专项 |
| 模拟控制隔离 | 远程 run 调用本地核验或演示失败按钮 | 拒绝且对象不变 | 浏览器 15、18 |
| Bridge 断线 | 运行中关闭 Bridge，点击结果核验 | UNKNOWN 保持未知且未 verified | 浏览器 16 |
| 只读 UI | 切只读演示角色，尝试作业控制 | 控件禁用，动作拒绝，无 run POST | 浏览器 17；不代表服务端角色授权 |
| 控制台 | 全过程收集 pageerror/console error | 无相关错误 | 浏览器 19 |
| local/mock 回归 | 原型既有隔离浏览器/模型数据 | 六组门禁及 M1 层/握手通过 | 既有回归 |

## 命令和原始证据

从仓库根运行，先使用 `$env:Path="$PWD\.tools\node-v24.20.0-win-x64;$env:Path"`；环境按上节固定。

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `node output/pfc-workbench-prototype/verify-prototype.mjs` | PASS：6 组，sourceUnchanged=true | [输出](m2b2-acceptance-20260912/verify-prototype.mjs.log.txt)、[子检查报告](m2b2-acceptance-20260912/prototype-report.json) |
| `node output/pfc-workbench-prototype/verify-m1-layer.mjs` | PASS：6 | [输出](m2b2-acceptance-20260912/verify-m1-layer.mjs.log.txt) |
| `node output/pfc-workbench-prototype/verify-m1-e2e.mjs` | PASS：8 | [输出](m2b2-acceptance-20260912/verify-m1-e2e.mjs.log.txt) |
| `node server/verify-server.mjs` | PASS：18 | [输出](m2b2-acceptance-20260912/verify-server.mjs.log.txt) |
| `node server/verify-server-m2.mjs` | PASS：19 | [输出](m2b2-acceptance-20260912/verify-server-m2.mjs.log.txt) |
| `node server/verify-m2b.mjs` | PASS：7 | [输出](m2b2-acceptance-20260912/verify-m2b.mjs.log.txt) |
| `node output/pfc-workbench-prototype/verify-m2b2-model.mjs` | PASS：6 | [输出](m2b2-acceptance-20260912/verify-m2b2-model.mjs.log.txt) |
| `node server/verify-m2b2-domain.mjs` | PASS：8 | [输出](m2b2-acceptance-20260912/verify-m2b2-domain.mjs.log.txt) |
| `node output/pfc-workbench-prototype/verify-m2b2-browser.mjs` | PASS：19（测试定位修正后） | [最终输出](m2b2-acceptance-20260912/verify-m2b2-browser-retry.mjs.log.txt)、[浏览器报告](m2b2-acceptance-20260912/browser-report.json) |

补充：`npm run check:config` 为 `BOOTSTRAP_CONFIG_OK node=24.20.0 policy=fail-closed`；`npm run check:delivery-governance` 为 `DELIVERY_GOVERNANCE_OK pod=POD-PFC-001 caps=5 units=26 milestone=M2 next=POD-PFC-001/M2/R3a/artifact-collaboration-tdd`；固定 Node `--check server/src/domain/service.js`、`--check server/src/ws.js` 退出 0；`git diff --check` 退出 0。Quick dry-run 仅证明计划可运行，不算 Quick PASS；旧工程 full 未运行，不属于本轮原型闸。

首次整闸第九条在关闭场景弹窗时定位到遮罩而非按钮，业务断言通过但关闭超时，结果仍记录 FAIL。只修改测试按钮选择器，复跑受影响脚本 19/19，业务源码未再改变，前八条输出仍有效。[首次整闸](m2b2-acceptance-20260912/first-gate-results.json)、[首次浏览器输出](m2b2-acceptance-20260912/verify-m2b2-browser.mjs.log.txt)、[最终结果](m2b2-acceptance-20260912/final-gate-results.json) 分别保留。早期 TDD/定位失败见 [红灯索引](m2b2-acceptance-20260912/red-evidence-index.json)，不抹去失败或把测试脚本缺陷当成产品缺陷。

## 视觉证据、清理及风险

Codex 已查看运行双镜像、长日志、1280 和 1920 截图；可见模拟来源与未知状态，三栏保留，右侧日志跟随且左侧阅读位置保留。长合成标识在侧栏按现有布局截断；高频自动操作会叠加提示，不代表正式视觉验收。截图共 9 张，仅合成内容，在本地忽略目录保留供评审，Git 收录路径、大小与 SHA256：[截图清单](m2b2-acceptance-20260912/screenshots.json)。

最后一轮新增需求 R-1201/R-1202/R-1203/R-1204，测试进程退出后内存数据销毁。server PID 13732、sim PID 528 已退出，浏览器 context 关闭；系统只读回查 5189/5191/5192/5193/5194 无监听，无匹配测试或 Playwright helper。[清理读回](m2b2-acceptance-20260912/process-cleanup.json)。旧用户应用进程未操作；无保留测试服务或需手动停止的 PID。

残余边界：领域存储为 Map；未验证进程重启后的 PG 持久化、多浏览器并发编辑、真实网络故障/负载/费用、生产 WS 或实际工作区文件/命令。源码复核表明 API 写路由尚未完整强制执行角色权限，前端只读测试不能替代它；M3 需要优先补齐。真实工具、权限与持久化完成前不能宣称生产级平台。当前 shell 交互仅发生于开发测试进程，产品浏览器并不直接执行 Shell。

风险接受、人工业务/视觉验收和 main 合并均等待陈立评审；没有部署、生产 smoke、观察窗口或业务上线结论。回滚依据 feature 分支 Git 差异，可不合并或按提交逐项评审回退；本轮没有数据库变更。

![运行中的双终端](../../../output/playwright/m2b2-acceptance-20260912/running-dual-1440.png)

![长日志与阅读位置](../../../output/playwright/m2b2-acceptance-20260912/long-output.png)
