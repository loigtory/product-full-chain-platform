# 57 号：终端工具执行器 + GitHub 生态 skill 实际安装

> 日期：2026-09-18 · 分支：feat/ai-tools-integration · 状态：已完成
> 前置：55 号（配置中心）+ 56 号（EXEC 工具热插拔白名单）

## 一、目标

56 号把 EXEC 工具做成白名单热插拔，但注册表里终端类工具全是 PENDING（无法注入）。57 号：

1. **codex_cli 提升为 READY**：成为真正的可注入命令执行工具（语义：在冻结计划批准的命令范围内执行命令向量）；
2. **zed/vscode 保持 PENDING**：真实 IDE 会话流接入需 IDE 端支持，诚实标注不注入；
3. **GitHub 生态 skill 实际安装**：55 号 v2 清单里 github 来源的 skill 落地到 `~/.codex/skills`，让配置声明与真实能力对齐（测试更真实）。

## 二、终端工具执行器（codex_cli READY）

### 设计

```
页面 dev 启用 codex-cli ──► stage_capabilities(tool)
      └─► worker EXECUTE: enabledHostToolsForStage → resolveHostTools → codex_cli 注入
            └─► hostThreadParams: 5 core + codex_cli(带 command 参数 schema)
                  └─► host 会话 agent 调用 codex_cli({command:[...]})
                        └─► approval-service dispatcher:
                              codex_cli → 'terminal' 命令工具
                              └─ command 向量来自工具参数（计划内命令）
                              └─ command-runner.assertCommandAllowed：deny 优先 + 计划精确匹配
                                    └─ 执行 runCommand（cwd=授权工作区、超时进程树终止、输出限量、审计）
```

**安全模型不变**（54/56 基线）：
- deny 优先：git 变更/删除类/npm 联网/绝对路径/敏感路径——即使被写进计划也拒绝（command-runner DENY_RULES）
- 计划精确匹配：命令向量必须等于冻结计划 allowedCommands 之一，否则 `COMMAND_NOT_IN_PLAN` → PENDING 审批
- 工作区限定：cwd 必须是被授权工作区（checkedWorkspace）
- 超时进程树终止 + 输出限量 + 命令行痕迹审计
- **与 pfc_run_checks 的差异**：codex_cli 的命令向量来自 agent 参数（计划内），不是固定 node-test——执行器复用同一 command-runner，批准语义一致

### 改动清单

| 文件 | 改动 |
| --- | --- |
| `server/src/agent/host-tools-registry.js` | codex_cli 移出 PENDING_TOOLS → EXTRA_READY_TOOLS（READY，command 参数 schema：string[]，1-32 项）；zed/vscode 保持 PENDING；导出 EXTRA_READY_TOOLS |
| `server/src/agent/approval-service.js` | COMMAND_TOOLS 加 `codex_cli: 'terminal'`；terminal 分支跳过 exactArgs（允许携带 command 参数）、命令向量取自 arguments.command（校验 string[]/长度/控制字符），其余工具仍固定向量 + 空参数 |

### 验证（verify-57-exec-terminal.cjs：14/14 PASS）

- codex_cli READY、zed/vscode PENDING；仅 codex_cli 注入；schema 带 command
- hostThreadParams：5 core + codex_cli = 6；zed 不注入 = 5
- 命令批准语义（不真实执行）：计划内 git status/node --version 允许；计划外拒绝；deny 优先（rm/git push/npm install 拒绝）

### HTTP 验证（verify-57-http.cjs：2/2 PASS）

- PUT dev 阶段加 codex-cli（owner + Origin）200；GET 确认 dev tools 含 codex-cli
- 注：GET /stage-capabilities/:stage 返回 `{stage, entries}`（非扁平 tools 数组）；写操作需 `Origin` 头（LOCAL_ORIGIN_REQUIRED）；多次登录会 429→全 401，重启 5188 清除

## 三、GitHub 生态 skill 安装

### 安装清单（v2 定稿 github 来源，13 个）

| 来源 | skill | 安装 |
| --- | --- | --- |
| anthropics/skills（官方 19 个） | frontend-design、webapp-testing | ✅ `~/.codex/skills` |
| phuryn/pm-skills · pm-product-discovery（13 个） | brainstorm-ideas-new、identify-assumptions-new、analyze-feature-requests、interview-script、metrics-dashboard | ✅ |
| phuryn/pm-skills · pm-go-to-market（套件 6 个） | beachhead-segment、competitive-battlecard、growth-loops、gtm-motions、gtm-strategy、ideal-customer-profile | ✅（pm-go-to-market 是套件，整体安装） |
| user-story-canvas | **GitHub 生态未找到**（anthropics 19 个无、pm-skills 无、仓库搜索无）——55 号清单该条来源标注有误，design 阶段用户故事画布能力暂由本机 figma-generate-design + uml-and-software-architecture-visualization 覆盖，后续可换公司市场需求分析类 skill | ⚠️ 待确认 |

**安装方式**：git clone 直连 github.com 被网络重置 → 改用 `api.github.com/repos/<repo>/tarball` 下载 + tar 解压 + 拷贝子目录到 `~/.codex/skills/`。安装后 `~/.codex/skills` 共 **64 个 skill**。

**公司市场（ai-dev.hzins.com）skill**：未安装——内部资产需下载授权机制确认后执行（55 号待办保留）。

## 四、全量回归（57 完成后）

| 验证 | 结果 |
| --- | --- |
| 55-http（登录/GET 8 阶段/PUT 幂等/DELETE/持久化） | 15/15 PASS |
| 55-worker（idea/dev/observe 装载按 priority） | 6/6 PASS |
| 56-exec-tools（白名单/装配/配置装载，断言更新至 57 语义） | 15/15 PASS |
| 56-smoke（5188 重启后 8 阶段/dev 4 skills） | 6/6 PASS |
| 57-exec-terminal（READY 注入/命令批准/deny 优先） | 14/14 PASS |
| 57-http（PUT codex-cli + GET 确认） | 2/2 PASS |
| 前端 vite build | ✅（1946 modules，1.01s） |

> 56 号验证脚本断言已更新：codex_cli 由 PENDING→READY 后，"PENDING 不注入"语义改由 zed/vscode 承担；新增 codex-cli READY 注入断言。

## 五、运行方式

- `node server\verify-57-exec-terminal.cjs`（无 DB）；`node server\verify-57-http.cjs`（需 5188）
- dev 阶段在页面「阶段能力」启用 codex-cli 后，下一个 EXEC 作业 host 会话会注入 codex_cli 工具（白名单内计划命令）

## 六、结论与后续

57 号完成"开发终端工具"的第一段真实落地：**codex-cli 作为计划内命令执行工具可配置可注入**（安全批准链不变），GitHub 生态 13 个 skill 已实装。剩余：

1. **zed/vscode 真实 IDE 会话接入**：需 IDE 端插件/协议支持（PENDING 保留），与"终端流实时镜像"是同一后续方向；
2. **公司市场 skill 安装**：需 ai-dev 下载授权机制确认；
3. **user-story-canvas 来源更正**：GitHub 无此 skill，design 阶段以本机 uml/figma skill 覆盖（已记录）。
