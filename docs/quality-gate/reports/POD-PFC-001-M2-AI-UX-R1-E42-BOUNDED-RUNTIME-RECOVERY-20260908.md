# AI-UX-R1 E4.2 bounded-runtime and recovery report

## Basic information

- Classification: System Iteration Requirement / strict loop.
- Parent POD / milestone: `POD-PFC-001 / M2`.
- CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`.
- Confirmed design: Option A and Sections 4-7 on 2026-09-08.
- Gate authorization: local Core and Full, read-only `db:migrate:plan`, and disposable `codex_test_*` writes with cleanup. Applying migrations to standard `pfc` was explicitly forbidden.
- Conclusion: `IMPLEMENTED / STANDARD_WINDOW_VERIFIED / SCOPE_DRIFT_REVOKED / AUTOMATED_GATES_PASS / AI_UX_R1_ACCEPTED / PILOT_OBSERVATION_PENDING`.

## Implemented behavior

- The Bridge runtime owns one abort-aware scheduler. Idle and handled cycles both wait for the configured interval; retryable `429/5xx/fetch failed` outcomes use bounded exponential backoff; capability reporting is limited to a 30-second cadence; telemetry contains counts and effective delay only.
- Work-session transport states are `CONNECTING`, `SYNCED`, `RETRYING` and `OFFLINE`. A finite SSE response no longer appears as an immediate permanent disconnection.
- Initial recovery positions the latest response in the feed. Later updates follow only after a user submit or while the reader remains near the bottom.
- The versioned work-session snapshot now includes sanitized workspace, binding, Git baseline, capability freshness and tool evidence resolved by the server repository. The page no longer hard-codes Git availability.
- Matching static Git evidence remains available when the runtime capability expires; dynamic Codex, Bridge and Zed evidence does not remain falsely available.
- Playwright executes the three required PC projects in separate fail-closed child processes.

## TDD and automated evidence

The expected red run for expired evidence failed because Git was rendered as expired. The final focused UI run passed 12/12. Bridge loop, transport-state, conversation-positioning, read-model and project-runner regression suites also passed in the final Core unit set.

| Command or check                    | Result                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate:plan`           | `PASS`; listed seven known migrations, applied none                                                                                                                                                                  |
| `npm run test:gate:core`            | `PASS`; unit/contract 83 files / 374 tests, integration 26 files / 123 tests, builds and PostgreSQL check passed, remaining test schemas 0                                                                           |
| First `npm run test:gate:full`      | `FAIL`; Core and non-browser Full stages passed, then Edge stalled while setting up the first page of `pc-1920x1080`                                                                                                 |
| Isolated failing test at 1920       | `PASS`; 1/1 in 2.7 seconds                                                                                                                                                                                           |
| `npm run test:e2e:pc`               | `PASS`; 39/39 across 1280, 1440 and 1920 widths                                                                                                                                                                      |
| Final `npm run test:gate:full`      | `PASS`; unit/contract 83/374, integration 26/123, permission 7/44, concurrency 4/20, recovery 6/32, security checks 11/0, security 5/25, performance 1/3, Edge 39/39, dependency vulnerabilities 0; `GATE_PASS full` |
| Revocation preflight/readback       | `PASS`; local `pfc_local/pfc`, exact Bridge, zero active runs, one normal API effect, independent database reconciliation and preserved history                                                                      |
| E4.2 final readback                 | `PASS`; `effectiveStatus=REVOKED`, `revocation=EXECUTED`, `credential=ABSENT`, `prohibitedDelta=0`                                                                                                                   |
| `npm run check:delivery-governance` | `PASS`; 5 CAPs, 26 Units, M2 and the sole current route `POD-PFC-001/M2/AI-UX-R1/closeout-and-named-acceptance`                                                                                                      |
| `npm run check:format`              | `PASS`; all tracked and untracked source documents matched Prettier                                                                                                                                                  |
| `npm run db:test-cleanup-check`     | `PASS`; remaining disposable test schemas 0                                                                                                                                                                          |

The failed trace shows browser launch and context creation completing before `Create page` stalled for 30 seconds; context teardown then also timed out. No page navigation or product assertion had begun. At the same time, another repository had a long-running test worker consuming about 1-2 GB. The exact full PC entry passed on rerun without increasing the 30-second timeout or skipping a width, so no speculative timeout relaxation was introduced.

## Standard local observation

Read-only preflight used `pfc_app_local` against `pfc_local/pfc`. One pairing with fixed idempotency key `PFC_AIUX_E42_BOUNDED_RUNTIME_20260908_R1` created:

- pairing `bridge-pairing-992a9b4e-1e00-47fa-8789-832f511039b0`;
- Bridge `bridge-fc6b774f-af0c-418d-82d0-e81ad8de6896`;
- team `team-aee2a8e2-e86a-4ecd-9b48-ea42df2d2fc1`.

The accepted observation ran from `2026-09-08T11:09:08.501Z` through `2026-09-08T11:12:12.820Z` (184,319 ms). It observed 318 authenticated receipts, a maximum rolling-minute count of 104 and 6 capability snapshots. These values satisfy the limits of 125 receipts per rolling minute and one capability snapshot per 30 seconds after warm-up.

Final readback found exactly one idempotency record for the pairing, the expected verified workspace binding and Git baseline `a64a8320882d33f4edc7628a9ec690c9418e42ee`. It found zero new Requirement, workspace, Requirement binding, SkillRelease, ProductWorkSession, ProductWorkTurn, proposal, authorization or AgentRun facts. No `codex_test_*` schema remained.

## Scope drift revocation and containment

The observer completed successfully, but the task controller did not stop the Bridge process at the end of the three-minute window. Before it was detected and stopped, the same Bridge created 1,465 additional authenticated receipts. These rows are retained as audit evidence and are not counted as accepted observation traffic.

Containment completed:

- the Bridge, API and Web processes were stopped;
- the exact ignored task credential was deleted without being read or printed;
- API readback reported the Bridge effectively `OFFLINE`;
- the one existing ProductWorkSession and completed ProductWorkTurn were unchanged;
- prohibited product-fact delta was zero.

The initial revocation refusal was correct because no exact authorization existed at that point. On 2026-09-08, the product owner explicitly authorized revoking the exact Bridge in local `pfc` through the normal API with reason `E42_OBSERVATION_SCOPE_OVERRUN` and `expectedActiveRunCount=0`.

The final read-only preflight confirmed database `pfc_local`, schema `pfc`, Bridge status `ONLINE`, zero active runs, and zero matching revocation idempotency, audit or outbox facts. The authenticated API call completed once with idempotency key `PFC_AIUX_E42_SCOPE_DRIFT_REVOCATION_20260908_R1`. Independent read-only PostgreSQL reconciliation then confirmed:

- Bridge status `REVOKED` at `2026-09-08T12:41:09.116Z`;
- zero active runs and zero linked ProductWorkRuns or ProductWorkTurns;
- exactly one matching idempotency, audit and outbox fact;
- all 1,843 authenticated receipts, 36 capability snapshots, one pairing and one workspace binding retained.

The official final readback returned `revocation=EXECUTED`, `credential=ABSENT` and `prohibitedDelta=0`. No direct SQL mutation, history deletion, standard migration or revocation replay occurred. One earlier read-only helper preflight referenced a nonexistent column and failed before producing evidence; the helper was corrected to the repository's actual pairing relationship and the failed diagnostic performed no write.

Redacted machine-readable preflight and result evidence is retained under ignored files `.local/e42-revocation-preflight.json` and `.local/e42-revocation-result.json`. The credential file remains absent. These local artifacts contain identifiers and aggregate counts but no password, cookie, task bearer credential or connection URL; they are retained for this closeout and are not release artifacts.

## Standard browser evidence

The existing standard Requirement and completed session were recovered in real Edge at 1280x720, 1440x900 and 1920x1080. All widths retained the same URL/session state, displayed the long completed response within the feed, showed the verified static Git baseline, marked expired dynamic Codex/Bridge/Zed evidence truthfully, disabled the composer while Bridge capability was offline, and had zero console errors or horizontal overflow.

Ignored screenshots and geometry evidence are stored under `.local/e42-browser/`. They contain product IDs and synthetic internal text but no credential or cookie. They are local verification artifacts, not release evidence.

## Review, security and process notes

The engineering review found no remaining correctness or credential-handling defect in the scoped runtime, read model, transport state, positioning or browser runner changes. Long-duration load remains unmeasured beyond the bounded local sample; no production capacity claim is made.

One diagnostic command accidentally used npm's `exec` path and downloaded a temporary Node 26 package into the current user's npm execution cache. The repository manifest, lockfile and pinned Node 24 runtime were unchanged. That invalid command was not counted as evidence, and user-cache cleanup was not attempted without authorization.

Responsibility and technical conclusions:

- Code review: `陈立` - `PASS`; current source review found no unresolved correctness, architecture or credential-handling issue in the AI-UX-R1 scope.
- Testing: `陈立` - `PASS`; final Full evidence and the post-registration Quick rerun passed, including 83 unit/contract files and 374 tests.
- Security: `陈立` - `PASS`; the current static security scan completed 11 checks with 0 findings, and the final Full run retained 25/25 security tests and 0 dependency vulnerabilities.

No commit, push, standard-schema migration, remote mutation, release or deployment was performed. The only relevant retained service is the pre-existing loopback PostgreSQL service on port 5432. AI-UX-R1 is accepted for local product use; pilot observation and release remain pending. The POD route is `POD-PFC-001/M2/R3/design-confirmation`.
