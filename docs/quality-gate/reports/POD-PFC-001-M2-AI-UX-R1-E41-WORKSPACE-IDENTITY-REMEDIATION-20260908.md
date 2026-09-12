# AI-UX-R1 E4.1 workspace identity remediation report

## Basic information

- Classification: System Iteration Requirement / strict loop.
- Parent POD / milestone: `POD-PFC-001 / M2`.
- CAP / Unit scope: `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`.
- Confirmed design: Option A and Section 4 on 2026-09-08.
- Environment: loopback PostgreSQL `pfc_local/pfc`, local API/Web and local Edge only.
- Data policy: the retained Requirement contains approved synthetic `INTERNAL` content; no customer, employee or restricted data was used.
- Conclusion: `PARTIAL_LOCAL_VERIFIED / REPLACEMENT_PAIRING_AUTHORIZATION_REQUIRED / ACCEPTANCE_BLOCKED`.

## Source implementation

- The domain now accepts only canonical repository fingerprints matching `sha256:` plus 64 lowercase hexadecimal characters.
- The workspace application service applies the same domain assertion when called without HTTP, and the HTTP schema rejects non-canonical input before service execution.
- Team Admin owns a separate `WorkspaceRegistrationForm`; it presents the exact format requirement and does not issue an API request when browser validation fails.
- The Team Admin composition boundary is protected by an architecture test; the UI uses only existing `@pfc/ui` controls and token-backed styles.
- The old deterministic M1 fixture fingerprint was updated to a valid synthetic SHA-256 value. It remains test-only and does not satisfy product acceptance.

## TDD and quality evidence

| Evidence           | Result                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expected red run   | API accepted uppercase hex, UI lacked the canonical pattern, domain export and extracted form boundary were absent                                                                          |
| Targeted green run | 4 files / 21 tests passed                                                                                                                                                                   |
| Quick gate         | PASS; 80 files / 359 tests                                                                                                                                                                  |
| Core gate          | PASS; 80 files / 359 tests, 26 integration files / 122 tests, cleanup 0, builds and PostgreSQL check passed                                                                                 |
| Full gate          | PASS; Core plus 44 permission, 20 concurrency, 32 recovery, 25 security, 3 performance and 39 three-width Edge tests; security findings 0; dependency vulnerabilities 0                     |
| Team Admin real UI | PASS at 1440x900; owner login, UI Kit, retained methodology workspace and validation message visible; invalid uppercase fingerprint caused 0 workspace POST requests; console/page errors 0 |

The first Core attempt was blocked by sandbox `spawn EPERM` and passed after the reviewed local rerun. The first two Full attempts reached the E2E step and stopped because the previously retained task-owned Vite PID `32480` occupied `5173`; that owned process was identified by command line, closed, and the clean Full rerun passed. These were environment/process failures, not passing evidence.

Generated browser evidence is retained under ignored `output/playwright/ai-ux-r1-e41/`. It contains no credentials, cookies or pairing secrets.

## Standard effects and readback

| Object                | Retained fact                                                                                                                                         | Current status                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Workspace             | `workspace-86b7d8df-74b1-4aa0-8332-39a4d12d3235`, team exact, name `产品全链路方法仓库`, repository `product-full-chain`, canonical fingerprint exact | `ACTIVE / VERIFIED`, row version 1                                                      |
| Requirement binding   | existing E4 Requirement to the new workspace, `docs/READ`                                                                                             | exactly 1; Requirement now has exactly 2 bindings including the retained legacy binding |
| Task registry         | `.local/bridge/e4-standard-registry.json`, exact methodology root/fingerprint/Skill hash                                                              | validated and retained; ignored by Git                                                  |
| Workspace idempotency | `PFC_AIUX_E41_WORKSPACE_20260908_R1`                                                                                                                  | exactly 1; fixed-key replay returned the same workspace                                 |
| Binding idempotency   | `PFC_AIUX_E41_BIND_20260908_R1`                                                                                                                       | exactly 1; fixed-key replay returned the same binding                                   |

Each workspace and binding mutation has one matching `ALLOW` audit event and one outbox event. The UI/API/database representations of the new workspace are consistent.

## Pairing deviation and containment

The API process inherited legacy `PFC_LOCAL_TEST_RUN_ID` configuration during the one authorized pairing. As a result, standard-schema facts were created with test-prefixed IDs:

- pairing `CODEx_TEST_M2_R1_REAL_20260906_bridge-pairing-892f977b-c775-4b65-8b42-fd6b7cfa7490`;
- Bridge `CODEx_TEST_M2_R1_REAL_20260906_bridge-19b62fd9-ce8c-4e76-8eef-2cbcac5e0845`.

This is a policy violation and is not counted as standard Bridge integration. The Bridge was revoked through the owner API with idempotency key `PFC_AIUX_E41_REVOKE_MISCONFIGURED_20260908_R1`; readback shows `REVOKED`, a revocation timestamp, one paired audit/outbox event and one revoked audit/outbox event. The task credential was deleted. No secret value was printed or retained in evidence.

Current fail-closed readback:

- affected pairing count: 1, consumed;
- affected Bridge count: 1, revoked;
- Bridge workspace binding count: 1, exact workspace/fingerprint/path, current Git baseline null;
- capability snapshot count: 0;
- ProductWorkSession count for the E4 Requirement: 0;
- ProductWorkTurn count for the E4 Requirement: 0;
- remaining `codex_test_*` schemas: 0.

The retained pairing/Bridge/audit facts will not be deleted to manufacture a clean history. A source/config guard and one explicitly authorized replacement pairing are required before the original E4 remainder can resume.

## Process and sensitive-data cleanup

- The final owned Vite process, API PID `15532`, product-manager Edge PID `10188` and product-owner Edge PID `29328` were closed.
- Final listener readback found no listener on `3001`, `5173`, `9222` or `9223`. The pre-existing PostgreSQL PID `7964` remains on loopback `5432`.
- No Bridge or Codex App Server was left running.
- `.local/bridge/e4-standard-credential.json` and the not-yet-authorized replacement credential path are absent. The non-secret task registry remains retained and ignored.
- The user-provided local login file was read in memory for the local UI check and was not changed, copied into the repository, printed or recorded in evidence.

## Acceptance, metrics and next route

- Implementation: `LOCAL_VERIFIED` for the repository fingerprint guard and Team Admin validation.
- Integration: `PARTIAL`; the standard workspace and Requirement binding are verified, but no valid active Bridge capability, session or turn exists.
- Acceptance: `BLOCKED`; code review, testing and security owners are registered as 陈立, while the representative standard first turn was still absent at this checkpoint.
- Release/observation: `NOT_AUTHORIZED / NOT_STARTED`.
- Rework count: 1 execution correction caused by local test-ID configuration leaking into the standard schema.
- Failed gates: one sandbox-only Core attempt and two Full attempts blocked by the retained Vite port; the final Core and Full runs passed.
- Post-release issues: not applicable; no release occurred.
- Next route: `POD-PFC-001/M2/AI-UX-R1/e4.1-replacement-pairing-authorization`.
