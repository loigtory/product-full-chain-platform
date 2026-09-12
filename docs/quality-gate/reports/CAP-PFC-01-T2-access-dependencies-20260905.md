# CAP-PFC-01 T2 Quality Gate Report

## Summary

- System: `product-full-chain-platform / CAP-PFC-01 T2`
- Branch/Commit: `feat/cap-pfc-01-m1` / `UNBORN (no commit)`
- Gate Level: `core`
- Result: `PASS (technical candidate); Full and formal acceptance BLOCKED`
- Time: `2026-09-05T01:31:37+08:00`
- Environment: project-local Node `24.20.0`, npm `11.19.0`, loopback PostgreSQL `18`

## Change Impact

- Changed areas: contracts, domain authorization, server dependency assembly, local/test fixture configuration, synthetic test data, tests, build configuration, docs.
- Critical flows touched: requirement object authorization, restricted-material transmission authorization, dependency-unavailable degradation, local fixture isolation.
- Risk level: high, because later APIs will rely on these permission and cross-CAP boundaries.
- Scope exclusion: no business API/UI, migration, real PFC-02～05 adapter, material body, external listener, remote write, commit, push, deployment or release.

## Tests Added Or Updated

| File                                         | Purpose                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/contract/access-dependencies.test.ts` | Freezes Actor/action/fact/target and capability status contracts; excludes external publication action.                               |
| `tests/unit/access-policy.test.ts`           | Covers scope, unknown facts, restricted membership, approved targets, exact current action authorization and bounded audit summaries. |
| `tests/unit/authorization-service.test.ts`   | Covers per-request lookup, immediate revocation, unavailable/unknown denial and redacted thrown-port failure.                         |
| `tests/unit/dependency-adapters.test.ts`     | Covers default unavailable behavior, exact fixture lookup and non-local fixture rejection.                                            |
| `tests/unit/server-health.test.ts`           | Verifies server assembly installs fail-closed ports when no adapter is injected.                                                      |

## Commands Run

| Command                                                                             | Result                          | Notes                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts\project-npm.cmd install --ignore-scripts --offline`                        | PASS                            | Existing lockfile satisfied offline; no new external dependency.                                         |
| `scripts\project-npm.cmd run test:gate:core -- --dry-run`                           | PASS                            | Core plan reported `READY_TO_RUN`.                                                                       |
| T2 target tests before implementation                                               | FAIL (expected)                 | Four suites failed because access/dependency contracts and modules did not exist.                        |
| `vitest ... authorization-service.test.ts access-policy.test.ts` after review tests | FAIL (expected)                 | 2/14 failures reproduced cross-action authorization reuse and raw port exception propagation.            |
| Same targeted security tests after fixes                                            | PASS                            | 14/14 passed.                                                                                            |
| `scripts\project-npm.cmd run test:unit`                                             | PASS                            | 10 files, 55 tests passed.                                                                               |
| `scripts\project-npm.cmd run test:gate:quick`                                       | PASS                            | Config, lint, format, types and 55 tests passed.                                                         |
| First `scripts\project-npm.cmd run test:gate:core`                                  | FAIL                            | Database integration and cleanup passed; server build exposed `TS5097` for emitted `.ts` import paths.   |
| `scripts\project-npm.cmd run build --workspace @pfc/server`                         | PASS                            | Passed after enabling TypeScript relative-import extension rewriting for emit.                           |
| Final `scripts\project-npm.cmd run test:gate:core`                                  | PASS                            | 55 unit/contract and 9 integration tests passed; cleanup `remaining=0`; both builds and DB check passed. |
| `scripts\project-npm.cmd run test:gate:full -- --dry-run`                           | BLOCKED (expected)              | Lists the planned Full commands and known missing coverage.                                              |
| `scripts\project-npm.cmd run test:gate:full`                                        | BLOCKED (expected)              | Fails before execution with `FULL_GATE_BLOCKED`.                                                         |
| Candidate-file secret scan                                                          | PASS                            | Only `.env.example` matched safe empty key declarations; no value-bearing candidate file found.          |
| Listener/process audit                                                              | PASS with retained prerequisite | No listener on 3001/5173; local PostgreSQL remains on `127.0.0.1:5432`, PID 24620, manual service.       |

## Test Data

- Prefix: `CODEx_TEST_`
- Run IDs: `T2_POLICY`, `T2_AUTH_SERVICE`, `T2_ADAPTERS`, `T2_SERVER`; Core reused isolated integration run ID `T1_LOCAL`.
- Data source: deterministic synthetic factories only; no real user, customer, material or authorization data.
- Created IDs: T2 IDs are process-memory only; Core used schema `codex_test_t1_local`.
- Cleanup: T2 memory released with test processes; Core cleanup readback reported zero remaining test schemas.
- Sensitive-data handling: tests assert denial output does not include material IDs or the injected exception text; no secrets printed or persisted.

## Failures And Corrections

| Test/Command               | Failure                                            | Root Cause                                                                                                      | Correction/Evidence                                                                       |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Security review regression | Wrong-action grant allowed restricted transmission | Grant binding omitted the requested action                                                                      | Added `RequirementAction` to grant scope and exact comparison; targeted 14/14 PASS.       |
| Security review regression | Port exception escaped with original text          | Authorization service did not normalize thrown dependency failures                                              | Catch and return `AUTHORIZATION_CAPABILITY_ERROR`; leak assertion PASS.                   |
| First Core build           | `TS5097` during server emit                        | T2 made server build emit transitive domain/contracts sources that use the repository's `.ts` import convention | Enabled TypeScript 6 `rewriteRelativeImportExtensions`; server build and final Core PASS. |

## Untested Or Blocked Items

- API/UI permission enforcement: T3 has not exposed business routes or screens, so end-to-end unauthorized-body and cache tests do not yet exist.
- Real PFC-02～05 integrations: no capability endpoint or authorization to connect; all default ports remain explicitly unavailable.
- Independent review: code review, test and security owners are not registered; executor self-review cannot serve as formal acceptance.
- Full gate: PC E2E, permission E2E, concurrency, recovery, security, performance and dependency-audit evidence remain incomplete. The gate is intentionally fail-closed.
- Business acceptance/release/observation: not in T2 scope and not authorized.

## Deployment Notes

- DB migrations required: no T2 migration. Core only planned the existing T1 migration and exercised an isolated test schema; default `pfc` was not migrated.
- Configuration changes required: deployment values remain absent. `APP_ENV` and `FIXTURE_ADAPTERS_ENABLED` are mandatory; fixture mode is rejected outside local/test.
- Post-deploy smoke: not applicable because deployment is neither designed nor authorized for this task.
- Rollback: remove only the uncommitted T2 files/edits after preserving this evidence; do not revert T0/T1 or mutate local/remote Git without separate authorization.
- Retained process: `pfc-postgresql-18`, PID 24620, `127.0.0.1:5432`, existing manual local test prerequisite. Stop command when no longer needed: `Stop-Service pfc-postgresql-18` (not run in this task).

## Lightweight Retrospective

- Rework count: 1 implementation review cycle plus 1 build-configuration correction.
- Failed gates: first Core only; defect source was the difference between root no-emit type checking and server emit configuration.
- Anti-regression: exact action binding, exception redaction and server production build are now covered by tests/gates.
- Post-release issues: not applicable; no release occurred.
