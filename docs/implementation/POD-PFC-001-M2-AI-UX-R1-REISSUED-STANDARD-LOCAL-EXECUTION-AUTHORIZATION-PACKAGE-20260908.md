# AI-UX-R1 E4 reissued standard local execution authorization package

> Classification: System Iteration / strict / standard local integration  
> Status: `CONFIRMED / BLOCKED_BY_WORKSPACE_IDENTITY_MISMATCH`  
> Date: 2026-09-08  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> CAP / Unit scope: `CAP-PFC-01 / UNIT-PFC-01-02`, `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`  
> Exact environment: `127.0.0.1:5432 / pfc_local / pfc`
> Confirmation: on 2026-09-08 the product owner replied `继续` directly after the exact E4 Sections 3-5 scope was restated; it is recorded only as confirmation of that bounded package.

## 1. Purpose and authorization boundary

This package requests one run-scoped authorization to prove the corrected normal product path from a new standard Requirement through one retained ProductWorkTurn. It does not authorize direct SQL/seed/fixture setup, legacy baseline backfill, migration, dependency change, remote Git, SIT/production, release or deployment.

Authorization begins only after the product owner confirms this exact package and expires when the readback/cleanup record is written or any stop condition fires. Auto-review may approve only concrete actions inside this package and cannot broaden it.

## 2. Confirmed prerequisite evidence

- Option B source correction is `LOCAL_VERIFIED`; targeted tests, Quick, Core and Full passed.
- Fixed Skill source: `skills/pfc-ai-product-work-session/SKILL.md`.
- Skill identity: `pfc-ai-product-work-session / 2026.09.08-r1 / skill-pfc-ai-product-work-session-20260908-r1`.
- Exact source hash: `sha256:7ab40c7367bbe49a12c1c9fb69c1e51196981711e5fa378f40da6a4b50da8ef0`.
- Required capability and enabled scope: exactly `PRODUCT_WORK_TURN`; risk `MEDIUM`; owner `产品平台组`.
- Standard readback on 2026-09-08: `product.manager`, `product.owner` and `test.owner` are active; team `team-aee2a8e2-e86a-4ecd-9b48-ea42df2d2fc1` and workspace `workspace-bd7f64d2-d006-4817-bd21-40ae27b167e9` exist; workspace path is `docs`, status `ACTIVE`, verification `UNVERIFIED`; active ProductWorkTurn SkillRelease count and non-test Bridge count are both zero; AI workspace flag is absent.
- The legacy candidate baseline remains at zero refs and will not be modified. This run creates a new Requirement through the normal application path.

## 3. Exact actors and standard content

| Role                       | Login / account ID                                                 | Allowed action                                                                               |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Product manager            | `product.manager` / `account-7ab4dbfd-91a4-4861-9d69-348ce3071d0c` | create the Requirement/session/turn and read results                                         |
| Product owner / team admin | `product.owner` / `account-1582381b-303b-4254-b8c6-07b5cda6d7b6`   | assign/bind, create pairing, grant only if the API requires it, accept representative result |
| Test owner                 | `test.owner` / `account-817a5eef-08a7-457b-9b04-2c24d0675ab3`      | read-only verification; no product action                                                    |

The one allowed Requirement payload is:

- name: `AI 产品作业首轮标准本地验收`;
- original idea: `验证产品经理可从已登记的需求与初始材料启动 AI 作业首轮，并获得可审计建议。`;
- source type: `INTERNAL_IMPROVEMENT`;
- business owner: `account-7ab4dbfd-91a4-4861-9d69-348ce3071d0c`;
- material purpose: `FACT`;
- sensitivity: `INTERNAL`.

The one allowed turn prompt is `请基于当前需求与初始材料，梳理目标、范围、风险和待确认问题，仅输出建议，不执行任何文件或外部系统变更。` No customer, employee, credential, restricted or unknown-sensitivity content is allowed.

## 4. Authorized actions and impact limits

Perform in this order and stop if a prerequisite does not read back:

1. Recheck the database/host/schema, fixed Skill hash, active actors/team/workspace, absent standard ProductWorkTurn Skill/Bridge, and default-off flag without writes.
2. Run `npm run local:skill:register-ai-product-work -- --owner 产品平台组` once. It may insert at most the one fixed SkillRelease above; exact replay is allowed, any drift stops.
3. Start owned API/Web processes on loopback with `PFC_AI_WORKSPACE_ENABLED=true` only in their process environment. Do not edit `.env.local`.
4. As `product.manager`, use the normal Requirement UI/API with one fixed idempotency key to create the exact complete G0 payload. It may create exactly one Requirement, one current baseline, one initial material ref, one timeline event, one outbox event and one idempotency record. Capture server-returned IDs; do not preselect or rewrite them.
5. As `product.owner`, use existing assignment/workspace APIs to bind only that Requirement to the exact team, product manager and workspace/path `docs`. No additional team, account or workspace may be created.
6. Use the existing team-admin pairing UI/API to create one short-lived pairing. Exchange it with one owned local Bridge bound to the exact workspace, then require `VERIFIED` workspace/path and one fresh capability snapshot containing the exact Skill release ID/hash and `product-work-turn/1`. Pairing code and credentials must not be logged or persisted outside existing digest storage.
7. Create or restore exactly one Web work session for the new Requirement, verify readiness recommends the returned initial material ref and fixed Skill, then submit exactly one turn with the fixed prompt. No dynamic MCP tools, shell, Git, file write, web search or collaboration action is allowed.
8. Read back the retained Requirement/baseline/ref/assignment/workspace/Skill/Bridge/session/turn/command/event facts through API, database and UI; restart the owned application once and verify recovery by the same session ID.
9. Close owned API/Web/Bridge/Codex/browser processes. Process exit restores the AI workspace flag to false. The existing PostgreSQL service may remain.

Maximum standard effects are one fixed SkillRelease, one new Requirement aggregate, one assignment, one workspace binding, one Bridge pairing/registration/binding with bounded capability/heartbeat facts, one session, one turn, its selected context/command/events and at most one scoped transmission authorization if the server explicitly requires it. No second Requirement, session or turn is authorized.

## 5. Retention, rollback and evidence

The standard Requirement, SkillRelease, verified Bridge registration, session and turn facts are retained as acceptance evidence. Do not delete lifecycle facts to simulate rollback. Before transmission, rollback is process shutdown; after transmission, correct forward and preserve audit evidence. A wrong or compromised Bridge must be revoked through the normal API before shutdown.

Evidence must record exact returned IDs, content hash, row versions, event ordering, idempotent replay result, capability snapshot match, external thread/turn references in redacted or hashed form, UI recovery, database/API equality, created-data retention, process PIDs/ports and cleanup. Never print credentials, pairing codes, cookies, connection URLs, material body beyond the approved synthetic text or raw model protocol payloads.

Code review, testing and security owners are registered as 陈立. Product acceptance depends on their evidence-backed conclusions and the representative task conclusion, not on personnel availability.

## 6. Stop conditions and exclusions

Stop on wrong host/database/schema, source/hash/version drift, non-loopback listener, fixture/seed/direct-table bypass, legacy baseline mutation, duplicate aggregate, more than one turn, RESTRICTED/unknown content, workspace mismatch, expired or mismatched capability snapshot, unexpected tool/action item, credential exposure, partial transaction, permission bypass, `UNKNOWN` shown as success, failed gate, unowned process or cleanup uncertainty.

Explicitly excluded: `.env.local` edit, migration, historical backfill, arbitrary material upload, new dependency, firewall change, remote target, commit/push/merge, release/deployment, Zed handoff, MCP tool execution and CAP-PFC-05.

## 7. Confirmation and next route

The exact package was confirmed on 2026-09-08 by a direct `继续` response after the bounded Sections 3-5 scope was restated. This authorizes only Sections 3-5 under the limits and stop conditions above; it does not authorize acceptance, release or deployment.

Current POD route: `POD-PFC-001/M2/AI-UX-R1/workspace-identity-remediation-design-confirmation`.

Execution checkpoint: the fixed SkillRelease and the one permitted Requirement aggregate were created and read back on 2026-09-08. The Requirement create replay returned the same IDs without a duplicate. Execution paused before assignment because the temporary `product.owner` browser context was closed and its Cookie could not be restored safely. No assignment, new workspace binding, pairing, Bridge, work session or turn request was sent after that loss. The next action is only local `product.owner` reauthentication in the retained first browser window; it does not authorize another SkillRelease or Requirement.

Successor blocker: after owner reauthentication, the exact assignment and original-workspace `docs/READ` binding were created and read back. Pairing preflight then found that the authorized workspace stores `local:pfc-platform:m1-r1:20260906`, while both the Bridge registry and pairing contract require a verified Git remote fingerprint in `sha256:<64hex>` form. The labelled platform repository also has no Git `HEAD` or origin. No pairing was created. The authorized run is stopped at this mismatch; the proposed correction is documented in `POD-PFC-001-M2-AI-UX-R1-WORKSPACE-IDENTITY-REMEDIATION-DESIGN-20260908.md` and requires separate confirmation because it adds one standard workspace and one additional binding.
