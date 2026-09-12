# AI-UX-R1 standard prerequisite remediation verification report

> Classification: System Iteration / strict  
> Environment: project Node 24.20.0 / loopback PostgreSQL `pfc_local` / disposable `codex_test_*` schemas  
> Result: `LOCAL_VERIFIED / STANDARD_EXECUTION_NOT_AUTHORIZED / ACCEPTANCE_BLOCKED`  
> Date: 2026-09-08

## Scope and outcome

- Parent POD / milestone: `POD-PFC-001 / M2`.
- CAP / Unit: `CAP-PFC-01 / UNIT-PFC-01-02`, `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`.
- Implementation: Option B `LOCAL_VERIFIED`.
- Integration: exact initial material creation, material-library/readiness visibility and SkillRelease scope registration are verified in isolated PostgreSQL. Standard Skill/Requirement/Bridge/session/turn execution was not authorized and did not run.
- Acceptance: `BLOCKED`; code review, testing and security owners are registered as 陈立, while standard first-turn evidence was still absent at this checkpoint.
- Release / observation: `NOT_AUTHORIZED / NOT_STARTED`.
- POD next route: `POD-PFC-001/M2/AI-UX-R1/reissued-standard-local-execution-authorization-confirmation`.

## Test data design

All automated data is deterministic synthetic data using `CODEx_TEST_` identifiers. Scenarios cover complete and incomplete G0, later completion, INTERNAL and RESTRICTED sensitivity, exact UTF-8 SHA-256, idempotent replay, stale version, transaction rollback, approved/unknown Skill scopes and Skill manifest drift. Tests write only disposable `codex_test_*` schemas; cleanup readback reported zero remaining schemas. No customer, employee or credential data was used.

## Verification evidence

| Verification                 | Result                          | Evidence                                                                                                                                      |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Target unit/contract         | PASS                            | 5 files / 14 tests; domain binding, application aggregation, architecture, scope contract, fixed manifest/drift                               |
| Target PostgreSQL            | PASS                            | 3 files / 29 tests; exact hash/readback, material library, readiness candidates, replay and rollback                                          |
| Quick Gate                   | PASS                            | 79 files / 349 tests plus config, protocol, delivery/UI governance, lint, format and types                                                    |
| Core Gate                    | PASS                            | 26 integration files / 121 tests, migration plan, schema cleanup 0, three workspace builds, PostgreSQL check                                  |
| Full Gate                    | PASS                            | 44 permission, 20 concurrency, 32 recovery, 25 security, 3 performance and 39 PC E2E tests; security findings 0; dependency vulnerabilities 0 |
| Standard zero-write readback | PASS                            | three actors active; workspace active/unverified; legacy candidate ref count 0; ProductWorkTurn Skill 0; non-test Bridge 0; flag absent       |
| Process cleanup              | PASS with retained prerequisite | no listeners on 3001/4173/5173; existing PostgreSQL PID 7964 remains on 127.0.0.1:5432                                                        |

Commands executed with the project Node 24 path:

- targeted Vitest for unit/contract and integration suites: PASS;
- `npm run test:gate:quick`: PASS;
- `npm run test:gate:core`: PASS on rerun;
- `npm run test:gate:full`: PASS;
- `npm run db:test-cleanup-check`: included in Core/Full, `remaining=0`;
- read-only Kysely standard prerequisite query and flag-presence check: PASS after correcting the workspace join.

## Failures and corrections

1. The first target test start was blocked by sandbox `spawn EPERM`; the same fixed local command ran outside the sandbox under the approved package.
2. Red tests failed for the intended missing domain helper, Skill scope and fixed manifest. One new application test initially omitted the repository binding and was corrected before product implementation assessment.
3. The first Quick invocation launched npm under Node 24 but its children resolved system Node 18; `NODE_VERSION_MISMATCH` failed closed. Activating the project runtime in `PATH` produced the final PASS.
4. The first Core run found one stale experience-material expectation: a baseline now correctly returns the new initial ref plus its existing evidence ref. The assertion was updated to require both and preserve location redaction; rerun passed.
5. The final standard read-only probe initially selected `allowed_relative_path` from `workspaces` although it belongs to `requirement_workspaces`, repeating the earlier preflight mistake. The query failed before returning data; the corrected join succeeded. Neither query could write. Follow-up: future standard preflight must use the repository/schema contract or the documented join, not an ad hoc column assumption.
6. Full E2E logged one transient Vite proxy `ECONNREFUSED` while a mocked SSE connection was closing; the affected case and all 39 browser cases passed. No listener remained, but this log remains a residual diagnostic signal rather than being hidden.

## Review and residual risk

The review pass found no unresolved correctness, security or architecture defect in the authorized source correction. An architecture test now locks domain construction, server hashing/ID orchestration and SQL persistence into separate modules. Unknown Skill scopes remain rejected and legacy AgentRun operations remain unchanged.

Residual risk:

- no standard `pfc` write, fixed Skill registration, Bridge pairing or ProductWorkTurn has run;
- existing zero-ref baselines are intentionally not backfilled;
- general material upload/version workflows remain deferred to `UNIT-PFC-02-03` and later scope;
- performance evidence is local smoke only;
- named code review/testing/security and product acceptance are missing;
- release, observation, Zed handoff, MCP execution and CAP-PFC-05 remain unstarted.

No `.env.local`, migration, dependency, standard business row, remote Git target, release or deployment state changed. The `fullstack-quality-gate` workflow determined the proportional test matrix and durable report fields; it did not expand authorization.
