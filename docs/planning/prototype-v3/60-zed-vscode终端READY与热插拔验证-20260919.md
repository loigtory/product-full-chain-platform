# 60 号：zed/vscode 终端 READY + 页面热插拔切换真实验证

- 日期：2026-09-19
- 目标：建议②「zed/vscode 终端从 PENDING 提升 READY」；同时真实验证 55 号热插拔「页面切换终端来源 → 会话工具注入 → 计划内命令真实执行」
- 状态：**PASS（7/7）**

## 一、能力变更

1. **host-tools-registry.js**：`zed_terminal` / `vscode_terminal` 从 PENDING_HOST_SUPPORT 提升为 **READY**，语义与 `codex_cli` 一致（受控命令执行器：cwd=授权工作区、deny 优先、计划精确匹配、超时终止）；`PENDING_TOOLS` 暂空。
2. **approval-service.js**：`COMMAND_TOOLS` 增加 `zed_terminal` / `vscode_terminal` → `'terminal'` 分支（计划内命令批准语义与 codex_cli 同源）。
3. **protocol.mjs**：VERSION 0.153.4 → **0.154.0**（同步本机 codex 升级；probe 验证小版本协议兼容，PROBE_PASS）。
4. 56/57 回归断言同步更新（zed/vscode 由"不注入"改为"注入"），均全绿。

> 说明：当前「终端」= 受控命令执行器（与 codex_cli 等价），IDE 专属会话流的实时跟踪（独立终端 UI 流）为后续 UI 里程碑，不在此轮虚假承诺。

## 二、热插拔 E2E 真实执行证据

需求 **CODEx_TEST_60_VSC_221653**（stage=dev）：

```
cap-switch：dev 启用 vscode、停用 codex-cli（模拟页面切换终端来源）→ 200
EXEC 真实作业（jobId 6dfa8f19-1be9-4866-a7fc-594ab57a1c22）
模型回写：已通过受控 VSCode 终端执行 ["node","--version"]
真实输出：v22.23.2 · 退出码 0 · 未超时 · 未修改文件
cap-restore：codex-cli 恢复启用、vscode 停用 → 200
```

验证点：
- 配置热插拔后，EXEC 会话工具列表**实时注入 vscode_terminal**（此前 60 初版失败系 5188 旧进程未加载新 registry，重启后通过）
- 计划内命令向量经 terminal 分支批准并**真实执行**（v22.23.2 为真实 node 版本）
- AI 消息回写 status=ok

## 三、运行方式

```
# 5188 以 PG+本地基线模式启动（profile 010；PFC_LOCAL_PROFILE_FILE + PFC_DB 全套 + PFC_CODEX 全套）
node server\verify-60-exec-terminal-ready.cjs
```

## 四、本轮伴随修复（重启踩坑固化）

| 现象 | 根因 | 处理 |
|---|---|---|
| PROTOCOL_VERSION_MISMATCH | codex 升级 0.153.4→0.154.0 | protocol.mjs VERSION 同步 |
| local-session 404 | 未设 PFC_LOCAL_PROFILE_FILE → profile.current() null | 补 env |
| LOCAL_RUNTIME_TARGET_MISMATCH | PFC_DB_TARGET_VERSION 缺/错（需 010 且 PG 全套 env） | 按轨迹恢复 58 完整启动 env |
| INVALID_JSON（curl 侧） | PowerShell 5.1 原生 exe 引号传参 | 验证统一走 node fetch，不依赖 curl |

**启动 5188 完整 env（持久化参考）**：PFC_DB=pg / DATABASE_URL=postgresql://pfc_app_local:*@127.0.0.1:5432/pfc_local / PFC_DB_TARGET_VERSION=010 / PFC_DB_SCHEMA=pfc_workbench / PFC_AUTHORIZED_SCHEMA=pfc_workbench / JWT_SECRET=<profile.jwtSecret> / PFC_LOCAL_USERS_FILE=.local\pfc-workbench\users.json / PFC_LOCAL_PROFILE_FILE=.local\pfc-workbench\profile.json / PFC_FILES_ROOT=.local\pfc-workbench-files / PFC_FILE_QUOTA_BYTES=104857600 / PORT=5188 / PFC_CODEX_BINARY / _SHA256 / _CONNECTION_SHA256 / _PREFLIGHT_CWD（凭证细节不入文档，见 58 会话轨迹）。
