# CAP-PFC-01 UI-R5 PostgreSQL 体验模式质量报告

## 结论

- 开发验证：PASS。
- 本地体验验收：PASS。
- Quick/Core/Full：PASS。
- 正式业务验收与发布：BLOCKED。代码评审、测试和安全责任人现统一登记为陈立；本轮仍未授权提交、推送、部署或外部系统接入。

## 变更范围

- 本地 PostgreSQL 独立 schema：`pfc_experience`。
- 全权限合成参与者：`CODEx_TEST_EXPERIENCE_ACTOR_FULL_ACCESS`。
- 确定性初始数据：3 条需求、3 个问题、3 条历史门禁。
- 显式 setup/verify 命令；应用启动不自动迁移。
- 前端显示“本地数据库体验”和“全权限体验”，未建设入口明确标记为“规划中”。
- 跨 CAP 授权、材料证据和自动门禁执行仍为 local-only fixture，不代表真实外部集成。

## 测试数据与外部影响

- 环境：`127.0.0.1:5432/pfc_local`。
- 配置来源：忽略提交的 `.env.local`，报告未记录连接串或密码。
- 数据来源：`packages/test-data` 确定性合成工厂。
- 授权范围：仅重建 `pfc_experience`，仅写入 `CODEx_TEST_EXPERIENCE_` 标识数据。
- 浏览器验收曾创建需求 `CODEx_TEST_EXPERIENCE_REQUIREMENT_d5421e2d-10ad-4758-81c9-1bf3bcae75e5` 和 `CODEx_TEST_EXPERIENCE_REQUIREMENT_91e76629-d6b6-4f92-86fb-42ee2089704b`。
- 清理状态：上述临时验收记录已通过精确 schema 重建清理；当前保留 3/3/3 初始体验数据供人工体验。
- 敏感数据：无真实人员、客户、凭据或业务材料。

## 执行证据

- TDD 红灯：体验模块缺失、UI 环境标识缺失、种子工厂/装载器缺失、安全默认关闭检查缺失、体验责任人缺失，均先观察到预期失败。
- `node --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run tests/integration/local-experience-persistence.test.ts --maxWorkers=1`：PASS，1/1。
- `npm run db:check`：PASS，目标为 `pfc_local / pfc_app_local / 127.0.0.1:5432`。
- `npm run db:experience:setup -- --reset`：PASS，3/3/3。
- `npm run db:experience:verify`：PASS，schema、表清单、ID 前缀和计数读回通过。
- `npm run test:experience:live`：PASS；需求创建、G0 自动门禁到 G1、刷新读回、问题确认、材料影响 NO_IMPACT；控制台错误 0，HTTP 错误 0。
- API 重启后按创建 ID 读回：PASS，阶段仍为 G1、rowVersion 为 2、G0 自动门禁记录为 PASS。
- `npm run test:gate:quick`：最终 PASS；28 个文件、140 个测试。首次格式检查失败、第二次发现门禁普通模式幂等前缀回归，修复后完整重跑通过。
- `npm run test:gate:core`：PASS；140 个单元/契约测试、50 个集成测试、构建、迁移计划、PostgreSQL 和测试 schema 清理通过。
- `npm run test:gate:full`：PASS；权限 44、并发 20、恢复 32、安全 25、性能 3、PC Edge E2E 24/24；依赖审计 0 个高危漏洞。

## 代码评审

- 结论：未发现阻断级正确性、权限绕过、跨 schema 写入、敏感数据泄漏或已有行为回归。
- 关键保护：体验模式仅 `APP_ENV=local`；默认关闭；固定 schema；写前数据库指纹、表清单和既有 ID 校验；失败时清理本次 schema；普通依赖路径保持失败关闭。
- 剩余风险：体验身份无真实登录、外部能力为 fixture、独立门禁中心和材料库尚未实现，不能据此判断生产权限或外部执行有效。

## 过程指标

- 本轮实现与验收耗时：约 45 分钟。
- 质量门禁失败次数：2 次 Quick，均在交付前修复并完整重跑。
- 开发期缺陷来源：1 次嵌套事务假设、1 次领域字段名映射、1 次 PostgreSQL inet 文本比较、1 次普通模式幂等前缀回归。
- 发布后问题：不适用，本轮未发布。
- 观察窗口：仅本地即时验收；正式发布观察未开始。

## 正式验收待办

- 代码评审：陈立。
- 测试：陈立。
- 安全：陈立。
- 发布、回滚、监控和观察窗口需另行设计确认与授权。
