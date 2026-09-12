# POD-PFC-001 M2 AI-UX-R1 implementation checkpoint

> Parent POD / Milestone: `POD-PFC-001 / M2`  
> Scope: `CAP-PFC-01/02/03/04`  
> Status: `E42_IMPLEMENTED / STANDARD_WINDOW_VERIFIED / SCOPE_DRIFT_REVOKED / AUTOMATED_GATES_PASS / AI_UX_R1_ACCEPTED / PILOT_OBSERVATION_PENDING`  
> Current route: `POD-PFC-001/M2/R3/design-confirmation`

## Stage A closeout

- Implementation: `LOCAL_VERIFIED` for versioned work-session contracts, session/turn/proposal state machines, typed proposal whitelist, role-action mapping, and scoped material-transmission authorization.
- Integration: `IN_PROGRESS`; no AI-UX tables exist in standard `pfc` and no standard product capability is claimed.
- Tests: focused TDD red confirmed, then 5 files / 22 tests PASS; full Quick gate PASS with 69 files / 315 tests.
- Security: final transmission targets are limited to `APPROVED_AI/APPROVED_SKILL`; restricted data requires an exact deterministic scope hash; grant duration is at most 30 minutes; UNKNOWN convergence requires read-only verification/readback.
- Deferred: migration/repository/API/SSE, Bridge/Codex, UI kit and representative page, standard 006/007 migration, named acceptance and release.

## Acceptance and ownership

- Product owner / engineering owner: 陈立.
- Code review: `陈立 / PASS`.
- Testing: `陈立 / PASS`.
- Security: `陈立 / PASS`.
- Acceptance: Stage D representative-page visual acceptance was confirmed on 2026-09-07. Standard-local integration, bounded observation, scope-drift revocation and the three evidence-backed technical conclusions are complete; AI-UX-R1 is `ACCEPTED_LOCAL`. Pilot observation and release remain separate later phases.

## Stage B closeout

- Implementation: `LOCAL_VERIFIED` for candidate migrations 006/007, scoped-authorization and work-session repositories, versioned HTTP contracts, ETag/idempotency checks, SSE replay, and the default-off feature flag.
- Integration: `LOCAL_VERIFIED` only in `codex_test_aiux_*`; eight AI-UX tables, persisted sessions/turns/contexts/proposals/commands/events, exact grant/revoke, API recovery and role denial were read back.
- Tests: focused PostgreSQL/API tests 2 files / 7 tests PASS; Quick 70 files / 316 tests PASS; Core 24 integration files / 108 tests PASS; cleanup check reported zero test schemas; all three workspaces built.
- Standard schema: 006/007 were not applied to `pfc`. Their standard `up` path fails closed unless the exact migration authorization key is present.
- Deferred: true Bridge/Codex work turn, UI kit and representative page, standard migration authorization, named acceptance and release.

## Stage C closeout

- Implementation: `LOCAL_VERIFIED` for the independent `product-work-turn/1` protocol, capability negotiation, authenticated context fetch, Bridge worker/session pool, ephemeral read-only Codex session, fixed Skill, typed proposal conversion, cancellation, verification, and fail-closed UNKNOWN handling.
- Integration: `LOCAL_VERIFIED` through loopback HTTP, isolated PostgreSQL, the real local Bridge adapter, and the real Codex App Server using deterministic synthetic context only. Standard `pfc` remains unchanged.
- Tests: protocol/session/worker/API and persistence focused suites PASS; the true local acceptance report records `COMPLETED`, `CANCELLED`, and `UNKNOWN/BLOCKED -> VERIFY_TURN`, with all owned App Servers and the loopback server closed and the isolated schema dropped (`schemaRemainingTableCount=0`).
- Security: product turns use `approvalPolicy=never`, a read-only no-network sandbox, no registered dynamic tools, an allowlist of passive App Server item types, and immediate interruption on command/file/MCP/search/collaboration or any unknown active item. Only safe structured failure categories are retained.
- Deferred: UI Kit additions and representative page, standard 006/007 migration authorization, named acceptance, product-owner three-width visual acceptance, release, observation, Zed handoff, and MCP evidence.

## Stage D closeout

- Implementation: `LOCAL_VERIFIED` for the reusable AI workspace token/component/template set in `packages/ui`, the `/ui-kit` catalog entry, the modular `/requirements/:requirementId/work` page, server-owned snapshot/SSE state, explicit proposal confirmation, UNKNOWN recovery, URL session preservation, and honest unavailable MCP/Zed/Git states.
- Architecture: authenticated route matching was split from `App.tsx` into `AuthenticatedPlatformRoutes.tsx`; the architecture test constrains both modules and prevents independently routed pages from accumulating in the top-level application file.
- Integration: `LOCAL_VERIFIED` through an isolated `codex_test_aiux_*` PostgreSQL schema, real Fastify HTTP/SSE, real local Bridge, real Codex App Server, and Edge/Playwright. The final turn was read back as `COMPLETED` with a visible response and concrete turn/Skill/Bridge/external-thread evidence.
- Visual evidence: 1280x720 and 1440x900 use the two-column workspace plus context drawer; 1920x1080 uses context/work stream/artifact three-column layout. All three have 13 lifecycle steps, no horizontal overflow, deterministic keyboard focus, zero target-page console errors, and screenshots under `output/playwright/ai-ux-r1-d/`.
- Product-owner visual acceptance: confirmed on 2026-09-07 with `确认 AI-UX-R1 Stage D 视觉验收，并授权 006/007 标准本地迁移包`; this closes the Stage D visual acceptance item only.
- Test data: deterministic synthetic content only; no customer or employee data. The final isolated schema was dropped and read back with `schemaRemainingTableCount=0`; Vite, Fastify, Edge, Bridge worker, and owned App Server processes were closed.
- Quality gates: Quick `PASS` (75 files / 332 tests), Core `PASS` (26 integration files / 114 tests plus builds and PostgreSQL check), Full `PASS` (36 PC E2E, permission, concurrency, recovery, 11 security checks with 0 findings, performance smoke, and dependency audit with 0 vulnerabilities).
- Standard migration: the authorized 006/007 package was applied to loopback `pfc_local/pfc` on 2026-09-07. Hash binding matched, preflight passed, execution created eight tables and zero business rows, independent readback found two migration records/eight tables/five indexes, and the post-migration Core Gate passed. This establishes `STANDARD_SCHEMA_READY` only.
- Deferred/blockers: standard local business integration/data/readback, named code review/testing/security conclusions, release, observation, Zed handoff, and MCP evidence. A newly created empty session still requires a confirmed source/Skill selection design before it can launch its first turn without pre-existing bindings; this is not hidden by seed data.

## Stage E E1-E3 closeout

- Implementation: `LOCAL_VERIFIED` for the server-owned first-turn readiness projection, deterministic context/Skill recommendation, same-current-snapshot Skill hash matching, exact transmission grant/revoke, and a modular readiness application service. The existing session lifecycle service retains a facade and the architecture test prevents readiness orchestration from returning to the oversized file.
- Web: `LOCAL_VERIFIED` for explicit context/Skill selection, selection-aware RESTRICTED authorization state, first-turn submission without historical turns, refresh recovery, and the reusable `ReadinessPanel` catalog entry. A user can remove a restricted item and submit the remaining authorized subset; an active exact grant survives reload.
- Integration: `LOCAL_VERIFIED` only through disposable `codex_test_aiux_*` PostgreSQL schemas and deterministic synthetic data. The real loopback Fastify/Bridge/Codex App Server chain read readiness as `READY`, completed the first turn with visible response and hashed external-thread evidence, verified cancellation and `UNKNOWN -> VERIFY_TURN`, then closed owned processes and read back `schemaRemainingTableCount=0`.
- Review fixes: an invalid or expired latest Bridge snapshot no longer falls back to an older valid snapshot; the legacy live harness now binds the real Skill file hash into the same synthetic capability snapshot before readiness; `material_refs.source` is deliberately excluded from readiness because it may contain material body content.
- Visual evidence: the real route was exercised at 1280x720, 1440x900 and 1920x1080 with no horizontal/readiness overflow or console error. Evidence is stored under ignored `output/playwright/ai-ux-r1-e/`; this is engineering visual evidence, not a new product-owner visual acceptance request because Stage D's accepted shell/tokens are unchanged.
- Standard boundary: no standard `pfc` business row, feature flag, `.env.local`, migration, remote Git target, SIT/production or release state was changed. E4 must separately authorize exact standard account, Requirement/material/Skill/Bridge targets, retained IDs, flag handling, stop conditions and readback.
- Acceptance: Stage D visual acceptance remains confirmed. AI-UX-R1 overall acceptance remains `BLOCKED` pending standard-local first-turn evidence and named code review/testing/security conclusions.

## Current conclusion

- Parent POD / milestone: `POD-PFC-001 / M2`.
- CAP/Unit scope: cross-cutting `CAP-PFC-01/02/03/04`; the 5 CAP / 26 Unit authority set is unchanged.
- Implementation: AI-UX-R1 A-E3 and the confirmed standard-prerequisite source correction `LOCAL_VERIFIED`.
- Integration: readiness-to-first-turn is `LOCAL_VERIFIED` through isolated PostgreSQL/API/Bridge/Codex/UI. Standard workspace identity and Requirement binding are verified; the E4.1 test-ID Bridge and the E4.2 scope-drift Bridge are both revoked with retained audit history. The accepted E4.2 bounded observation and standard workbench recovery evidence are complete.
- Acceptance: AI-UX-R1 is `ACCEPTED_LOCAL`; code review, testing and security conclusions are each `PASS` with 陈立 registered for all three roles. This does not complete M2, the platform-wide observation window or release.
- Release/observation: `NOT_AUTHORIZED / NOT_STARTED`.
- POD next route: `POD-PFC-001/M2/R3/design-confirmation`.

## Stage E execution record

- The product owner confirmed the Stage E design and Section 13 implementation scope on 2026-09-07.
- E1-E3 source, isolated data, UI, browser and real local Codex evidence are complete. Detailed automated evidence is recorded in `docs/quality-gate/reports/POD-PFC-001-M2-AI-UX-R1-STAGE-E-20260908.md` and the redacted real-chain JSON report.
- E4 zero-write preflight completed on 2026-09-08. Candidate account/team/Requirement/baseline/workspace facts exist, but the baseline has zero material refs, the formal Skill repository cannot register `PRODUCT_WORK_TURN`, no standard ProductWorkTurn SkillRelease/Bridge exists, and the workspace remains unverified.
- The E4 package is therefore `BLOCKED_BY_STANDARD_PREREQUISITES / NOT_AUTHORIZABLE`; no standard row or flag was changed. The next action is product-owner confirmation of the minimal normal-path remediation design. Implementation authorization does not carry forward to standard data writes or flag changes.

## Standard prerequisite remediation closeout

- The product owner confirmed Option B and Section 10 implementation scope on 2026-09-08.
- Complete G0 creation and later G0 completion now create exactly one immutable `ORIGINAL_IDEA` material ref in the existing aggregate transaction. The ref preserves the exact stored idea, version 1, inherited sensitivity, logical `pfc://` location and exact SHA-256; incomplete G0 still creates neither baseline nor ref.
- `SKILL_RELEASE_SCOPES` now adds only `PRODUCT_WORK_TURN`; legacy `AGENT_RUN_OPERATIONS` is unchanged. The fixed ProductWorkTurn manifest and guarded loopback-only idempotent registration command are implemented, but the command has not been executed against standard `pfc`.
- Targeted verification passed: 14 unit/contract tests and 29 isolated PostgreSQL tests. Quick, Core and Full gates passed; Full included 349 unit/contract, 121 integration, 44 permission, 20 concurrency, 32 recovery, 25 security, 3 performance and 39 PC E2E tests, plus zero security findings and zero dependency vulnerabilities.
- The first Quick attempt correctly failed because an outer npm process selected Node 18; activating the project Node 24 path fixed the environment. The first Core attempt found one stale material-library expectation (one old evidence ref versus the new initial ref plus old evidence); the corrected two-ref assertion passed. One final read-only standard query repeated the known wrong-column attempt before the corrected workspace join; neither query wrote data.
- Final standard readback remains unchanged: the old candidate baseline has zero refs, active ProductWorkTurn SkillRelease count is zero, non-test Bridge count is zero, the candidate workspace is `UNVERIFIED`, and the process-scoped AI workspace flag is absent. The replacement E4 package therefore starts with one new normal Requirement rather than backfilling legacy facts.
- No standard row, `.env.local`, migration, dependency, remote Git target, release or deployment state changed. The reissued E4 package is prepared but remains unauthorized until separately confirmed.

## E4 standard-local execution start

- The product owner confirmed the exact reissued E4 Sections 3-5 scope on 2026-09-08 by replying `继续` directly after the bounded package was restated. This does not authorize acceptance, release or deployment.
- The zero-write preflight passed against `127.0.0.1:5432 / pfc_local / pfc`: all three actors and exact memberships are active; the team/workspace/path match; the legacy baseline still has zero refs; the fixed SkillRelease, non-test Bridge, standard ProductWorkSession and ProductWorkTurn counts are zero; the exact Requirement name is unused; the fixed Skill source hash matches; and `.env.local` has no AI workspace flag.
- E4 is now `EXECUTION_IN_PROGRESS`. The next permitted effect is the one fixed SkillRelease registration.
- The fixed SkillRelease was registered once as `skill-pfc-ai-product-work-session-20260908-r1` and read back `ACTIVE/PASSED`, exact hash, risk `MEDIUM`, and enabled scope `PRODUCT_WORK_TURN` only.
- `product.manager` created the one permitted Requirement through the normal HTTP application boundary with the fixed idempotency key. Returned facts are Requirement `REQUIREMENT_98db48a6-a9dd-4c23-bbba-e12ea783d849`, baseline `BASELINE_32da5ac2-0a7b-4a03-925d-df8b00c51769`, and initial material ref `MATERIAL_b7fad5f0-6903-49bb-86b4-d974e16e3a84`; database readback found exactly one timeline, outbox and idempotency row and one exact Requirement name. The exact replay returned HTTP 200 and the same IDs.
- Execution paused before the first owner mutation because the temporary `product.owner` browser page was closed and its Cookie could not be reconstructed safely. The attempted assignment automation stopped before issuing HTTP. Assignment, new workspace binding, pairing, non-test Bridge, ProductWorkSession and ProductWorkTurn effects remain absent.
- The only next route is local `product.owner` reauthentication in the retained first browser window, then resume at assignment. No second SkillRelease or Requirement is permitted.
- Owner reauthentication was completed on resume. The exact `PRODUCT_MANAGER` assignment and the authorized workspace binding `workspace-bd7f64d2-d006-4817-bd21-40ae27b167e9 / docs / READ` were created through the normal API and independently read back; each fixed idempotency key has exactly one record.
- Pairing preflight stopped before creating a pairing: the database workspace fingerprint `local:pfc-platform:m1-r1:20260906` is incompatible with the mandatory `sha256:<64hex>` Bridge contract, while the labelled platform repository has neither Git `HEAD` nor origin. The adjacent methodology repository has Git baseline `a64a8320882d33f4edc7628a9ec690c9418e42ee` and fingerprint `sha256:840447fd611a0c63460e4a1e2de98bec9bdd81e6e1fcda76ca660e67d3f23ad8`.
- No pairing, non-test Bridge, capability snapshot, ProductWorkSession or ProductWorkTurn was created. The next route is confirmation of the normal-path workspace identity remediation design; the prior `继续` does not authorize its additional workspace/binding effects.

## E4.1 workspace identity remediation checkpoint

- The product owner confirmed Option A and Section 4 on 2026-09-08.
- Repository fingerprint validation is enforced in the domain, application service, HTTP schema and Team Admin form. The registration form is a separate feature component protected by an architecture test.
- Targeted verification passed with 4 files / 21 tests. Final Quick passed with 80 files / 359 tests; Core passed with 26 integration files / 122 tests, cleanup 0 and all builds; Full passed with 39 Edge E2E, permission, concurrency, recovery, security, performance and zero high dependency vulnerabilities.
- Standard workspace `workspace-86b7d8df-74b1-4aa0-8332-39a4d12d3235` and exactly one additional `docs/READ` binding were created through normal owner APIs. The E4 Requirement now has exactly two bindings: the retained legacy binding and the new methodology-workspace binding.
- Real Team Admin verification at 1440x900 showed the methodology workspace as `VERIFIED`. An uppercase fingerprint produced the actionable validation message and zero workspace POST requests, with zero page/console errors.
- The one authorized pairing inherited legacy `PFC_LOCAL_TEST_RUN_ID=M2_R1_REAL_20260906`; its pairing and Bridge consequently received `CODEx_TEST_` IDs in standard `pfc`. This violates the current test-data policy and is not valid standard integration.
- The affected Bridge `CODEx_TEST_M2_R1_REAL_20260906_bridge-19b62fd9-ce8c-4e76-8eef-2cbcac5e0845` was revoked through the normal owner API with fixed idempotency evidence. Its task credential was deleted. Readback found one consumed pairing, one revoked Bridge, zero capability snapshots, zero ProductWorkSessions, zero ProductWorkTurns and zero remaining test schemas.
- The failed pairing/Bridge and all audit/outbox facts are retained. No direct SQL mutation or deletion was used to hide the deviation.
- Final process cleanup closed API PID `15532`, Web/Vite and Edge PIDs `10188`/`29328`; only pre-existing loopback PostgreSQL PID `7964` remains on `5432`.
- The confirmed E4.1 one-pairing limit is consumed. The only next route is confirmation of the separately bounded test-ID guard and replacement-pairing package; no second pairing is currently authorized.

## E4.2 recovery and bounded-runtime checkpoint

- The product owner confirmed Option A and Sections 4-7 on 2026-09-08, then separately authorized Core, Full, read-only `db:migrate:plan` and disposable `codex_test_*` writes/cleanup. Applying migrations to standard `pfc` remained forbidden.
- Bridge scheduling now delays after both idle and handled cycles, applies bounded retry backoff, refreshes capability evidence at 30-second intervals and emits low-cardinality runtime telemetry. Focused fake-clock coverage protects idle, handled, retry and reset behavior.
- The workbench now distinguishes connecting, synchronized, retrying and offline event states, positions the latest recovered response, preserves a user's historical scroll position, and consumes a versioned server workspace-evidence projection instead of hard-coded tool claims.
- Static Git evidence remains available when an otherwise matched capability snapshot expires; dynamic Codex, Bridge and Zed states correctly become expired or unavailable. The representative standard page passed real Edge checks at 1280, 1440 and 1920 with zero console errors, no horizontal overflow and retained URL/session state.
- One standard pairing `bridge-pairing-992a9b4e-1e00-47fa-8789-832f511039b0` created Bridge `bridge-fc6b774f-af0c-418d-82d0-e81ad8de6896` and reused the existing verified methodology workspace. The 184-second bounded window observed 318 receipts, a maximum rolling-minute count of 104 and 6 capability snapshots, all within the confirmed limits.
- The Bridge remained running after the observer returned and created 1,465 post-window receipts. It was stopped, its task credential was deleted without being read or printed, and effective status is `OFFLINE`. No Requirement, workspace, binding, SkillRelease, Session, Turn, proposal, transmission authorization or AgentRun was added. Historical receipts were retained.
- The product owner subsequently authorized the exact local `pfc` revocation through the normal API with reason `E42_OBSERVATION_SCOPE_OVERRUN` and `expectedActiveRunCount=0`. Read-only preflight confirmed `ONLINE` and zero active runs. The authenticated API call completed once with fixed idempotency key `PFC_AIUX_E42_SCOPE_DRIFT_REVOCATION_20260908_R1`; independent readback confirmed `REVOKED`, zero active runs and exactly one matching idempotency, audit and outbox fact.
- Revocation preserved all historical evidence: 1,843 authenticated receipts, 36 capability snapshots, one pairing and one workspace binding. No direct SQL mutation, row deletion, migration or replay was used.
- `db:migrate:plan` listed the seven known migrations without applying them. Core passed with 83 unit/contract files and 374 tests, 26 integration files and 123 tests, builds, local PostgreSQL connectivity and zero remaining test schemas.
- The first Full run failed at Edge page setup for the first `pc-1920x1080` test while another repository's test process was active. The same test then passed alone in 2.7 seconds and the exact three-project PC command passed 39/39 without timeout changes. Final Full passed permission, concurrency, recovery, security, performance, all 39 Edge tests and dependency audit, ending with `GATE_PASS full`.
- Code review, testing and security owners are 陈立 and all three technical conclusions are `PASS`. AI-UX-R1 is accepted for local product use; release and deployment remain unauthorized. The only next route is `POD-PFC-001/M2/R3/design-confirmation`.
