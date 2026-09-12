# AI-UX-R1 E4.1 workspace identity remediation design

> Date: 2026-09-08  
> Classification: System Iteration Requirement / strict loop  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`  
> Version: `AI-UX-R1 E4.1`  
> Status: `CONFIRMED / PARTIAL_LOCAL_VERIFIED / REPLACEMENT_PAIRING_CONFIRMATION_REQUIRED`

## 1. Grounded problem

The confirmed E4 run created and read back the fixed ProductWorkTurn SkillRelease, one standard Requirement aggregate, one owner assignment and the original authorized workspace binding. Pairing then stopped before any request was sent because the existing workspace identity cannot satisfy the Bridge contract:

- database workspace `workspace-bd7f64d2-d006-4817-bd21-40ae27b167e9` stores fingerprint `local:pfc-platform:m1-r1:20260906`;
- the pairing schema, Bridge repository and local registry require `sha256:<64hex>` and an exact fingerprint match;
- the workspace is labelled `product-full-chain-platform`, but that repository has no Git `HEAD` or origin from which a verifiable repository identity can be derived;
- the adjacent authoritative methodology repository `D:\项目管理\product-full-chain` has baseline `a64a8320882d33f4edc7628a9ec690c9418e42ee` and remote fingerprint `sha256:840447fd611a0c63460e4a1e2de98bec9bdd81e6e1fcda76ca660e67d3f23ad8`;
- no pairing, non-test Bridge, capability snapshot, work session or turn was created.

The immediate defect is not missing demonstration data. It is an invalid product workspace identity accepted by the application boundary and a mismatch between that product fact and the repository available to Bridge.

## 2. Goals, non-goals and assumptions

Goals:

1. Prevent new workspace records with unverifiable fingerprint formats.
2. Create one standard workspace whose identity can be proven against the authoritative methodology repository.
3. Bind the already-created E4 Requirement to that workspace through the normal owner API.
4. Resume the previously confirmed single-pairing, single-session and single-turn acceptance path without recreating completed facts.
5. Preserve complete audit, idempotency and recovery evidence.

Non-goals:

- changing or deleting the historical invalid workspace or its retained E4 binding;
- initializing Git, committing, configuring a remote or pushing the platform implementation repository;
- database migration, dependency install, `.env.local` edit, fixture/seed/direct SQL business setup;
- adding a second Requirement, assignment, ProductWorkSession or ProductWorkTurn;
- Zed handoff, MCP execution, remote environment, release or deployment.

Assumptions to verify before writes:

- the exact Requirement, assignment and original binding still exist once and have not drifted;
- the methodology repository baseline and fingerprint still equal the values above;
- the fixed SkillRelease remains `ACTIVE/PASSED`, risk `MEDIUM`, with enabled scope exactly `PRODUCT_WORK_TURN`;
- product-owner and product-manager memberships remain active and separated;
- the task-owned Bridge registry and credential paths do not already exist.

## 3. Options and selected proposal

### Option A - add a verified methodology workspace and strengthen input validation (recommended)

Enforce the repository fingerprint format at the domain/API boundary, create one new standard workspace representing the authoritative methodology repository, add one new Requirement binding, and use task-owned ignored Bridge configuration for E4.

Trade-off: this retains the historical invalid workspace as explicit legacy data and adds a second binding to the Requirement. It has the smallest truthful impact and does not invent Git identity for the implementation repository.

### Option B - rewrite the historical workspace identity

Add a mutation flow that changes the existing workspace label/fingerprint/path meaning.

Rejected because the existing workspace and binding are already retained lifecycle evidence. Reinterpreting the object would corrupt historical meaning and require broader concurrency, audit and rollback design.

### Option C - initialize and publish Git identity for the platform repository

Create a platform-repository commit and configure a remote so the existing workspace can be verified.

Rejected for this iteration because it expands into Git history, remote-governance and publication decisions and still does not make the implementation repository the authoritative product-methodology source.

Selected proposal: **Option A**, subject to explicit product-owner confirmation.

## 4. Proposed implementation and run-scoped authorization

Confirmation of this document authorizes only Sections 4.1-4.4 under the limits in Sections 5-8.

### 4.1 Source guard and modular ownership

Use TDD to add the smallest validation at existing module boundaries:

- `packages/domain/src/workspace.ts`: add an exported repository-fingerprint assertion accepting only `sha256:` plus 64 lowercase hexadecimal characters;
- `packages/domain/src/index.ts`: export the domain assertion;
- `apps/server/src/workspaces/application-service.ts`: enforce the assertion before workspace creation;
- `apps/server/src/workspaces/routes.ts`: align the HTTP schema pattern and error mapping with the domain rule;
- existing Team Admin workspace UI: extract the independently changeable workspace-registration form into `team-admin/WorkspaceRegistrationForm.tsx`, show an actionable format error using existing `@pfc/ui` components and tokens, and add no page-local visual values;
- tests: domain unit, workspace API validation, UI form/error behavior, Team Admin composition boundary, and existing Bridge exact-match regression.

No migration or repository schema change is planned. The historical row remains readable; only new invalid creation is rejected.

### 4.2 Exact additional standard effects

After source gates pass, use the normal `product.owner` API to create exactly one additional workspace:

- team ID: `team-aee2a8e2-e86a-4ecd-9b48-ea42df2d2fc1`;
- name: `产品全链路方法仓库`;
- repository label: `product-full-chain`;
- repository fingerprint: `sha256:840447fd611a0c63460e4a1e2de98bec9bdd81e6e1fcda76ca660e67d3f23ad8`;
- idempotency key: `PFC_AIUX_E41_WORKSPACE_20260908_R1`;
- workspace ID: server-generated and captured from the response only.

Then create exactly one additional binding from Requirement `REQUIREMENT_98db48a6-a9dd-4c23-bbba-e12ea783d849` to that returned workspace:

- allowed path: `docs`;
- access: `READ`;
- idempotency key: `PFC_AIUX_E41_BIND_20260908_R1`.

Maximum effects in this section are one workspace, one binding, and their normal audit/outbox/idempotency facts. No team, account, Requirement or assignment may be created or changed.

### 4.3 Task-owned Bridge configuration and one pairing

Create two ignored local files without overwriting any existing Bridge files:

- `.local/bridge/e4-standard-registry.json`: exactly one registry entry rooted at `D:\项目管理\product-full-chain`, allowed path `docs`, exact fingerprint above, and the fixed E4 SkillRelease;
- `.local/bridge/e4-standard-credential.json`: exclusive-create task credential storage; never print its value.

Use process-scoped configuration only; do not edit `.env.local`. Start one owned loopback Bridge for the new workspace and create exactly one pairing with idempotency key `PFC_AIUX_E41_PAIRING_20260908_R1`. Keep the pairing code in memory only and pass it to the existing Bridge client without logging it.

Pairing/capability readback must prove:

- returned workspace ID equals the new workspace from Section 4.2;
- repository fingerprint equals `sha256:840447fd611a0c63460e4a1e2de98bec9bdd81e6e1fcda76ca660e67d3f23ad8`;
- observed Git baseline equals `a64a8320882d33f4edc7628a9ec690c9418e42ee`;
- capability snapshot contains the fixed Skill release ID and source hash;
- protocol is exactly `product-work-turn/1`;
- listener remains loopback and exposes no Shell, Git, file-write, Zed or MCP tool capability.

Any identity/hash/baseline/protocol drift stops before session transmission.

### 4.4 Resume the original E4 remainder

After the corrected Bridge is verified, resume only the unused portion of the confirmed E4 package:

1. create or restore exactly one ProductWorkSession for the existing Requirement;
2. verify readiness selects the existing initial material ref and fixed SkillRelease;
3. submit exactly one turn with the already-confirmed prompt;
4. read back API/database/UI facts, restart owned application processes once, verify recovery by the same session ID, and close owned processes;
5. run proportional targeted tests, Quick, Core and Full gates and write redacted reports.

The already-created SkillRelease, Requirement, assignment and original binding may only be read and must not be replayed as writes.

## 5. Test-data and verification plan

The existing E4 Requirement contains approved synthetic `INTERNAL` data and remains the only business scenario. The runId is `PFC_AIUX_E41_20260908_R1`. No customer, employee, credential or restricted content is allowed.

Required assertions:

- boundary cases accept the one valid lowercase SHA-256 fingerprint and reject missing prefix, wrong length, uppercase hex, placeholder and arbitrary text;
- invalid workspace creation has zero database/audit/outbox/idempotency effects;
- valid fixed-key replay returns the same workspace and binding without duplicates;
- API, PostgreSQL and UI show the same new workspace identity and binding;
- Bridge pairing is exact-match and produces one fresh capability snapshot;
- the one work turn remains advice-only and produces no unexpected tool/action item;
- restart recovers the same session and retained events;
- final effect counts equal the package limits.

Durable redacted evidence belongs under `docs/quality-gate/reports/`. Credentials, pairing codes, cookies, CSRF values, connection URLs and raw model protocol payloads must not be recorded.

## 6. Exit criteria, acceptance and deferred scope

E4.1 is locally verified only when source tests and all proportional gates pass, the new workspace/binding/pairing read back exactly, the original single session/turn completes and recovers, and every owned temporary process is closed or explicitly reported.

This does not itself grant product acceptance. The representative workflow still requires visual and behavioral conclusions from the registered owners below; personnel availability is not a blocker:

- code review: `陈立`;
- testing: `陈立`;
- security: `陈立`.

Release, deployment, external effect, Zed handoff, MCP execution and remaining M2/M3 Units remain deferred. After E4.1 evidence, control returns to the parent POD delivery ledger rather than implying platform completion.

## 7. Risk, rollback and stop conditions

Risks and controls:

- duplicate identity: exact idempotency keys, zero-write preflight and post-write counts;
- historical evidence corruption: never mutate or delete the old workspace/binding;
- repository drift: re-read HEAD and remote fingerprint immediately before pairing;
- credential leakage: exclusive ignored credential file, redacted evidence and process cleanup;
- partial transaction or permission bypass: stop, preserve evidence and do not compensate by direct SQL;
- resource leakage: retain a process inventory and close API/Web/Bridge/browser/test processes at handoff.

Rollback before pairing is process shutdown plus retention of valid lifecycle facts. After pairing or transmission, correct forward through normal APIs and preserve audit evidence; do not delete facts to simulate rollback.

Stop on wrong host/database/schema, unexpected existing task-owned files, source/hash/baseline drift, invalid or duplicate workspace/binding, non-loopback listener, more than one pairing/session/turn, unexpected tool/action item, credential exposure, failed gate, unowned process or cleanup uncertainty.

## 8. Version plan, parallelism and observability

- current version: `AI-UX-R1 E4.1`, limited to workspace identity validation and completion of the already-started E4 standard-local run;
- deferred version work: historical workspace remediation policy, broader workspace verification lifecycle, Zed/MCP and remaining M2/M3 Units;
- parallel-agent strategy: none; source guard and standard execution touch the same identity contract and will run serially;
- expected load/cost: one workspace, one binding, one pairing, one session and one turn; no meaningful capacity change;
- observation: inspect audit/outbox/Bridge/session event ordering during the run and after one application restart.

## 9. Confirmation required

To authorize Option A and the exact additional effects in Section 4, reply:

`确认 AI-UX-R1 E4.1 工作区身份修正方案 A 及第 4 节实施授权范围`

That confirmation authorizes the source/test change, exactly one new workspace and one additional binding, the two task-owned ignored local Bridge files, one pairing/capability flow, and then the still-unused one-session/one-turn remainder of the original E4 package. It does not authorize mutation/deletion of legacy facts, another Requirement/assignment/session/turn, migration, dependency change, `.env.local` edit, Git initialization/commit/remote operation, Zed/MCP, release or deployment.

## 10. Execution outcome and bounded deviation

The product owner confirmed Option A and Section 4 on 2026-09-08. The source guard, one new methodology workspace, one additional `docs/READ` Requirement binding and the task-owned registry were completed and independently read back.

Execution stopped during Section 4.3 after one pairing had already been created. The API inherited the legacy non-secret local setting `PFC_LOCAL_TEST_RUN_ID=M2_R1_REAL_20260906`, so the pairing and resulting Bridge received `CODEx_TEST_` identifiers while writing to the standard `pfc` schema. This conflicts with the current test-data policy even though the normal HTTP application boundary was used.

Containment used the documented correct-forward rollback:

- the affected Bridge was revoked through the normal owner API with fixed idempotency key `PFC_AIUX_E41_REVOKE_MISCONFIGURED_20260908_R1`;
- its task credential file was removed after exact-path validation;
- no capability snapshot, ProductWorkSession or ProductWorkTurn was created;
- the consumed pairing, revoked Bridge, workspace verification fact and audit/outbox history remain retained and are not rewritten or deleted;
- source, targeted tests, Quick, Core, Full and real Team Admin UI checks passed after containment.

The confirmed one-pairing limit has been consumed. A second pairing is outside this document's authorization even though it is required to finish the original one-session/one-turn objective. The only next route is the separately bounded replacement-pairing correction package.
