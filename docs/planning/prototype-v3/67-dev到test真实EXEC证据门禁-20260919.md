# 67 号：dev→test 真实 EXEC 证据门禁（交接质量闸）

> 状态：已完成并验收（verify-67 19 PASS / 0 FAIL，双场景真实链路）
> 日期：2026-09-19
> 前置：66 号设计产物人工补录入口已交付（commit 4fda97b）

## 一、目标

dev→test 交接此前是**人工登记**（PM 在交付基线里填 devVersionId 即可放行，无任何代码作业证据要求）。67 号把交接从"登记"升级为"证据"：**平台必须检出 dev 阶段存在真实 EXEC 成功作业**（agent_jobs 中 kind=EXECUTE、state=SUCCEEDED、stage=dev），否则 handoff 一律 409 阻断——杜绝"没写代码也能进测试"的假闭环。

## 二、本次改动

### 1. 服务端门禁（核心）

- `server/src/domain/delivery-baseline-service.js`：`create` 回调**第一行**新增证据查询：
  `SELECT 1 FROM agent_jobs WHERE tenant_id=$1 AND req_id=$2 AND kind='EXECUTE' AND state='SUCCEEDED' AND input->>'stage'='dev' LIMIT 1`
  无命中 → **409 DEV_EXEC_EVIDENCE_REQUIRED**（"开发阶段尚未完成真实 EXEC 代码作业……请先在开发阶段发起真实执行完成代码实现并通过，再交接测试"）。
  **关键 pitfall**：门禁必须位于 `policy.delivery(input)` 之前，否则缺失证据会先抛 VERIFICATION_EVIDENCE_UNAVAILABLE 抢答，语义错误。

### 2. 迁移 012（id_counters 白名单修复）

- 根因：迁移 011 重建 id_counters 白名单时漏掉 005 已注册的测试验收域实体（test_suites / delivery_baselines / test_runs 等）→ 首次应用后套件/基线创建报 relation does not exist。
- 新增 `server/sql/m2c/012-fix-id-counters-whitelist.sql`：把测试验收域实体补回白名单。
- 注册链路（4 处）：`src/local/profile.js`（targetVersion=012）、`src/persistence/migrations.js`（registry + 18 处 includes + 012 分支 + assertReady）、`src/persistence/agent-jobs.js`（版本白名单加 012）。
- 手动应用方式（幂等复核）：`BEGIN → SET LOCAL search_path TO "pfc_workbench",pg_catalog,pg_temp → 执行 SQL → INSERT schema_migrations(version='012',checksum) → COMMIT`。**必须带 search_path**，否则裸表名解析到 public 报 relation does not exist。
- profile.json 写入**禁止 ConvertTo-Json**（会加 BOM 导致解析异常），用 node 脚本 strip BOM + JSON.stringify 重写。

### 3. 顺带修复

- `server/src/index.js`：统一错误响应增加 `[error-detail]` 日志（err.message 前 300 字符），EXEC 相关 5xx 可直读。

### 4. 回归脚本适配（61/63）

- 65 号设计产物门禁上线后，历史验收脚本 61（真实项目迭代）、63（EXEC 终端流）的 confirm-design 因缺四类设计产物被 409 拦截。两脚本均在 confirm-design 前补 PUT design/sequence/flow/prototype 四产物，与 67 脚本同标准。

## 三、验证结果（verify-67-dev-exec-gate.cjs）

**19 PASS / 0 FAIL**，双场景真实链路：

| 场景 | 前置 | 动作 | 结果 |
|---|---|---|---|
| A 阻断 | 新建需求推进 dev，**不发起任何 EXEC** | 登记交付基线（含 devVersionId/变更说明/证据材料）→ handoff | **409 DEV_EXEC_EVIDENCE_REQUIRED**，需求仍停 dev |
| B 放行 | 新建需求推进 dev，发起真实 EXEC（codex 加载工作区模块副本，真实新增 publicId() + test/session-store.test.js + node --test 通过） | 独立重跑 node --test 复核 → AI 消息生成字段 diff → 采纳 → 项目关联 → 套件创建/采纳 READY → 证据材料（attachment）→ handoff | 200 放行，stage=test |

场景 B 关键证据（pg 直查独立核对，非接口自证）：
- `agent_jobs` 存在 kind=EXECUTE、state=SUCCEEDED、`input->>'stage'='dev'` 的记录
- 工作区真实落盘 `src/session-store.cjs`（含 `publicId()` 导出）与 `test/session-store.test.js`，**独立重跑 `node --test` 真实通过**（greenExit=0）
- dev 版本由"待补充"模板变更为实质内容（diff 采纳后）
- 需求已关联项目 PRJ-*；套件 TS-* READY（gap 空）；证据材料 SM-* usage=attachment、status=已纳入、hash 匹配

## 四、回归（012 迁移与门禁对既有链的影响）

| 验收脚本 | 结果 | 说明 |
|---|---|---|
| verify-67 | **19/0 PASS** | 本号核心 |
| verify-61 | PASS | 已补四产物适配 65 门禁；EXEC 迭代闭环正常 |
| verify-63 | 10/0 PASS | 已补四产物适配 65 门禁；终端流正常 |
| verify-64 | 12/0 PASS | 设计产物闭环不受影响 |
| verify-66 | 15/0 PASS | 人工补录入口正常 |
| verify-62 | 11/0 PASS | 预算报表正常 |
| verify-65 | 6/2 FAIL | 场景 A 门禁逻辑 PASS；场景 B 复用历史需求 R-1082（已被前序流程推至 dev），confirm-design 报 ARTIFACT_CONFIRMATION_REQUIRED——**验收脚本对数据状态的假设被历史数据破坏，非 012/67 回归**；换新需求或重置状态后通过 |

## 五、交付物

- 门禁：`server/src/domain/delivery-baseline-service.js`（create 首行 DEV_EXEC_EVIDENCE_REQUIRED）
- 迁移：`server/sql/m2c/012-fix-id-counters-whitelist.sql` + `src/local/profile.js` + `src/persistence/migrations.js` + `src/persistence/agent-jobs.js`（均已含 012）
- 日志：`server/src/index.js`（error-detail）
- 验收脚本：`server/verify-67-dev-exec-gate.cjs`（19 PASS）
- 回归适配：`server/verify-61-project-iteration.cjs`、`server/verify-63-exec-stream.cjs`（补四产物）
- 测试需求：CODEx_TEST_67_A_*（阻断，停 dev）、CODEx_TEST_67_B_*（放行，test）

## 六、待办（未在本号范围内）

- test→accept、accept→release 的同类证据门禁（先定义各阶段产物/证据标准：测试报告、验收清单、发布单）。
- 证据链增强：EXEC 作业与交付基线之间建立可校验的关联（如 job_id 引用），并支持材料级追溯。
- 65 号验收脚本改造：场景 B 改为每次创建新需求（避免复用历史需求的状态污染）。
