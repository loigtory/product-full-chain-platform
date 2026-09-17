# 宿主工具控制质量与差异评审

结论：PARTIAL / HOST_FILE_CONTROL_VERIFIED / COMMAND_BLOCKED。人工验收待定；当前环境恢复还有 Windows 管理员确认未完成，见 service-restore-attempt-cancelled.json。

## 实际范围与验证

- 方案 A 已由用户确认，准确授权见 authorization.json。开工提交 77b2d94，允许本地 feature 收工提交，不推送或合并。
- 31 路径中实际新增 12、修改 17、未改 2；七份交接文档，当前证据根。未变文件为 agent-events.js、conversation-service.js。
- gates-final.json 的当前适用结果为 16 PASS、2 BLOCKED；含一次同源码浏览器重跑，有 31 指纹一致性，不是单次全绿。原两次综合失败记录完整保留。
- 新模型 7、协议 3、API 13、架构 7 组通过；页面 9 组通过/1 阻断，真实模型 4 组通过/1 阻断。旧模型 13、API 12、恢复 4 和九个既有回归入口通过。完整命令、工作目录、配置/数据来源、stdout/stderr 与退出码均在 command JSON。
- 本轮预算 6/8、71/2400 秒、未决 0；旧 44/46 账本字节不变。只向已固定连接发送获准全局规则和合成内容，无真实项目文件/凭据入模；具体工具参数及 hash 见 real-1789626401786.json。

## 数据设计与执行证据

工厂 server/test-data/ai-tools-host-exec-fixture.mjs 与明确本轮模式的既有 remediation-fixture.mjs 固定唯一 runId。数据来自自建 synthetic tenant/Owner/需求/开发上下文/已 dispatch job 和 example.txt/new.txt；方案 hash 与租约具有业务前提，非任意种子。测试前后保留 createdIds、总行数、目标所有权、外部 schema 元数据指纹与清理结果。

角色及负例覆盖 Owner/viewer/未注册/撤销、非开发阶段、取消、租约/方案到期、上下文变化、未 dispatch、重复及跨 turn、超范围、链接/硬链接/穿越、文件基线变化、未知恢复和冲突回退。每项 scenario/assert 的前置、步骤和期望在对应 verifier，执行结果在同名报告；自动化 owner 为本轮 Codex，业务验收人仍为用户/陈立。

实际模型写入与 PG 证据一致，取消先提交并确认模型退出；它们是直接宿主集成，不能代作完整公共 EXEC 流程。页面审批用合成响应验证交互，HTTP readback/API 权限另在实际隔离 PG 验证；TEXT 停止刷新使用实际 PG/WebSocket。

## 差异评审

已审查动态请求关联、原生工具关闭、动作前持久化及再次权限校验、文件 hash/内容/路径边界、取消/重复/UNKNOWN、拒绝审批与恢复、前端转义与需求切换。精确清单见 diff-review-final.json。当前文件能力的通过结论有对应测试；命令隔离、恶意跨进程文件竞态及公共 EXEC 完整链仍明确未验证，不通过文案或状态升级掩盖。

性能边界为模型串行、8 次/300 秒每次/2400 秒，文件 50 个/5 MiB；工具请求缓存 100，查询最多 100 条，命令路径关闭。未测生产负载、长期存储增长或货币费用。固定命令 120 秒/256 KiB 输出上限只是待验证设计，尚无实际命令执行证据。

## 失败、修复与复测

先保存模型/协议失败回归再实施。实际调试失败包括：code_mode_host 关闭导致 2 次真实调用无动态工具；fixture 状态字段/search_path；私有 profile 新前缀；浏览器关闭按钮多匹配；HTTP 调用未导出的 repository.read；合法写入后拒绝审批受旧基线阻挡。均保留失败并做相应回归。最后一次完整门禁发生一次 page.goto load 超时，同源码独立复跑 9 组通过；不把该超时诊断为产品缺陷，保留环境时序风险。

服务停止尝试的 UAC 取消单独记录，未绕过或自动重试；源码测试结果与环境恢复状态分开。指标见 delivery-metrics.json，开工/收工耗时及返工只用于改善流程，无上线后缺陷数据。

## 交付与后续

当前未发布/未启用个人服务，观察窗口与发布后冒烟 NOT_STARTED。授权三 schema 已独立读回不存在，其他客户端 0；服务恢复受 Windows RunAs 取消阻断：pfc-postgresql-18 仍 Running（服务 PID 24432，5432），process-final.json 为独立读回。私有 profile/工作区/恢复集群已清理，runtime 只留三份无凭据的启停归属记录；没有本轮常驻 helper。需用户处理管理员弹窗后重做无其他客户端检查并恢复停止。合成截图/去敏报告保留评审，独立预算保留且 Git 忽略。

后续需准确的 Windows 沙箱机制/环境方案与负例证明，然后完成公共 EXEC 全链与 44 D2/D3/D6/C4。扩系统、路径或额度必须重新确认。人工验收依据本地提交差异、48 和这些证据作出；未代签风险。源码回退按 77b2d94 对比选择性还原；禁止清除其他人改动或受保护历史。没有需要回滚的发布。

真实报告中的 preflight/modelExit.summary.modelTurns=0、realTools=false 是握手摘要，不表示后续没有模型调用；本轮实际用量以独立预算 6 次、71 秒及 actualWrite/actualCancel 记录为准。
