# AI-UX-R1 E4.1 replacement pairing correction report

> Classification: System Iteration / strict / standard local integration correction  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`  
> Authorization: confirmed Sections 4.1-4.4 of the E4.1 replacement pairing package  
> Implementation: `IMPLEMENTED`  
> Integration evidence: `PRESENT_BUT_FINAL_GATE_BLOCKED`  
> Product acceptance: `BLOCKED`  
> Release: `NOT_AUTHORIZED`

## 1. Outcome

The standard-schema test-ID recurrence guard is implemented. One normal replacement pairing and Bridge used the existing Requirement, canonical workspace/binding, fixed SkillRelease and local registry. The normal product flow created exactly one ProductWorkSession and one advice-only ProductWorkTurn in PostgreSQL. The response completed and recovered by the same IDs after the authorized API restart.

The iteration is not accepted. Manual browser acceptance exposed three existing AI workspace defects, Bridge traffic exceeded the authorized bounded expectation, and Full remains failed on a repeatable third-project Edge navigation timeout. No release or deployment action was taken.

## 2. Scoped source and configuration change

- `apps/server/src/local-test-id-factory.ts`: a non-empty `PFC_LOCAL_TEST_RUN_ID` now fails closed unless the resolved schema matches `codex_test_*`.
- `apps/server/src/composition/create-application.ts`: passes the resolved schema to the local test-ID factory before standard services receive it.
- `scripts/check-delivery-governance.ts`: rejects a non-empty local test-run value before standard-product work.
- `tests/unit/m2-local-test-id-factory.test.ts` and `tests/unit/delivery-governance.test.ts`: cover missing, blank, isolated and forbidden standard-schema cases.
- Ignored `.env.local`: only `PFC_LOCAL_TEST_RUN_ID=` was blanked. No credential or database URL was printed or changed.

TDD red evidence: 2 files failed with 4 expected failures and 8 passes before implementation. Focused green evidence: 2 files and 12 tests passed.

## 3. Standard PostgreSQL readback

Final evidence used an explicit read-only transaction as role `pfc_app_local` against `pfc_local/pfc` and rolled back.

| Fact                    | Readback                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Existing failed pairing | `CODEx_TEST_M2_R1_REAL_20260906_bridge-pairing-892f977b-c775-4b65-8b42-fd6b7cfa7490`, consumed, retained |
| Existing failed Bridge  | `CODEx_TEST_M2_R1_REAL_20260906_bridge-19b62fd9-ce8c-4e76-8eef-2cbcac5e0845`, `REVOKED`, retained        |
| Replacement pairing     | `bridge-pairing-a8a7edf9-d0ba-4578-885e-3bf9fde613a2`, consumed, non-test ID                             |
| Replacement Bridge      | `bridge-be5714d7-f251-49d1-83fc-33b62d00857a`, `pfc-bridge/1`, non-test ID                               |
| Workspace binding       | `workspace-86b7d8df-74b1-4aa0-8332-39a4d12d3235`, `docs`, `VERIFIED`                                     |
| Git baseline            | `a64a8320882d33f4edc7628a9ec690c9418e42ee`                                                               |
| Repository fingerprint  | `sha256:840447fd611a0c63460e4a1e2de98bec9bdd81e6e1fcda76ca660e67d3f23ad8`                                |
| SkillRelease            | `skill-pfc-ai-product-work-session-20260908-r1`, `ACTIVE/PASSED/MEDIUM`                                  |
| Skill content hash      | `sha256:7ab40c7367bbe49a12c1c9fb69c1e51196981711e5fa378f40da6a4b50da8ef0`                                |
| ProductWorkSession      | `work-session-c1d14496-f572-43c9-9d03-27744c0f75ef`, `ACTIVE`, last sequence `5`                         |
| ProductWorkTurn         | `work-turn-e1de895b-bcbc-4802-974e-1dcd78b70667`, `COMPLETED`, visible response length `420`             |
| External thread hash    | `sha256:32122607b6f8c5d0c3443e3d8b851611ac4d47d33868d6be48701409de3c925a`                                |
| External turn hash      | `sha256:68e971b762304757fad7ce084f673f0bf284797fb1b1f5070e365e9b5128074f`                                |

The two hashes above are one-way report evidence. Raw external protocol IDs and payloads are not retained in this report.

The exact advice-only prompt matched. One initial-material context binding remained active and `INTERNAL`. One `START_PRODUCT_WORK_TURN` command required `product-work-turn/1` and ended `ACKNOWLEDGED` on attempt 1. Event ordering was:

1. `SESSION_CREATED`
2. `TURN_QUEUED`
3. `TURN_STARTED`
4. `TURN_MESSAGE_AVAILABLE`
5. `TURN_COMPLETED`

No ProductActionProposal, scoped transmission authorization, linked AgentRun or `codex_test_*` schema was created. The replacement pairing idempotency count is exactly 1.

## 4. Runtime traffic stop finding

The replacement Bridge recorded 169 capability snapshots and 35,763 authenticated message receipts from `2026-09-08T06:10:24.586Z` through `2026-09-08T08:03:04.764Z`. That is about 5.29 receipts per second over the observed interval and is not accepted as bounded idle polling. The ignored local file states `PFC_BRIDGE_POLL_INTERVAL_MS=1000`; the stopped process's effective inherited value was not captured, so the cause is not yet proven.

No AgentRun was assigned to this Bridge. The existing runtime starts two command-poll requests per loop and delays only when both workers report `IDLE`; current evidence does not yet prove which return path suppressed the delay. The process was stopped immediately after this finding. The receipt count remained stable at 35,763 after shutdown. Historical rows were preserved.

This is a high-priority performance, storage-growth and audit-volume defect. Its fix is outside this authorization package and requires a separately confirmed design plus rate/backoff regression evidence.

## 5. Browser acceptance

Real Microsoft Edge acceptance at 1440 x 900 recovered the same Session and Turn URL, rendered the 420-character response after scrolling, preserved the URL state, had no console/page/request/5xx errors and had no horizontal overflow.

Manual acceptance is `BLOCKED` by:

1. The recovered page persistently displays `事件连接已中断`. The server event route returns a finite SSE body and closes; the client treats the resulting `EventSource.onerror` as disconnected.
2. The completed response is below the initial conversation viewport and is not brought into view automatically.
3. The evidence bar displays `Git 基线未提供` because `WorkspaceEvidence.tsx` hard-codes the Git state instead of consuming the verified workspace/Bridge evidence.

Screenshots:

- `C:\Users\hz19114673\AppData\Local\Temp\pfc-e41-replacement-session-1440x900.png`
- `C:\Users\hz19114673\AppData\Local\Temp\pfc-e41-replacement-response-1440x900.png`

The screenshots are local temporary evidence and are not committed product artifacts.

## 6. Quality gates

| Command                                                | Result                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Focused Vitest, 2 files / 12 tests                     | `PASS`                                                                                                                |
| `npm run test:gate:quick`                              | `PASS`, 80 files / 362 tests, `GATE_PASS quick`                                                                       |
| `npm run test:gate:core`                               | `PASS`, unit 80/362, integration 26/122, build and local DB checks passed, test schemas remaining 0, `GATE_PASS core` |
| Isolated `ai-work-session-readiness` at `pc-1920x1080` | `PASS`, 1/1 in 2.3 seconds                                                                                            |
| AI workspace test only across all three PC projects    | `PASS`, 3/3 in 18.4 seconds                                                                                           |
| `npm run test:gate:full` attempt 1                     | `FAIL`, E2E 38/39; third-project Edge page setup timed out                                                            |
| Sandboxed Full retry                                   | `INVALID`, Windows `spawn EPERM` before Vitest loaded; not test evidence                                              |
| Reviewed unsandboxed Full retry                        | `FAIL`, E2E 38/39; the same third-project `page.goto` timed out at 30 seconds                                         |

The repeatable Full sequence is specific: the first two projects pass, the first AI workspace test of `pc-1920x1080` times out, and the remaining 12 tests at that width pass. The same AI workspace test passes in all three projects when run without the rest of the suite. This points to Full-suite browser/process lifetime rather than a 1920 layout failure, but Full remains `BLOCKED`; isolated passes do not override it.

## 7. Review, acceptance and cleanup

The scoped configuration-guard review found no correctness, regression or credential-handling defect. The four runtime/UI findings above remain open and are higher priority than style findings.

Named conclusions are still missing:

- Code review: `陈立` - `BLOCKED`
- Testing: `陈立` - `BLOCKED`
- Security: `陈立` - `BLOCKED`

Cleanup completed:

- Bridge PID `36848` and API PID `8552` stopped.
- Task credential `.local/bridge/e41-replacement-credential.json` deleted without reading or printing it.
- No listener remains on `127.0.0.1:3001` or `127.0.0.1:5173`.
- No project-owned Node, Playwright or test Edge process remains.
- Pre-existing PostgreSQL PID `7964` remains on loopback port `5432` for local development.

## 8. Current route and release boundary

Per the confirmed package failure route, the machine-readable POD route remains `POD-PFC-001/M2/AI-UX-R1/e4.1-replacement-pairing-authorization` with this stop evidence. Do not create another pairing. The next behavioral change needs a human-confirmed remediation design covering bounded Bridge polling, recoverable SSE state, response positioning, verified workspace evidence and stable three-width browser execution.

No commit, push, migration, remote mutation, Zed/MCP action, release or deployment was performed.
