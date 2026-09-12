# AI-UX-R1 E4 standard local execution authorization package

> Classification: System Iteration / strict / zero-write preflight  
> Status: `BLOCKED_BY_STANDARD_PREREQUISITES / NOT_AUTHORIZABLE`  
> Date: 2026-09-08  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> Exact environment inspected: `127.0.0.1:5432 / pfc_local / pfc`

## 1. Conclusion

This package does not request execution authorization. The standard-local first turn cannot yet be authorized without bypassing normal product flows. The preflight found valid accounts, team assignment, Requirement, baseline and workspace binding, but the required material, ProductWorkTurn SkillRelease and Bridge capability facts are incomplete.

No standard session, turn, command, authorization, pairing, Bridge, SkillRelease or material row was created. No feature flag or `.env.local` value was changed.

## 2. Read-only candidate inventory

| Fact                                | Read-back result                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Product owner / team administrator  | `product.owner` / `account-1582381b-303b-4254-b8c6-07b5cda6d7b6` / active `TEAM_ADMIN`        |
| Product manager                     | `product.manager` / `account-7ab4dbfd-91a4-4861-9d69-348ce3071d0c` / active `PRODUCT_MANAGER` |
| Test owner                          | `test.owner` / `account-817a5eef-08a7-457b-9b04-2c24d0675ab3` / active `TEST_OWNER`           |
| Team                                | `team-aee2a8e2-e86a-4ecd-9b48-ea42df2d2fc1`                                                   |
| Candidate Requirement               | `REQUIREMENT_0cd191bf-7f83-4d52-8a68-10769b69ad5e`, `M1 本地全链路验收`, G5, rowVersion 6     |
| Current baseline                    | `BASELINE_85d73816-37e8-42fb-9dd3-9cbbf2074fa4`, version 1, `CURRENT`, `INTERNAL`             |
| Workspace binding                   | `workspace-bd7f64d2-d006-4817-bd21-40ae27b167e9`, `docs`, `WRITE`, workspace `ACTIVE`         |
| Workspace verification              | `UNVERIFIED`; a successful normal Bridge pairing may change it to `VERIFIED`                  |
| Current baseline material refs      | 0                                                                                             |
| Active ProductWorkTurn SkillRelease | 0                                                                                             |
| Non-test Bridge registration        | 0                                                                                             |
| AI workspace flag                   | absent from `.env.local`; runtime default is `false`                                          |

The read-only transaction was rolled back. One first workspace query used a non-existent selected column and failed inside a read-only transaction; the corrected join against `requirement_workspaces` completed and was rolled back. Neither query could write data.

## 3. Blocking gaps

| Code                                     | Gap                                                | Evidence and impact                                                                                                                                                                      | Required correction                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MATERIAL_ONBOARDING_UNAVAILABLE`        | No standard material-reference write path          | Non-test source contains no `material_refs` writer outside test-data factories. Creating or completing G0 writes a baseline but no ref. Readiness therefore returns no context.          | Add a normal, atomic idea-and-material registration path; do not insert an acceptance row with SQL or a seed.                                                  |
| `PRODUCT_WORK_TURN_SCOPE_UNREGISTERABLE` | Formal Skill repository rejects the required scope | `PostgresSkillRepository` validates `enabledScopes` only against the two legacy AgentRun operations. `PRODUCT_WORK_TURN` is not registrable even though the evaluated Skill file exists. | Define a versioned SkillRelease scope set including `PRODUCT_WORK_TURN`, add the fixed manifest and idempotent registration command, and test drift rejection. |
| `STANDARD_SKILL_RELEASE_MISSING`         | No standard ProductWorkTurn release                | `skills/pfc-ai-product-work-session/SKILL.md` exists with SHA-256 `7ab40c7367bbe49a12c1c9fb69c1e51196981711e5fa378f40da6a4b50da8ef0`, but it has no standard release row.                | Register only after the source correction and a separately confirmed standard DML package.                                                                     |
| `STANDARD_BRIDGE_MISSING`                | No eligible Bridge/capability snapshot             | Existing non-test Bridge count is zero. Old `CODEx_TEST_` snapshots are expired and ineligible.                                                                                          | Use the existing team-admin pairing page and local Bridge client after the Skill manifest is fixed; require same-snapshot release ID/hash.                     |
| `WORKSPACE_UNVERIFIED`                   | Candidate workspace is not verified                | The workspace is active and bound, but verification is `UNVERIFIED`.                                                                                                                     | Let the normal pairing exchange verify exact fingerprint and `docs` path; do not update the flag directly.                                                     |

The isolated E1-E3 result does not close these gaps because its deterministic factory writes directly to disposable `codex_test_aiux_*` schemas. It is valid engineering evidence, but not standard product integration evidence.

## 4. Actions explicitly not authorized

- No direct SQL/DML, seed, fixture, factory or manual table edit in standard `pfc` to create material, Skill, Bridge, session, turn, command or authorization facts.
- No `PFC_AI_WORKSPACE_ENABLED=true`, `.env.local` edit, API/Web/Bridge/Codex startup for a standard turn, or real model transmission.
- No registration of the AI Skill through a temporary bypass of the current scope validator.
- No reuse of `CODEx_TEST_` IDs or expired capability snapshots as standard evidence.
- No customer, employee, credential, RESTRICTED or unknown-sensitivity content.
- No migration, dependency change, commit, push, merge, remote Git, SIT, production, release or deployment.

## 5. Future executable package prerequisites

A replacement E4 package may be prepared only after all of the following are read back:

1. The normal requirement workflow creates an immutable initial material ref and content hash atomically with a completed initial baseline.
2. The formal SkillRelease scope contract accepts `PRODUCT_WORK_TURN`; the fixed Skill manifest and registration command pass isolated tests and source-hash checks.
3. Quick and Core gates pass, with Full run when the corrected path reaches real Bridge/Codex integration.
4. A non-sensitive, non-test Requirement and exact current material ref exist through the product UI/API; no seed or script insert is used.
5. A non-test Bridge is paired by the active team administrator, verifies the exact workspace/path and reports a fresh capability snapshot containing the exact Skill release ID/hash and `product-work-turn/1`.
6. A new zero-write preflight records the exact actor, Requirement, baseline, material refs, SkillRelease, Bridge, workspace, flag handling, allowed write types, retained IDs, process ownership, evidence and stop conditions.

## 6. Stop conditions and next route

Stop on a source/hash mismatch, non-loopback target, ambiguous actor or business fact, missing/expired capability, unexpected command, duplicate session/turn, `UNKNOWN` represented as success, material content exposure, direct standard-table bypass, or any scope expansion.

Current POD next route: `POD-PFC-001/M2/AI-UX-R1/standard-prerequisite-remediation-design-confirmation`.

The proposed correction is documented in `POD-PFC-001-M2-AI-UX-R1-STANDARD-PREREQUISITE-REMEDIATION-DESIGN-20260908.md`. Its implementation requires explicit product-owner confirmation. This blocked package itself grants no execution authority.

Successor note: Option B was confirmed and locally verified on 2026-09-08. This blocked package remains historical evidence and is superseded by `POD-PFC-001-M2-AI-UX-R1-REISSUED-STANDARD-LOCAL-EXECUTION-AUTHORIZATION-PACKAGE-20260908.md`; the successor still requires separate product-owner confirmation.
