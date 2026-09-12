# AI-UX-R1 standard prerequisite remediation design

> Classification: System Iteration Requirement / strict  
> Status: `CONFIRMED / R1-R2 LOCAL_VERIFIED`  
> Date: 2026-09-08  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> CAP / Unit scope: `CAP-PFC-01 / UNIT-PFC-01-02`, `CAP-PFC-03 / UNIT-PFC-03-01`, `CAP-PFC-04 / UNIT-PFC-04-04`
> Product-owner confirmation: `确认 AI-UX-R1 标准前置修正方案 B 及第 10 节实施授权范围`（2026-09-08）

## 1. Goal and evidence

Make E4 executable through normal platform behavior, without using SQL, seeds or test factories to manufacture acceptance facts.

The current standard preflight proves:

- a completed G0 creates a material baseline but no material ref;
- no non-test production module inserts `material_refs`;
- the evaluated `pfc-ai-product-work-session` Skill exists, but the formal repository rejects its required `PRODUCT_WORK_TURN` scope;
- the existing Bridge pairing page and exchange flow can create a standard Bridge and verify an exact workspace binding, but it cannot advertise an unregistered ProductWorkTurn Skill;
- the standard AI workspace flag remains disabled.

This is a product-path defect, not an acceptance-data shortage. The authority for `UNIT-PFC-01-02` requires “想法与材料登记” to form a traceable Requirement and material baseline.

## 2. Goals, non-goals and assumptions

Goals:

1. A complete new Requirement always has one immutable, hash-bound initial material ref for its original idea.
2. Completing an initially incomplete G0 creates the same initial ref atomically with its first baseline.
3. The formal SkillRelease contract can register the evaluated ProductWorkTurn Skill without weakening unknown-scope rejection.
4. Standard Skill registration is fixed-source, idempotent and drift-detecting.
5. Existing Bridge pairing remains the only standard workspace-verification and Bridge-registration path.

Non-goals:

- No general file upload, external URL fetch, rich material editor, arbitrary material append, historical baseline backfill or migration in this correction.
- No automatic AI turn, auto-approval, proposal application, Zed/MCP handoff, release or deployment.
- No standard business write or feature-flag change during implementation and automated verification.

Assumptions:

- The original idea text is the authoritative first material for the initial baseline.
- The acceptance Requirement will be newly created through the normal UI/API after the correction; legacy baselines with zero refs remain visible but are not silently rewritten.
- The representative acceptance input will be non-sensitive platform work, classified `INTERNAL`.

## 3. Options and decision

| Option | Description                                                                                                                                              | Benefit                                                                                                  | Cost/risk                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A      | Use an operational script or SQL to insert the missing material and Skill rows                                                                           | Fastest path to one successful run                                                                       | Bypasses the product path, repeats the isolated-factory mistake and cannot satisfy product acceptance; rejected.            |
| B      | Atomically materialize the original idea during normal G0 creation/completion; add the formal ProductWorkTurn Skill scope/manifest; reuse Bridge pairing | Smallest complete correction, closes the proven first-turn prerequisites and preserves module boundaries | Legacy zero-ref baselines are not backfilled; general material ingestion remains deferred.                                  |
| C      | Build the full material ingestion, upload, external-source, version comparison and baseline-change workflow now                                          | Broadest long-term material capability                                                                   | Expands into `UNIT-PFC-02-03` and later version-review scope, delays the active M2 route and needs a larger UX/data design. |

Selected and confirmed: **Option B**. It fixes the exact broken product path now. Option C remains a planned product iteration and must not be smuggled into E4.

## 4. Domain and data design

When `createRequirementDraft` receives complete G0 registration, the application creates in one transaction:

- Requirement;
- initial `CURRENT` MaterialBaseline version 1;
- one MaterialRef with server-generated ID, `referenceType=ORIGINAL_IDEA`, `source` equal to the preserved original idea text, `version=1`, SHA-256 of the exact UTF-8 text, logical location `pfc://requirements/{requirementId}/original-idea`, inherited sensitivity, `VALID`, and creation time;
- existing timeline/outbox/audit/idempotency facts.

When G0 is initially incomplete, no baseline or ref exists. The successful `completeG0Registration` transaction creates both exactly once. Idempotent replay returns the original aggregate; a conflicting key or row version creates neither duplicate.

MaterialRef remains an immutable evidence fact. This correction adds no endpoint that mutates or appends refs to an already confirmed baseline. Existing zero-ref baselines are not backfilled because that would rewrite prior business meaning without a user-confirmed material-change flow.

## 5. SkillRelease design

- Add an explicit versioned `SKILL_RELEASE_SCOPES` contract containing the two existing AgentRun scopes plus `PRODUCT_WORK_TURN`.
- Keep AgentRun request operations unchanged; ProductWorkTurn is a SkillRelease compatibility scope, not a new legacy AgentRun operation.
- Change `PostgresSkillRepository.registerRelease` to validate against `SKILL_RELEASE_SCOPES` and continue rejecting empty, unknown or malformed values.
- Add a fixed manifest for `skills/pfc-ai-product-work-session/SKILL.md` with required capability `PRODUCT_WORK_TURN`, enabled scope `PRODUCT_WORK_TURN`, compatible Codex App Server harness, evaluated status `PASSED`, and exact content hash.
- Add an idempotent loopback-only registration command. Existing same key/version must match ID, content hash, risk, capability and scope; any drift fails closed.

No database migration is needed because the existing JSON columns can store the new scope.

## 6. Architecture and file ownership

| Area                                           | Responsibility                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                           | SkillRelease scope constant/type and exports                                                                              |
| `packages/domain`                              | Initial material-ref invariant and construction input/output                                                              |
| `apps/server/src/requirements`                 | Hashing/ID orchestration and atomic command shape; no Skill or Bridge logic                                               |
| `packages/persistence/src/repository.ts`       | Insert Requirement, baseline and initial ref in the existing transaction                                                  |
| `packages/persistence/src/skill-repository.ts` | Formal scope validation only                                                                                              |
| `scripts/`                                     | Fixed AI ProductWorkTurn Skill manifest and guarded local registration command                                            |
| `apps/web`                                     | No new visual primitive required; existing create Requirement, material library, work-session and Bridge pages are reused |
| `tests/`                                       | Domain, persistence, API, Skill registration, architecture and browser/readback coverage                                  |

The change must not move material persistence into the work-session module, put Skill registration into a browser route, or add acceptance setup to production services.

## 7. TDD, test data and quality gates

TDD sequence:

1. Add failing domain/service tests for complete creation, incomplete creation, later G0 completion, exact content hash, sensitivity inheritance, idempotent replay and conflict rollback.
2. Add failing isolated PostgreSQL tests proving Requirement/baseline/ref atomicity, no duplicate, and no partial write.
3. Add failing SkillRelease scope and fixed-manifest tests, including unknown scope and content-drift rejection.
4. Add API and existing-page readback tests showing the normal creation result appears in Requirement detail/material library and is returned by work-session readiness.
5. Run targeted tests, Quick, Core and Full. Full remains isolated and may use only disposable `codex_test_*` schemas until the replacement E4 package is confirmed.

Test data is deterministic synthetic data only, with `CODEx_TEST_` IDs and disposable schemas. It covers complete/incomplete G0, replay/conflict, INTERNAL/RESTRICTED metadata, scope allow/reject and Skill drift. No customer or employee content is used.

## 8. Standard execution after implementation

Implementation completion does not authorize standard DML. After all gates pass, a replacement E4 package must separately authorize:

1. fixed SkillRelease registration in `pfc_local/pfc`;
2. one normal non-sensitive Requirement creation by `product.manager`, with its returned exact baseline/material IDs read back;
3. assignment/workspace binding through existing product APIs if the new Requirement needs them;
4. one team-admin Bridge pairing, workspace verification and fresh capability snapshot;
5. a process-scoped AI-workspace flag for owned loopback API/Web/Bridge processes;
6. one retained standard session/turn/command/event chain and real Codex transmission;
7. API/database/UI readback, restart recovery, process cleanup and named acceptance evidence.

## 9. Risk, rollback and stop conditions

- Sensitive original idea: acceptance uses explicitly non-sensitive `INTERNAL` text; runtime continues to require exact authorization for RESTRICTED refs.
- Hash ambiguity: hash exact stored UTF-8 text; do not trim or transform after validation.
- Partial aggregate: one PostgreSQL transaction and rollback tests.
- Scope broadening: only `PRODUCT_WORK_TURN` is added; unknown scopes remain rejected.
- Legacy state: zero-ref baselines remain blocked and visible; no automatic backfill.
- Performance: one extra insert and SHA-256 operation per first completed baseline; realistic load remains unmeasured and should be reported, though no unbounded work is introduced.

Rollback during implementation is source-only. The standard flag stays false and no standard row is written. After later authorized standard execution, facts are retained and corrected forward; no delete/drop/cascade is part of this design.

Stop immediately on wrong database target, source/hash drift, partial aggregate, duplicate ref, unexpected migration, fixture use in standard acceptance, content exposure, unknown scope acceptance, non-loopback listener, or an unowned process.

## 10. Version, acceptance and execution authorization

Version plan:

| Step | Status/exit                                              |
| ---- | -------------------------------------------------------- |
| R0   | `CONFIRMED` by product owner on 2026-09-08               |
| R1   | `PASS`; source correction and targeted isolated TDD      |
| R2   | `PASS`; Quick/Core/Full, no standard write               |
| R3   | `AWAITING_CONFIRMATION`; replacement E4 package reissued |
| R4   | `NOT_STARTED`; E5 standard first turn and readback       |

Code review, testing and security owners are registered as 陈立. Their evidence-backed conclusions remain required for overall AI-UX-R1 acceptance, but personnel availability is not a blocker.

Requested implementation authorization after confirmation:

- Write only the source, tests, package scripts, delivery ledger, checkpoint and reports described above.
- Run fixed local Node/npm commands, targeted tests and Quick/Core/Full gates; isolated PostgreSQL schemas and owned loopback processes only.
- No dependency install/upgrade, migration, standard `pfc` DML, `.env.local` edit, standard Skill registration, Bridge pairing, real standard turn, commit/push/merge, remote target, release or deployment.

No parallel Agent is planned. Owned short-lived API/Web/Bridge/Codex/browser/test processes must be closed; the existing loopback PostgreSQL service may remain and must be reported.

Implementation evidence is recorded in `docs/quality-gate/reports/POD-PFC-001-M2-AI-UX-R1-STANDARD-PREREQUISITE-REMEDIATION-20260908.md`. This source correction does not authorize or imply standard Skill registration, standard business writes, Bridge pairing, ProductWorkTurn execution, acceptance, release or deployment.
