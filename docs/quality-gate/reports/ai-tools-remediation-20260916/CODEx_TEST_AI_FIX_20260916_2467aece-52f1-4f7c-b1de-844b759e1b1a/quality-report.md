# R1 质量与差异报告 · 2026-09-17

结论 **PARTIAL / EXEC_BLOCKED，人工评审待定**。范围为 46 加两个明确补充文件；开工 c1d22ac，40 源码/测试文件（28 修改、12 新增），七文档和本轮证据。实现未上线，无 push/main 合并。

## 验证及证据适用性

最终命令 node server/scripts/run-ai-tools-remediation-gates.mjs --offline --integration：13 PASS、2 BLOCKED、0 FAIL，总体 BLOCKED。详情 gates-1789614740317.json；source-manifest-final.json 独立核对 40 文件及 14 条实际执行命令，NOT_SELECTED 的 real 没有生成本批次命令。九条原型基础闸均通过。

专项为 model13/API12/ops4/browser8/architecture7 PASS；浏览器真实 EXEC 一项 BLOCKED。实际 006/007 隔离数据库、备份恢复、附件、作业历史、HTTP/worker/WebSocket 均有各自报告；不把模拟部分等同真实模型。真实模型命令分别为 node server/verify-ai-tools-remediation-real.mjs --real 与 node server/verify-ai-tools-remediation-real.mjs --http，总计7/8次、28秒、未决0；实际执行依赖的沿用依据为 real-provenance-final.json，而非全部最新源码曾再次外发。所有命令均用项目 Node 24.20.0。

## 差异评审

- 停止链：等待事务提交，以 aiMessageId/租户/需求找任务；取消粘滞、当前 lease/owner 校验和消息状态条件共同拒绝迟到成功；进程退出无法证明则 UNKNOWN，不自动重放已派发任务。真实取消与 HTTP/PG 状态已对齐。
- 执行边界：API 和 worker 在派发前调用失败关闭检查。CLI 自动审批路径停止使用，命令计划/审批记录/回滚防护只是未来接线的模块，不能证明真实工具已受控。保留唯一高优先级未解项：当前协议执行前覆盖缺证据。
- 上下文：服务端版本/确认记录为依据，七阶段完整保留；AI 消息仍候选；跨需求来源、过期/超限拒绝。refs 正文入模和关联产物业务闭环没有在本轮宣称完成。
- 预算：独立绝对 ledger、文件锁与原子替换，attemptId 幂等结算，失败不退款计数；旧账本保护指纹未改。真实调用不再重复并行场景。
- 006/007 运维：全链使用实际 targetVersion，旧未填配置默认006；connection 只增三个准确schema及5432/指定ops5549，其他角色/端口/名称仍拒绝。无SQL变更。
- 页面：执行草稿按需求/阶段隔离并在变更时失效；隐藏的旧全局workspace不作为授权；真实模式仅显示实际装载的文本能力；本地模拟调整保留。三种要求宽度和键盘验证通过。
- 证据：原有执行脚本只读历史/明确BLOCKED，不删除历史、不再把status元数据或KNOWN_BRANCH_DIFF当通过；旧基础闸断言未修改，输出精确重定向本轮目录。源码变动批次被判FAIL并保留，末次冻结重跑。

未发现需要扩大本轮文件范围的额外修复。该评审不替代用户业务验收。原生根TS项目全量quick/core/full未运行；本轮依46精确专项/九基础闸，根Quick仅bootstrap dry-run，原生config和delivery实际通过。

## 数据与运行恢复

合成工厂覆盖状态、身份、阶段、版本、租约、重试和边界负例；runId/createdIds/清理在各报告。授权只含三个隔离schema及5549/5205恢复。service-stop-precheck.json记录schema不存在/其他客户端0，service-stop-result.json记录独立TCP检查后恢复Stopped，process-cleanup-final.json记录无本轮进程和限定端口监听。5188/5199未启动，个人数据未操作。本轮runtime目录和有归属证据的空临时目录已清理，旧备份/历史未清理。

新报告和合成截图按项目交付证据保留；预算ledger在忽略目录保留用于防止重用额度，不提交凭据/本地配置。最初失败报告均保留，失败数及末次耗时见delivery-metrics-final.json。服务启动/停止helper的首次时间解析失败留痕，最终状态以独立审计为准。

## 尚未验收与后续

验收人：用户/陈立；方式：47、提交差异与实测证据审阅后明确确认；当前PENDING，没有代签接受风险。EXEC真实批准/拒绝/越界/回滚和44材料→原型/PRD/AC→受控开发→可信测试回流均未完成。后续先补可实证的执行前控制设计；任何协议/源码范围或额度变化另行对齐。

本轮无正式部署，发布冒烟/观察窗口/上线监控无可用结论；不能从本地PASS推导生产就绪。回滚只可评审c1d22ac后的选择性差异，不自动重置/删除历史。服务原状态已恢复。下一轮保留当前局部修复，正式POD next route不推进。
