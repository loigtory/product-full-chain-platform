# 44号实施包 · C1检查点

状态：PARTIAL / BLOCKED_CONTEXT_CONFIRMATION。父POD-PFC-001/M2，5CAP/26Unit和唯一next route `POD-PFC-001/M2/R3a/artifact-collaboration-tdd`不变。44已确认，当前全局规则外发补充尚未确认；不是完整功能交付或产品验收。

## 实现与验证

两份server依赖文件及九份新增JS发生变化：连接配置/协议、材料解析、文本会话、确定性工厂和四份验证入口。未接入现有HTTP/UI或5188；007、仓储、领域服务与真实工具尚未实现。

| 实际命令/检查 | 结果与边界 |
| --- | --- |
| `node server/verify-ai-tools-protocol.mjs` | 9组PASS，protocol-unit-1789351590114.json |
| `node server/verify-ai-tools-model.mjs` | 文本会话策略7组PASS，model-1789351590205.json；完整状态/权限/审批闸待实现 |
| `node server/verify-ai-tools-materials.mjs` | 13组PASS，materials-1789351591351.json；8种实际文本格式，图片仅NEEDS_VISION |
| `node server/verify-ai-tools-protocol.mjs --live` | 实际非生成预检PASS，protocol-live-1789351631142.json；版本/账号/模型/连接匹配 |
| `node server/verify-ai-tools-real.mjs`（无--generate） | 退出1，THREAD_CONTEXT_UNVERIFIED，real-text-1789351633543.json；额外全局规则阻断，0turn |
| 7份文档+9份JS格式；9份JS静态检查 | PASS，原生ESM与CommonJS分别映射语言规则，根配置/忽略清单未改 |
| `npm run check:config` / `check:delivery-governance` / `check:codex-protocol` | PASS；最后一项仅旧0.153.4源827文件 |
| `npm run test:gate:quick -- --dry-run` | READY_TO_RUN，不是Quick执行PASS |
| 候选三包锁npm audit | 退出0，0漏洞，无安装脚本，可选native canvas未安装 |
| 实际server锁npm audit | 退出1，原express/qs链2项moderate，0high/critical；旧版本未改、新解析包无告警 |
| 进程/健康独立读回 | 最终process-readback-final2.json PASS：11个探针PID及子进程均退出；5188仍同instanceId/006/realTools=false |

精确命令和输出见command-checks-final.json。普通沙箱的进程读回曾ACCESS_DENIED，保留失败并标UNKNOWN，随后受审只读CIM/端口核查通过；不能用失败查询的空数组证明已清理。完整43条业务闸未完成，任何局部PASS不替代集成/验收。

## 已复现差异与修复

空mcp_servers表覆盖被合并，曾实际继承3个MCP。自动审批拒绝“先启动再读名单”的复验；已删除该顺序，改成CLI纯配置列表先取名单，然后以逐项enabled=false启动唯一实例，更安全替代通过审查和实测。没有绕过原拒绝。

ToolsV2会省略view_image字段，现以有效origin及相同version的sessionFlags层验证false。旧turn事件能在新请求ACK前覆盖新结果的问题已先用失败用例复现，再通过有界缓冲和turnId关联修复。额度预留拒绝/模型失败会关闭所属会话，未发生生成成功时不能伪造输出。

## 当前唯一待确认

44已允许本机现有Codex身份，因此已撤回重复的供应商选择问题；绑定当前自定义provider/apiKey/gpt-6-astra连接指纹继续，实际非生成连接预检已通过。

实际thread/start仍载入全局开发规则C:/Users/hz19114673/.codex/AGENTS.md，28443字节，SHA256 b77f388f6dcbbc729550c5a3ac73d91a68264e33421173ba02c337390d3f892c。项目指令预算为0、53个Skill禁用、记忆/工具/MCP关闭、read-only/无工具网络，仍不能排除该文件。44外发仅合成材料，故0turn并保持阻断。

推荐仅补充本次允许该精确路径/内容随合成请求外发，每次验证指纹，变化或额外指令阻断，原20次/300秒/60分钟限额和工具权限不变。备选维持纯合成边界、另拟独立运行身份方案。具体可审查差异见context-exception-proposal.json与45；没有把用户的沉默当批准，也没有修改全局文件或复制凭据。

## 数据、过程与复核

无模型turn、业务/测试schema写入、个人原件操作、子代理或部署。临时公共依赖锁/cache/logs留在被忽略的.local/ai-tools-integration-20260914/preflight，按同轮续作保留，容量/文件数见verification-checkpoint.json；最终由Codex确权清理。server/node_modules保留获批依赖。

原PG13528/5432、API19412/5188及controller14924、旧API31152/3001、Vite37744/5173保留；5188停止命令为固定Node执行server/scripts/local-workbench.mjs stop。没有新遗留进程。源码68、原候选未改项及3299保护文件独立核对；历史Git stat needs-update不对应内容变化，不进行行尾修复。

由Codex完成局部自审，陈立保留产品/代码/测试/安全/验收结论。未测的真实生成质量/用量、Windows工具沙箱、007持久化恢复、UI可用性和全43闸仍是阻断。开工8321c64；本轮只保存本地WIP，不推送或合并，不宣称开发完成。

过程记录：供应商重复确认判断已依据44纠正；字段兼容与事件时序缺陷来自实际预检/局部回归。失败证据保留，未清洗结果；交付周期仍进行中，业务验收和启用指标未产生。
