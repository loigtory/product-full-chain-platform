# POD-PFC-001 M2-R3 实施检查点

> 更新日期：2026-09-09  
> 父级范围：`POD-PFC-001 / M2`  
> Unit：`UNIT-PFC-02-03/04/05`、`UNIT-PFC-03-06`  
> 状态：`R3B_IN_PROGRESS`  
> 当前唯一路由：`POD-PFC-001/M2/R3b/mcp-evidence-tdd`

## 已确认范围

- 方案 A 和设计第 15 节实施授权包已由产品负责人陈立于 2026-09-09 以“继续”确认。
- 允许仓库源代码、测试、文档、`diff@9.0.0`、隔离 `codex_test_m2r3_*`、只读 MCP inventory/隔离调用和本机门禁。
- 不允许标准 `pfc` migration 应用或业务写入、MCP 配置变更或新 MCP 服务安装、commit、push、deploy、发布或外部写入。

## 当前事实

- R3a 已完成 migration 008、不可变正文快照、Diff、评审、双向 trace 的 contracts/domain/repository/API/UI，代表页在 1280/1440/1920 下已完成自动视觉读回；人工视觉验收留待 R3c。
- R3b 已完成 migration 009、MCP contracts/domain、持久化 repository、browser/Bridge API 和 Codex MCP adapter 的基础链路；当前正补齐 Bridge worker、capability v2 真实上报、WorkSession UI 和真实只读调用证据。
- Migration 008/009 只已在 `codex_test_m2r3_*` 隔离 schema 执行并清理；标准 `pfc` schema 仍未应用。
- 项目 Node `24.20.0`、npm `11.19.0`；Quick dry-run 为 READY。
- 产品、开发、代码评审、测试和安全责任人均为陈立；人员配置不构成阻断。

## 实施顺序

1. R3a：contracts/domain -> migration 008 -> repository/API -> 代表产物工作区 -> quick/core。
2. R3b：migration 009 -> MCP capability/protocol/adapter/Bridge -> evidence -> quick/core。
3. R3c：WorkSession 整合 -> Full -> 具名结论 -> 标准 `pfc` 精确预检。

## 数据与进程

- 自动化数据使用 `CODEx_TEST_M2R3_<runId>_`，只进入 `codex_test_m2r3_<runId>` 并在测试后精确清理、空读回。
- 不使用 fixture 或演示 seed 作为产品验收。
- 测试结束关闭 API、Web、Bridge、App Server、Playwright 和 runner；保留进程必须记录 PID、端口、用途和关闭命令。
