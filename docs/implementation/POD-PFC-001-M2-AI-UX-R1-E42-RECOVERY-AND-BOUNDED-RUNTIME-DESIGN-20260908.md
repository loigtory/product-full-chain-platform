# AI-UX-R1 E4.2 recovery and bounded-runtime design package

> Classification: System Iteration / strict  
> Status: `CONFIRMED / IMPLEMENTED / STANDARD_WINDOW_VERIFIED / SCOPE_DRIFT_REVOKED / AUTOMATED_GATES_PASS / AI_UX_R1_ACCEPTED / PILOT_OBSERVATION_PENDING`  
> Date: 2026-09-08  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> Proposed CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`  
> Authority evidence: E4.1 replacement pairing correction report

## 1. Goal and grounded defects

E4.1 proved the standard PostgreSQL -> Bridge -> Codex -> ProductWorkTurn chain, but acceptance stopped on four product/runtime defects and one gate defect:

1. an idle Bridge accumulated 35,763 authenticated message receipts in about 113 minutes;
2. the workbench presents a finite/retrying SSE transport as a persistent disconnection;
3. a recovered completed response is outside the initial conversation viewport;
4. the evidence bar hard-codes Git as unavailable although the exact verified baseline exists;
5. Full repeatedly times out on the third project's first Edge navigation, while the same test passes `3/3` when run alone across all widths.

The goal is a bounded, observable local Bridge runtime and a truthful recoverable AI workbench whose verified evidence and completed answer are immediately usable. Full must pass as one command before this iteration can become locally verified.

## 2. Non-goals and retained facts

This design does not add new Requirement behavior, action proposals, automatic file/Git/Shell changes, Zed/MCP integration, remote access, dependency upgrades, migration, release or deployment. It does not delete or rewrite the historical failed/successful pairing, Bridge, Session, Turn, audit, outbox or receipt rows.

The existing Requirement, canonical workspace/binding, SkillRelease, session and completed turn remain the UI recovery sample. Existing design-system tokens and `@pfc/ui` components remain authoritative.

## 3. Approaches

### Option A - one package with two ordered sub-stages (recommended)

First correct and prove runtime/gate boundedness, then correct the workbench transport/evidence/scroll behavior. Each sub-stage has its own focused gate and stop condition; final standard readback and Full cover the integrated result.

This is the fastest route to one coherent acceptance result while keeping runtime and UI changes separately reviewable.

### Option B - two separately confirmed iterations

Complete Bridge/gate remediation first and defer workbench defects to a later package. This reduces each diff but leaves the representative user workflow visibly broken after the first release candidate and duplicates restart/readback work.

Selected proposal: **Option A**, confirmed by the product owner on 2026-09-08.

## 4. Proposed design

### 4.1 Bounded Bridge scheduler

- Extract a testable cycle/scheduling boundary from `apps/bridge/src/runtime.ts`; the main loop must never spin without a minimum abort-aware delay after an idle or already-handled cycle.
- Add bounded exponential backoff with a cap for retryable `429/5xx/fetch failed` outcomes and reset it only after a healthy cycle.
- Record low-cardinality safe runtime counters for cycle result, delay selected and request rate. Never log credentials, message IDs, nonces or raw protocol.
- Validate and surface the effective poll interval at startup so process-environment precedence cannot remain invisible.
- Add deterministic fake-gateway/fake-clock tests for idle, handled, retry, abort and capability-report cadence.
- Standard acceptance limit: after warm-up, an idle one-Bridge process at a 1000 ms interval may create at most 125 authenticated receipts per minute and one capability snapshot per 30 seconds, with no monotonic busy loop.

### 4.2 Truthful event transport state

- Model the client state as `CONNECTING`, `SYNCED`, `RETRYING` or `OFFLINE`; `EventSource.onerror` alone is not a terminal disconnection.
- Add an explicit open/success timestamp and a bounded retry/offline threshold. A finite catch-up response must display `事件同步正常` or `正在重连`, not a permanent false failure.
- Keep the server contract resumable through `Last-Event-ID`/`after`, preserve permission re-checks and close work on request abort.
- Prefer a bounded long-lived SSE response with heartbeat comments and cancellation if Fastify lifecycle tests prove it reliable. If that cannot be proven locally, retain finite catch-up SSE but make its retry semantics explicit and tested; do not simulate a permanent connection in the UI.

### 4.3 Response positioning and workspace evidence

- On initial recovery, position the latest completed response inside the feed viewport.
- On later events, auto-follow only while the user is already near the bottom or immediately after their own submit; never steal scroll position while they inspect history.
- Extend the versioned work-session read model with sanitized workspace evidence resolved from the latest Turn's Bridge binding and capability snapshot: workspace ID, verification state, repository fingerprint, Git baseline, capability freshness and tool states.
- Render Git/Bridge/Codex from that server-provided evidence. Missing, expired and mismatched evidence must have distinct states; page-local hard-coded availability is removed.
- No database schema change is planned; the read model uses existing PostgreSQL joins/repository ports.

### 4.4 Full-suite browser stability

- Preserve the three required widths: 1280 x 720, 1440 x 900 and 1920 x 1080.
- Change the gate runner to execute each Playwright project in a fresh child process when the current single invocation reproduces Edge profile/navigation lifetime failure.
- Keep one worker per project, fail closed on any project, and aggregate all three exit codes into the existing Full result.
- Add a gate-runner regression test proving no width is skipped and a child failure fails the parent command.

## 5. Impact and architecture boundaries

Expected files are limited to:

- Bridge scheduler/runtime and focused unit tests under `apps/bridge` and `tests/unit`;
- work-session DTO/read model, repository port/implementation and service under `packages/contracts`, `packages/persistence` and `apps/server`;
- work-session EventSource state, hook, conversation/evidence components and their tests under `apps/web/src/work-sessions`;
- Playwright/gate orchestration and tests under `scripts`, `package.json`, `playwright.config.ts` or an existing gate-owned module;
- delivery ledger, implementation record and quality report.

No page outside the AI workbench may gain local visual tokens. If a shared state indicator is needed, it must be added to `packages/ui` and `/ui-kit` before page use.

## 6. Test data and standard verification effect

TDD is required for each behavior change. Integration tests use deterministic `CODEx_TEST_<runId>` data in disposable `codex_test_*` schemas and clean them to zero.

Because the E4.1 task credential was correctly deleted, one real bounded-runtime verification requires exactly one new standard pairing/Bridge. Confirmation authorizes at most:

- one pairing with fixed idempotency key `PFC_AIUX_E42_BOUNDED_RUNTIME_20260908_R1`;
- one non-test Bridge registration and one binding to the existing canonical workspace;
- bounded capability/heartbeat/message receipts during a maximum 3-minute observation;
- no new Requirement, workspace, Requirement binding, SkillRelease, ProductWorkSession, ProductWorkTurn, action proposal, transmission authorization or AgentRun.

The pairing code remains in memory. The ignored credential is exclusive-created, deleted after shutdown and never printed. The verification Bridge is revoked on any unknown result or scope drift; otherwise its historical registration remains and becomes `OFFLINE` after shutdown.

## 7. Gates and exit criteria

Required evidence:

1. failing tests reproduce each runtime/UI/gate defect before implementation;
2. focused unit/contract/integration/browser tests pass;
3. a 3-minute standard Bridge observation stays within the receipt/snapshot bound;
4. the existing completed Session URL recovers with truthful sync state, verified Git baseline and visible response at 1280, 1440 and 1920;
5. keyboard focus, no overflow, no console/page/request/5xx error and permission boundaries pass;
6. Quick, Core and Full all pass, with Full executing all three browser projects as one fail-closed command;
7. read-only PostgreSQL reconciliation, test-schema cleanup and process/credential cleanup pass.

Implementation may be `LOCAL_VERIFIED` only after all seven. Named code-review, testing and security conclusions remain required for product acceptance. Release stays unauthorized.

## 8. Risk, rollback and stop conditions

- Polling regression: enforce rate assertions and stop immediately if the 1-minute rolling count exceeds the bound.
- SSE resource leak: bound connection lifetime, abort database polling/work on disconnect and test repeated mount/unmount.
- Stale evidence: include capture/expiry times and fail to unavailable on mismatch or expiry.
- Scroll disruption: test initial recovery separately from a user reading older content.
- Browser false green: each width is a required child result; missing output or timeout fails Full.
- Credential/data risk: loopback only, redacted logs, one fixed idempotency key, exact pre/post counts and retained audit history.

Rollback is source/config revert plus process shutdown. No row deletion is used as rollback. Stop on target drift, unexpected existing credential, duplicate pairing, non-loopback listener, receipt-rate breach, unauthorized action/proposal/run, failed cleanup or any credential exposure.

## 9. Version, deferred scope and process plan

- Version: `AI-UX-R1 E4.2`.
- Ordered stages: `E4.2a bounded runtime and Full harness`, then `E4.2b workbench recovery/evidence`.
- Parallel agents: none; the representative Bridge/session and gate process lifecycle share state.
- Deferred: Zed, MCP, business actions, multi-turn authoring, long-term Bridge credential rotation/service management, release and deployment.
- Process cleanup: close API/Web/Bridge/Codex/Edge/test runner processes; retain only the pre-existing loopback PostgreSQL service and report its PID/port.
- Completed closeout route: `POD-PFC-001/M2/AI-UX-R1/closeout-and-named-acceptance`.
- Failure route: remain at E4.2 with exact evidence; no additional pairing or retry without a new decision.

## 10. Confirmation and authorization boundary

To authorize Option A, the scoped source/config changes above, isolated test writes/cleanup and the one bounded standard verification pairing/Bridge in Section 6, reply:

`确认 AI-UX-R1 E4.2 方案 A 及第 4-7 节实施授权范围`

This does not authorize release, deployment, remote mutation, migration, dependency installation, Zed/MCP, a new Requirement/workspace/binding/Skill/Session/Turn, or deletion of historical product facts.

## 11. Implementation record

The source implementation, isolated verification and one standard bounded-runtime pairing were completed under the confirmed scope. The 184-second acceptance window stayed within the rate limit: 318 observed authenticated receipts, a maximum rolling-minute count of 104 and 6 observed capability snapshots. The existing Requirement, workspace, binding, SkillRelease, ProductWorkSession and ProductWorkTurn were reused; no prohibited product fact was created.

After the acceptance observer completed, the task controller did not stop the Bridge promptly and 1,465 additional receipts were retained. This exceeded the three-minute execution boundary. The Bridge process was stopped and its ignored credential was deleted without reading or printing it. Historical facts remained intact while exact revocation authorization was pending.

The product owner then explicitly authorized revoking Bridge `bridge-fc6b774f-af0c-418d-82d0-e81ad8de6896` in local `pfc` through the normal API with reason `E42_OBSERVATION_SCOPE_OVERRUN` and `expectedActiveRunCount=0`. A read-only preflight confirmed `ONLINE`, zero active runs and no prior revocation idempotency, audit or outbox fact. The normal authenticated API completed once with idempotency key `PFC_AIUX_E42_SCOPE_DRIFT_REVOCATION_20260908_R1`. Independent PostgreSQL readback confirmed `REVOKED`, zero active runs and exactly one matching idempotency, audit and outbox fact. All 1,843 receipts, 36 capability snapshots, one pairing and one workspace binding remain retained; no direct SQL mutation, history deletion, migration or replay was used.

Core passed on the final source state. The first Full run reached PC E2E and failed while Edge created the first page of the third project; trace evidence showed a browser-process setup stall before page navigation. The failing test then passed alone and the exact three-project PC entry passed 39/39 without increasing timeouts. The final Full rerun passed every stage and ended with `GATE_PASS full`.

- Current parent-POD route: `POD-PFC-001/M2/R3/design-confirmation`.
