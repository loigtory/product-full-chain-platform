# POD-PFC-001 M1-R1 PFC-02/PFC-04 联合设计

> 状态：`DESIGN_CONFIRMED`  
> 日期：2026-09-05  
> 确认：产品负责人于 2026-09-06 在当前会话确认本设计，授权进入本地 M1-R1 开发；不包含 commit、push、部署、发布或任何外部环境写入。  
> Parent POD：`POD-PFC-001 V0.1/R3`  
> 当前里程碑：M1 `IN_PROGRESS`  
> CAP / Unit：`CAP-PFC-02 / UNIT-PFC-02-01`，`CAP-PFC-04 / UNIT-PFC-04-01～03`

## 1. 目标与非目标

目标：

1. 将标准本地运行从 experience/fixture 切换为 `pfc_local.pfc` 的持久化业务事实。
2. 建立应用内账户、团队、成员角色、需求分工和仓库工作区，使现有 PFC-01 权限端口使用真实本地数据。
3. 建立阶段产物目录和不可覆盖的版本元数据，使产物类型、状态、权威版本、来源和适用范围可判断。
4. 经 API、UI、PostgreSQL 和服务重启读回验证 M1 的跨 CAP 最小闭环。

非目标：

- 本轮不实现产物正文在线编辑、版本 Diff、评审确认和完整追踪；这些属于 `UNIT-PFC-02-02～05`。
- 本轮不实现 Bridge 配对、Codex/Skill 执行、Zed 跳转、MCP 或执行审计；这些进入 M2 的 PFC-03/PFC-04。
- 不接 SSO、SIT、生产、远程 Git 或外部文件存储；不提交、推送、部署或发布。
- 不迁移 `pfc_experience` 合成数据，不把历史演示记录转换为业务数据，不删除其 schema。

## 2. 方案比较与选择

| 方案                                        | 说明                                                                                       | 收益                                                               | 风险/成本                                      | 结论   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------- | ------ |
| A. 应用账户 + PostgreSQL 会话 + 真实 CAP 表 | 使用内置 `crypto.scrypt` 保存密码派生值；会话只保存哈希；团队、工作区、产物写入标准 schema | 满足已确认的应用内邀请账户方向；无需新增依赖；可真实支撑权限和版本 | 需要一次性管理员初始化、会话/CSRF/权限安全测试 | 推荐   |
| B. 操作系统身份 + Bridge                    | 由本地 Bridge 证明 Windows 用户和工作区                                                    | 最接近后续本地工具协同                                             | Bridge 属于 M2，当前采用会继续阻断 M1          | 不采用 |
| C. `.env` 固定单用户                        | 用配置注入一个全权限 Actor                                                                 | 实现最快                                                           | 仍是模拟身份，无法支撑团队、分工和审计         | 拒绝   |

选择 A。首个管理员通过只接受标准输入的本地初始化命令创建，命令行、日志和报告不得包含密码；后续用户由管理员在应用内邀请。密码策略、会话过期、撤销和 CSRF 与实现同时进入安全测试。

## 3. 模块边界

| 模块                         | 职责                                               | 禁止跨界                                 |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------- |
| `apps/server/src/identity`   | 登录、退出、会话解析、邀请接受、ActorContext       | 不直接修改团队或需求表                   |
| `apps/server/src/teams`      | 团队、成员、角色、需求分工应用服务和路由           | 不读取密码派生值，不直接访问产物表       |
| `apps/server/src/workspaces` | 逻辑仓库工作区、需求绑定、允许的相对目录           | M1 不读取本机文件、不调用 Git/Shell      |
| `apps/server/src/artifacts`  | 阶段产物目录、版本登记、当前权威版本查询           | M1 不编辑正文、不生成产物、不调用 Skill  |
| `packages/domain`            | 会话、成员角色、工作区边界、ArtifactVersion 不变量 | 不依赖 Fastify、React 或 SQL             |
| `packages/contracts`         | 版本化 DTO、动作、错误码和事件摘要                 | 不暴露密码派生值、会话令牌或绝对本地路径 |
| `packages/persistence`       | 显式迁移、事务仓储、并发版本和 outbox              | 模块不直接修改其他模块私有表             |
| `apps/web/src/identity`      | 登录和当前用户状态                                 | 不保存密码或持久化令牌到 Web Storage     |
| `apps/web/src/team-admin`    | 团队、成员、分工和工作区页面                       | 不直接访问数据库或文件系统               |
| `apps/web/src/artifacts`     | 需求阶段产物目录                                   | 不用材料库 UI 冒充产物目录               |

`App.tsx` 只增加路由组合，不承载上述页面实现；新增页面必须在独立 feature 目录并复用 `@pfc/ui`。

## 4. PostgreSQL 设计

新迁移建议为 `202609050002_create_m1_collaboration_artifacts.ts`，在既有 lifecycle migration 后执行。表名为设计输入，正式实现前先以失败的 migration contract 固定列、约束和索引。

| 表                        | 主要字段/关系                                                                                              | 关键约束                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `accounts`                | id、login_name、display_name、password_hash、password_salt、status、row_version、timestamps                | login_name 唯一；不存明文密码；禁物理删除                                            |
| `account_invitations`     | id、team_id、login_name、role、token_hash、expires_at、accepted_at、invited_by                             | 只存 token 哈希；过期/已使用不可重放                                                 |
| `sessions`                | id、account_id、token_hash、expires_at、last_seen_at、revoked_at                                           | token_hash 唯一；过期或撤销后拒绝；禁输出原值                                        |
| `teams`                   | id、name、status、owner_account_id、row_version、timestamps                                                | 团队名在活动范围内唯一；Owner 必须为有效账户                                         |
| `team_memberships`        | team_id、account_id、role、status、joined_at                                                               | 组合唯一；角色使用已确认角色集合                                                     |
| `requirement_assignments` | requirement_id、team_id、account_id、responsibility、status                                                | Requirement、Team、Account 必须同一授权边界                                          |
| `workspaces`              | id、team_id、name、repository_label、repository_fingerprint、status、verification_status                   | M1 只保存逻辑标识和指纹，不保存中心可执行凭据                                        |
| `requirement_workspaces`  | requirement_id、workspace_id、allowed_relative_path、access_level                                          | 禁绝对路径和 `..`；需求只能绑定同团队工作区                                          |
| `artifacts`               | id、requirement_id、cap_id、stage、artifact_type、title、status、current_version_id、row_version           | 同一业务键唯一；current_version 必须属于同一 artifact                                |
| `artifact_versions`       | id、artifact_id、version_label、source_type、source_ref、content_hash、sensitivity、created_by、created_at | 版本不可覆盖；artifact+version_label 唯一；source_ref 只允许工作区相对定位或受控引用 |

迁移必须在 `codex_test_m1_r1_*` 隔离 schema 完整验证后，才允许对标准 `pfc` schema 执行一次显式 `db:migrate`。应用启动不得自动建表。标准 schema 写入后不通过删库回滚；如需修正采用前向迁移。

## 5. API 与权限

| API                                                    | 最小行为                                 | 权限                       |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------- |
| `POST /api/v1/sessions`                                | 登录并设置 HttpOnly/SameSite 会话 Cookie | 匿名；限速；通用错误       |
| `DELETE /api/v1/sessions/current`                      | 撤销当前会话                             | 已登录用户                 |
| `GET /api/v1/me`                                       | 返回脱敏 ActorContext 和当前团队         | 已登录用户                 |
| `POST/GET /api/v1/teams`                               | 创建团队、查看获授权团队                 | TEAM_ADMIN / 团队成员      |
| `POST/GET /api/v1/teams/:id/members`                   | 邀请和查看成员/角色                      | TEAM_ADMIN                 |
| `PUT /api/v1/requirements/:id/assignment`              | 维护当前需求责任分工                     | PRODUCT_OWNER / TEAM_ADMIN |
| `POST/GET /api/v1/workspaces`                          | 登记和查询逻辑仓库工作区                 | TEAM_ADMIN / 获授权成员    |
| `PUT /api/v1/requirements/:id/workspaces/:workspaceId` | 绑定需求与允许的相对目录                 | PRODUCT_OWNER / TEAM_ADMIN |
| `POST /api/v1/requirements/:id/artifacts`              | 人工登记阶段产物及首个版本               | PRODUCT_MANAGER            |
| `POST /api/v1/artifacts/:id/versions`                  | 追加不可覆盖版本并可切换当前版本         | PRODUCT_MANAGER            |
| `GET /api/v1/requirements/:id/artifacts`               | 按阶段/类型/状态查询产物目录             | 获授权需求成员             |

所有 mutation 使用幂等键和 rowVersion；授权先于正文/敏感元数据读取。登录、邀请、成员变更、工作区绑定和产物版本切换写入 audit/timeline/outbox 的脱敏摘要。

## 6. PC 页面与交互

1. 未登录访问业务页进入登录页；登录成功回到原目标，失败不暴露账号是否存在。
2. 顶部用户区提供当前团队切换和退出；团队管理页包含成员、角色、需求分工和工作区三个任务视图。
3. 需求详情增加“产物”页签，展示阶段、类型、状态、当前版本、来源、更新时间和责任人；无产物时提供明确登记操作。
4. 工作区登记只收集名称、仓库标识和允许的相对目录；M1 显示“待 Bridge 验证”，不伪造 Git/文件已连接。
5. 页面使用既有 UI token 和组件，新增页面先在 `/ui-kit` 补齐表单、权限拒绝、空态、版本状态和会话过期样例。

## 7. 测试数据与质量门禁

本迭代触发确定性数据 factory：覆盖账户、邀请、会话、团队、成员角色、需求分工、工作区、产物及版本 CRUD/状态/权限/版本/负向路径。测试数据只进入 `codex_test_m1_r1_*`，使用 `CODEx_TEST_M1_R1_<runId>`，测试结束删除 schema 并读回 0。

最低验证：

- unit/contract：密码和 token 不落明文、会话过期/撤销、角色矩阵、相对路径、ArtifactVersion 不可覆盖、当前版本归属。
- API：登录/退出、邀请、团队隔离、需求分工、工作区绑定、产物目录和并发冲突。
- PostgreSQL：两条迁移顺序、外键/唯一/check、事务回滚、重放、服务重启读回、测试 schema 清理。
- UI/Edge：登录恢复、团队切换、权限拒绝、产物空态/列表/版本登记、1280/1440/1920 无溢出且键盘可操作。
- 安全：Cookie、CSRF、限速、密码/token/路径脱敏、未授权读取、会话固定与重放。
- 门禁：每个子任务定向测试；版本完成前 quick/core/full。Full PASS 不替代具名验收。

## 8. 版本、实施顺序与退出条件

| 顺序 | 任务                                                 | 退出条件                                                 |
| ---- | ---------------------------------------------------- | -------------------------------------------------------- |
| 1    | `CAP-PFC-04-T1` 身份、团队、成员和会话领域/契约/迁移 | contract + isolated migration PASS                       |
| 2    | `CAP-PFC-04-T2` 登录、邀请、分工和工作区 API         | 权限/并发/API/PostgreSQL PASS                            |
| 3    | `CAP-PFC-02-T1` 产物目录与 ArtifactVersion           | 目录、追加版本、当前版本和审计 PASS                      |
| 4    | `M1-R1-T1` 模块化 PC 页面                            | UI unit + Edge 三视口 PASS；`App.tsx` 不继续膨胀         |
| 5    | `M1-R1-T2` 标准 `pfc` migration 与本地读回           | 精确授权后 migration、初始化管理员、API/UI/重启读回 PASS |
| 6    | `M1-R1-T3` 跨 CAP 加固与验收                         | full PASS、具名责任人结论、POD 台账回写                  |

M1 退出必须同时满足：PFC-01 五个 Unit、PFC-02-01、PFC-04-01～03 均达到真实本地 `INTEGRATED`；标准业务运行不依赖 fixture/experience；一个本地非客户需求在具名团队、分工、工作区和产物目录下完成 G0-G5 恢复；未授权路径、需求和动作稳定拒绝。

## 9. 风险、回滚和后续路线

- 身份实现风险：使用 Node 内置 `scrypt`，不新增密码依赖；参数、限速和锁定策略必须经安全测试，不能以本地环境为由省略。
- 数据迁移风险：先隔离 schema，再显式迁移标准 `pfc`；失败时停止应用写入并保留证据，不删除未知或非测试数据。
- 工作区风险：M1 不读取文件或执行 Git；只保存逻辑绑定和相对范围，Bridge 验证进入 M2。
- 产物风险：M1 仅保存元数据和受控引用；正文编辑、Diff 和评审不得混入本轮。
- 回滚：代码可反向编辑；标准 schema 一旦产生真实本地数据，只做前向修复，不用 cascade/drop 回滚。

M1 完成后的唯一下一路线为 `POD-PFC-001/M2/PFC-02+PFC-03+PFC-04`，进入 Skill 目录、Codex/AgentRun、审批、Bridge、Zed Spike 和 MCP 运行时采用决策，不再追加无阻断依据的 PFC-01 UI 轮次。

## 10. 已确认设计决策

产品负责人已一次确认以下内容：

1. 采用应用内邀请账户、Node `scrypt` 和 PostgreSQL 会话，不使用 `.env` 固定全权限用户。
2. M1 工作区只登记逻辑仓库、指纹和相对目录，实际文件/Git 验证留到 M2 Bridge。
3. M1 产物目录只保存不可覆盖的版本元数据和受控引用，不做正文编辑/Diff。
4. 获得设计确认后先完成隔离 migration 测试；对标准 `pfc` 执行迁移和初始化管理员前，再展示精确表、目标、回滚与停止条件进行运行授权核验。
