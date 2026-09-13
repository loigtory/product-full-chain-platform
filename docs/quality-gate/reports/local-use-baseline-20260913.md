# 本地可用基线 · 质量报告

状态：LOCAL_VERIFIED / PENDING_HUMAN_REVIEW。最终统一35条命令全部PASS、退出码均0，耗时621.8秒，68个源码文件运行前后指纹一致。七个隔离schema、临时原件/恢复根及自有进程独立清理读回通过。人工验收、业务启用与发布尚未执行。

授权：陈立确认40号A/D1–D8/C1–C4（f1470eb），覆盖原67源码工具测试路径、七文档、指定证据和七隔离schema/5548恢复cluster包；又确认verify-static.mjs仅一行42→43补充，有效68路径。见[原授权](local-use-baseline-20260913/authorization-20260913.json)、[补充授权](local-use-baseline-20260913/static-gate-supplement-authorization.json)。原3010保护基线保持原文件；本次仅排除获批补充文件，核验其余3009文件未变。

父POD-PFC-001/M2。直接支持UNIT-PFC-01-01/02/03/05、UNIT-PFC-02-01至04、UNIT-PFC-04-01/02；UNIT-PFC-03-02/05及UNIT-PFC-05-01至05仅回归已有记录与恢复。正式5CAP/26Unit状态和唯一next=POD-PFC-001/M2/R3a/artifact-collaboration-tdd不变。

## 实现与差异

22文件新增、32修改、14个范围内候选未改，无删除；逐文件增删行数和SHA256见[差异评审](local-use-baseline-20260913/diff-review-final.json)。新增个人Cookie身份、同源静态托管、空初始化/状态/停止、停写冷备与独立恢复模块；保留原型交互和现有领域合同，SQL001–006未改，依赖与正式台账未改。仅采用已授权原生HTML/JS与Express领域服务。

与40原包的范围差异只有获批的verify-static.mjs一行。原35闸中的R3验证脚本还补充发布工作区就绪等待、手工身份切换前上一场景背景HTTP回读结束的等待以及失败诊断；原有旧身份迟到响应、草稿隔离和Viewer禁用断言全部保留，没有强制点击、失败自动重试、放行或跳过断言。

## 验证结果

统一入口：仓库根用固定.tools/node-v24.20.0-win-x64/node.exe执行server/scripts/run-local-use-gates.mjs。完整命令/退出码/原始输出见[最终整轮](local-use-baseline-20260913/gates-1789317348153.json)，[最终指纹汇总](local-use-baseline-20260913/readiness-final.json)绑定当前68源码；不是拼接历史结果。下表node均指该固定运行时。

| 实际命令                                                               | 状态 / 退出码 |
| ---------------------------------------------------------------------- | ------------- |
| node output/pfc-workbench-prototype/verify-prototype.mjs               | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m1-layer.mjs                | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m1-e2e.mjs                  | PASS / 0      |
| node server/verify-server.mjs                                          | PASS / 0      |
| node server/verify-server-m2.mjs                                       | PASS / 0      |
| node server/verify-m2b.mjs                                             | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m2b2-model.mjs              | PASS / 0      |
| node server/verify-m2b2-domain.mjs                                     | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m2b2-browser.mjs            | PASS / 0      |
| node server/verify-m2c-pg.mjs                                          | PASS / 0      |
| node server/verify-m2c-architecture.mjs                                | PASS / 0      |
| node server/verify-m2c-domain.mjs                                      | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m2c-browser.mjs             | PASS / 0      |
| node server/verify-m2c-governance.mjs                                  | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m2c-governance-browser.mjs  | PASS / 0      |
| node output/pfc-workbench-prototype/verify-flow-model.mjs              | PASS / 0      |
| node output/pfc-workbench-prototype/verify-flow-browser.mjs            | PASS / 0      |
| node output/pfc-workbench-prototype/verify-flow-architecture.mjs       | PASS / 0      |
| node server/verify-r2-artifact-model.mjs                               | PASS / 0      |
| node server/verify-r2-artifacts.mjs                                    | PASS / 0      |
| node server/verify-r2-architecture.mjs                                 | PASS / 0      |
| node output/pfc-workbench-prototype/verify-r2-artifact-browser.mjs     | PASS / 0      |
| node server/verify-r3-verification-model.mjs                           | PASS / 0      |
| node server/verify-r3-verification.mjs                                 | PASS / 0      |
| node server/verify-r3-architecture.mjs                                 | PASS / 0      |
| node output/pfc-workbench-prototype/verify-r3-verification-browser.mjs | PASS / 0      |
| node server/verify-m2c-release-model.mjs                               | PASS / 0      |
| node server/verify-m2c-release.mjs                                     | PASS / 0      |
| node server/verify-m2c-release-architecture.mjs                        | PASS / 0      |
| node output/pfc-workbench-prototype/verify-m2c-release-browser.mjs     | PASS / 0      |
| node server/verify-local-use-model.mjs                                 | PASS / 0      |
| node server/verify-local-use-api.mjs                                   | PASS / 0      |
| node server/verify-local-use-ops.mjs                                   | PASS / 0      |
| node server/verify-local-use-architecture.mjs                          | PASS / 0      |
| node output/pfc-workbench-prototype/verify-local-use-browser.mjs       | PASS / 0      |

新增模型6/6、API5/5、运维9/9、架构4/4、浏览器5/5。模型验证固定目标/路径、Host/Origin、Cookie、到期/限额和关闭竞态；API验证同源静态、鉴权、WS撤销、实时成员权限、重启持久化、单件10MiB与总量100MiB的精确边界及拒绝后无额外原件。原型总闸六组、领域/治理/成果/测试/发布历史回归均通过。

运维覆盖中断初始化续跑、互斥、错误OID/PID、占用端口、坏原件/坏包、备份与恢复中断及同包重试。100条需求、200份原件及原型/PRD/AC/测试/验收/UNKNOWN发布历史完成停写冷备和5548恢复：冷态数据库与原件摘要一致，5198读回100需求与200下载，新密钥有效、旧Cookie无效，恢复后历史变更表为空。最终ops约136.1秒，最长单项37.0秒，符合180秒/45秒预算。见[运维证据](local-use-baseline-20260913/local-use/ops-1789317919857.json)。

Edge1280/1440/1920验证解锁、保存/刷新、503后重试、双标签页撤销、未提交聊天/表单恢复、显式退出。无写操作自动重放或重复需求，无横向溢出，新增按钮不换行，console错误和外部HTTP请求均0。见[浏览器证据](local-use-baseline-20260913/local-use/browser-1789317969871.json)及[1280截图](local-use-baseline-20260913/local-use/personal-work-1280.png)、[1440截图](local-use-baseline-20260913/local-use/personal-work-1440.png)、[1920截图](local-use-baseline-20260913/local-use/personal-work-1920.png)、[解锁](local-use-baseline-20260913/local-use/unlock-1440.png)、[本地状态](local-use-baseline-20260913/local-use/local-status-1440.png)。截图为合成数据，仍需陈立视觉验收。

## 失败留痕与复测边界

早期整轮33 PASS/2 FAIL及静态白名单等待结果保留，未覆写为成功。补充确认后，前两轮分别在R3弹窗等待、旧guide08搜索立即断言停止；第三轮R3前八项通过，手工身份切换遇前一场景背景回读401。定向复测及源代码追踪后补充R3的就绪/请求隔离条件；诊断代码的一处no-undef也已修正。最终整轮35/35通过。见[弹窗诊断](local-use-baseline-20260913/local-use/r3-browser-diagnosis.json)、[搜索时序](local-use-baseline-20260913/local-use/legacy-guide-diagnosis.json)、[身份切换诊断](local-use-baseline-20260913/local-use/r3-browser-readback-diagnosis.json)。

guide08未修改：失败后原样定向复测和最终完整原型总闸均通过。它采用按键/导航后的立即读取，偶发时序风险仍保留供验收评审；没有把未稳定复现的问题写成已修复业务bug。R3补充是测试前置条件修正，不声称所有旧token切换界面竞态都已修复；个人Cookie模式有独立撤销/重解锁验证。

早期TDD缺模块、环境/编码、合成数据约束、PG中文路径、下载路径、pg_ctl继承管道等待、1280换行、历史保护范围及交错执行指纹失败等记录继续保留。恢复最初231秒超预算未计PASS，修正后最终达到上述预算。

## 环境、数据与清理

Windows/pwsh7，固定Node24.20.0/npm11.19.0，根/server离线依赖核验通过，无新增依赖；Quick dry-run只是READY_TO_RUN。本轮原型专属35闸未被旧React工程Quick/Core/Full替代。配置仅由忽略的.env.local提供，不输出连接秘密。数据为CODEx_TEST_确定性factory，runId/createdIds、边界/坏数据、角色/状态、OID/marker、原件摘要和清理归属保存在各原始JSON，真实客户数据与外部业务写入均为零。

[独立清理](local-use-baseline-20260913/cleanup-final.json)：七测试schema及业务pfc_workbench均不存在；七原件/临时根为空；5188–5198和5548空闲；三个业务私密目录未创建。测试密钥、浏览器profile、备份与恢复凭据随确权目录清理；合成JSON/PNG仅在本轮新证据目录保留用于审计，历史受保护证据未动。

[进程复核](local-use-baseline-20260913/process-final.json)：本轮无自有API、PG恢复cluster、浏览器或测试进程残留；原PG13528/5432、API31152/3001、Vite37744/5173保留，均为本轮前进程。旧API/Vite如经负责人另行要求，可用Stop-Process -Id 31152或37744停止；本轮未停止它们。

[业务目标只读预检](local-use-baseline-20260913/local-use/personal-preflight-final.json)实际返回INITIALIZATION_REQUIRED、schemaExists=false、fileRootExists=false、apiPortFree=true。这是空目标核对，不表示已启用或已经本人试用。

补充检查实际执行：node scripts/check-config.mjs PASS（BOOTSTRAP_CONFIG_OK）；node --import tsx scripts/check-delivery-governance.ts PASS（5CAP/26Unit/M2/next未变）。最终文档格式/链接、秘密扫描、源码/保护指纹和git差异检查见本轮handoff-final.json。

## 验收、交付与后续

实现LOCAL_VERIFIED；隔离本地PG集成实测通过，正式业务集成与各CAP/Unit状态不升级。Codex完成自动执行与自审；陈立为产品/工程/代码评审/测试/安全负责人，各角色人工结论均PENDING，不代签接受风险。本人试用、业务启用、真实AI/Shell/Bridge/CI、生产发布和发布后观察均NOT_EXECUTED。

分支feat/local-use-baseline，基线main102cbbe，开工aa103fa；完整门禁在开工提交加待提交源码上执行，最终68 SHA256绑定收工内容。收工commit及同名远端SHA以本报告所在Git提交和最终交付回执为准。按已授权范围完成feature提交推送，不合并main。

当前限单人loopback，同盘冷备不能抵御整盘故障；长期负载/断电、多人与LAN/TLS、模型费用及真实外部效果未验证。人工验收后再提交本机启用包，明确空目标、ACL、初始化/启动、停用/回退与一工作日观察；覆盖恢复/回切另审具体目标。随后回父POD准备真实AI对话/材料理解和原型PRD/AC共同生成设计。

开发至本次验证证据约224分钟；人工验收/发布lead time尚未结束。新五类门禁保留41份执行记录（27 PASS、14 FAIL），属于执行尝试次数，不是缺陷数。改进项：开工展开子验证脚本依赖并核对精确白名单；浏览器测试明确业务就绪和背景回读边界；冻结源码后形成最终整轮证据。发布后指标无样本。
