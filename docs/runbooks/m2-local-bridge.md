# M2 本地 Bridge 运行手册

> 适用范围：M2-R1 本机回环只读链路。  
> 当前状态：步骤已固化但尚未执行 standard 集成。启动 PostgreSQL、应用 standard migration 和注册 standard SkillRelease 必须先获得对应授权。

## 前置条件

1. 使用项目 `.tools/node-v24.20.0-win-x64` 的 Node 24.20.0 和 npm 11.19.0。
2. PostgreSQL 仅监听 `127.0.0.1:5432`，数据库为 `pfc_local`；`.env.local` 不进入版本库。
3. `FIXTURE_ADAPTERS_ENABLED=false`、`PFC_EXPERIENCE_MODE=false`；真实联调时才设置 `PFC_M2_R1_ENABLED=true`。
4. M2 migration `202609060004_create_m2_agent_run` 已经授权、应用并读回；固定 SkillRelease 已经授权注册。
5. 本机 Codex binary 可执行 `codex app-server --help`；Zed 不作为 R1 成功前置条件。

## 本地配置

Bridge registry 必须位于 `.local/bridge/registry.json`，只能登记已批准的绝对工作区/Skill 路径和逻辑 ID：

```json
{
  "workspaceRoot": "<absolute-approved-workspace-root>",
  "skillRoot": "<absolute-project-skill-root>",
  "workspaces": [
    {
      "id": "<database-workspace-id>",
      "path": "<absolute-approved-workspace-path>",
      "verified": true,
      "repositoryFingerprint": "sha256:<64-hex>",
      "allowedRelativePath": "docs/requirements"
    }
  ],
  "skills": [
    {
      "releaseId": "<registered-skill-release-id>",
      "name": "pfc-readonly-artifact-check",
      "path": "<absolute-project-skill-root>/pfc-readonly-artifact-check/SKILL.md",
      "enabled": true
    }
  ]
}
```

工作区 ID、仓库指纹、允许相对目录、SkillRelease ID 和内容哈希必须与 PostgreSQL 登记值一致。不要把配对码、credential、Cookie、数据库密码或用户目录写入 registry、命令历史、日志或报告。

## 授权后的执行顺序

```powershell
$env:Path="$PWD\.tools\node-v24.20.0-win-x64;$env:Path"
npm run db:migrate:plan
npm run db:migrate
npm run local:skill:register-m2-r1 -- --owner "<named-owner>"
```

1. 启动 API 和 Web，使用 `TEAM_ADMIN` 进入 `/jobs?view=bridges`，生成一次性配对码。
2. 配对码只放在当前 PowerShell 进程，配对完成立即移除：

```powershell
$env:PFC_BRIDGE_PAIRING_CODE="<one-time-code>"
npm run local:bridge:pair
Remove-Item Env:PFC_BRIDGE_PAIRING_CODE
```

3. 确认 `.local/bridge/credential.json` 已创建且未打印 credential，然后启动 Bridge：

```powershell
npm run local:bridge:start
```

4. UI 必须读回 Bridge `ONLINE`、App Server `可用`、已绑定工作区和 Skill 数量；`DEGRADED/UNVERIFIED` 不得启动作业。
5. 从真实需求详情选择当前基线、工作区和固定 Skill，创建一次只读检查；用同一 `runId` 读回事件、Git baseline、SkillRelease 和结果。
6. 重启 API/Web 后再次读回同一 `runId`。在 1280、1440、1920 宽度核对详情、loading/error/offline、hover、keyboard focus 和 URL 状态。

## 停止与故障处理

- Bridge 使用 `Ctrl+C` 触发 AbortSignal；确认 Bridge、自有 Codex App Server 和测试 runner 均退出。
- 目录越界、Git/Skill 漂移、凭据泄露、重复副作用、事件序号缺口或子进程不可停止时，立即停止 Bridge，不自动重试未知结果。
- 已开始但无法证明结果的命令保持 `UNKNOWN`；不得改写为成功。
- credential 需要轮换时先在平台撤销旧 Bridge，再删除本地 `.local/bridge/credential.json`；不要覆盖现有 credential 文件。
- standard 数据库表不执行 drop/cascade；需要修正时另行设计前向 migration。

## 验收读回

验收证据至少包含：requirement/baseline/workspace/SkillRelease/runId、能力快照时间、事件序列、只读结果、重启读回、拒绝用例、进程清理、createdIds/保留状态、具名代码评审/测试/安全结论及产品验收结论。任何 fixture、mock、dry-run 或 Spike 不能替代该读回。
