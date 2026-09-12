# AI-UX-R1 E4.1 replacement pairing correction package

> Classification: System Iteration / strict / standard local integration correction  
> Status: `AWAITING_PRODUCT_OWNER_CONFIRMATION / NOT_AUTHORIZED`  
> Date: 2026-09-08  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`  
> Exact environment: `127.0.0.1:5432 / pfc_local / pfc`

## 1. Grounded problem and goal

E4.1 Option A correctly created the canonical methodology workspace and its second Requirement binding. The first pairing then inherited legacy `PFC_LOCAL_TEST_RUN_ID` configuration and created test-prefixed pairing/Bridge IDs in standard `pfc`. The Bridge was revoked before capability, session or turn creation.

The goal is to make that configuration class fail closed, create exactly one non-test replacement pairing/Bridge, and complete the already-approved one-session/one-turn E4 remainder. The historical revoked attempt remains visible.

## 2. Options and selected proposal

### Option A - govern the configuration and create one replacement pairing (recommended)

Add a startup/quality-gate guard preventing a non-empty local test run ID from being used with the standard product schema, blank only that legacy key in ignored `.env.local`, then create one replacement pairing with normal server IDs.

This prevents recurrence and preserves audit history. It adds one source guard, one ignored local-config correction and one additional pairing/Bridge beyond the original E4.1 limit.

### Option B - process override only

Start the API with `PFC_LOCAL_TEST_RUN_ID=''` and retry without a durable guard.

Rejected because the unchanged local file can silently affect a future standard-schema run again.

Selected proposal: **Option A**, subject to explicit product-owner confirmation.

## 3. Non-goals and retained facts

This package does not authorize another workspace, Requirement binding, Requirement, assignment, SkillRelease or historical-fact mutation. It does not authorize direct SQL writes/deletes, migration, dependency change, Git mutation, Zed/MCP, remote environment, release or deployment.

Retained and reused without recreation:

- Requirement `REQUIREMENT_98db48a6-a9dd-4c23-bbba-e12ea783d849`;
- workspace `workspace-86b7d8df-74b1-4aa0-8332-39a4d12d3235` and its `docs/READ` binding;
- SkillRelease `skill-pfc-ai-product-work-session-20260908-r1` with its exact source hash;
- `.local/bridge/e4-standard-registry.json`;
- the consumed first pairing and revoked first Bridge with their audit/outbox history.

## 4. Proposed implementation and run-scoped authorization

Confirmation of this document authorizes only Sections 4.1-4.4 under Sections 5-7.

### 4.1 Test-ID configuration guard

Use TDD to:

1. make application startup reject a non-empty `PFC_LOCAL_TEST_RUN_ID` whenever the resolved product schema is standard `pfc`;
2. extend delivery-governance validation so a non-empty local value fails before a gate can start standard-product work;
3. add focused unit/config tests for blank, missing, valid isolated-test use and forbidden standard-schema use;
4. change only the ignored local line to `PFC_LOCAL_TEST_RUN_ID=`; do not expose or alter any credential or database URL.

No migration or product row is allowed in this subsection.

### 4.2 One replacement pairing and Bridge

After targeted tests and Quick pass, perform a zero-write preflight proving the prior Bridge is `REVOKED`, capability/session/turn counts remain zero, the canonical workspace/binding/registry/Skill are unchanged, and repository baseline/fingerprint still match.

Then:

1. start a fresh owned loopback API/Web process with AI workspace enabled and test run ID absent;
2. create exactly one replacement pairing using idempotency key `PFC_AIUX_E41_REPLACEMENT_PAIRING_20260908_R1`;
3. create `.local/bridge/e41-replacement-credential.json` by exclusive create, keep the pairing code in memory only, and pair one owned local Bridge;
4. require the returned pairing and Bridge IDs not to start with `CODEx_TEST_`;
5. verify the exact workspace ID/fingerprint, `docs` path, Git baseline `a64a8320882d33f4edc7628a9ec690c9418e42ee`, protocol `product-work-turn/1`, fixed Skill ID/hash and one fresh capability snapshot.

The allowed additional effects are one pairing, one Bridge registration, one Bridge workspace binding, normal capability/heartbeat facts, and their normal audit/outbox/idempotency evidence. This is explicitly the second total pairing/Bridge attempt; the first remains revoked.

### 4.3 Complete the unused E4 remainder

Using the existing `product.manager` account and existing Requirement:

1. create or restore exactly one ProductWorkSession;
2. verify readiness selects the existing initial material ref and fixed SkillRelease;
3. submit exactly one turn with the previously confirmed advice-only prompt;
4. reject and stop on any dynamic tool, action item, file/Git/Shell/Zed/MCP/network operation or unknown active item;
5. read back the completed response and hashed external thread/turn evidence without storing raw protocol payloads.

At most one scoped transmission authorization may be created only if the normal API explicitly requires it. No second session or turn is allowed.

### 4.4 Recovery, gates and cleanup

Restart the owned API/Web once and verify recovery by the same session ID. Reconcile API, PostgreSQL and UI facts; run targeted tests, Quick, Core and Full; remove the task credential after shutdown; close all owned API/Web/Bridge/Codex/browser/test processes. PostgreSQL may remain because it pre-existed this run.

Write a redacted report containing exact IDs, counts, status, event ordering, cleanup and residual risk. Do not print passwords, cookies, CSRF values, pairing codes, Bridge credentials, database URLs or raw model protocol.

## 5. Test data, impact limits and acceptance

The only business scenario remains the approved synthetic `INTERNAL` E4 Requirement. No new fixture, seed or arbitrary convenience data is allowed.

Maximum new standard effects after confirmation:

- one replacement pairing, Bridge registration and Bridge workspace binding;
- one fresh capability snapshot plus bounded heartbeat/message receipts;
- one ProductWorkSession and one ProductWorkTurn;
- normal selected-context, command, event, audit, outbox and idempotency facts;
- at most one transmission authorization if demanded by the product flow.

Implementation/integration may become `LOCAL_VERIFIED` after all readbacks and gates pass. Code review, testing and security owners are registered as 陈立; product acceptance depends on their evidence-backed conclusions and the representative product result, not on personnel availability. Release remains unauthorized.

## 6. Risk, rollback and stop conditions

- Configuration recurrence: startup plus governance checks fail closed; `.env.local` changes only the one non-secret test-run key.
- Duplicate effect: fixed replacement idempotency key, exact pre/post counts and no retry after a created pairing without a new decision.
- Identity drift: re-read Git baseline, remote fingerprint, registry and Skill hash immediately before pairing.
- Credential risk: exclusive ignored file, in-memory pairing code, redacted output and deletion after shutdown.
- Partial or unknown result: revoke the replacement Bridge through the owner API when necessary, stop before session transmission where possible, preserve all evidence and never delete lifecycle rows.

Stop on wrong host/database/schema, non-empty effective test run ID, source/hash/baseline drift, prior Bridge not revoked, unexpected existing credential file, non-loopback listener, duplicate or test-prefixed replacement ID, more than one replacement pairing/session/turn, unexpected tool/action item, credential exposure, permission bypass, failed final gate or cleanup uncertainty.

## 7. Version, process and next route

- Current version: `AI-UX-R1 E4.1 correction`.
- Parallel agents: none; configuration, pairing and session state are tightly coupled and run serially.
- Expected load/cost: one local Bridge, one local Codex session and one bounded turn; no capacity claim.
- Rollback: process shutdown before transmission; correct-forward revocation and retained evidence after pairing.
- Success route: return to `POD-PFC-001/M2/AI-UX-R1` closeout and named acceptance review.
- Failure route: remain at this package with the exact stop evidence; do not automatically create another pairing.

## 8. Confirmation required

To authorize Option A and the exact Sections 4.1-4.4 scope, reply:

`确认 AI-UX-R1 E4.1 替代配对修正方案 A 及第 4 节实施授权范围`

This confirmation does not authorize release, deployment, Zed/MCP, remote mutation, another workspace/Requirement/binding/Skill, or deletion of the retained failed attempt.
