# AI-UX-R1 standard local migration authorization package

> Status: `EXECUTED / STANDARD_SCHEMA_READY / INTEGRATION_NOT_STARTED`  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> Environment: local only  
> Exact target: `127.0.0.1:5432 / pfc_local / pfc`

## Requested authorization

Authorize one standard-local schema change run that applies exactly these two migrations, in order:

1. `202609070006_create_scoped_action_authorizations`
2. `202609070007_create_product_work_sessions`

No business or test rows are created by this package. The AI workspace feature flag remains disabled. Standard data integration and first-turn experience require a later, separately confirmed package.

## Immutable source binding

| Migration                                             | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `202609070006_create_scoped_action_authorizations.ts` | `a157ae86fb6c4ad6249f06d3f71c9cd02ad1ece8fc7880c98b9d5789b6619172` |
| `202609070007_create_product_work_sessions.ts`        | `02c0721e0ecf1735f6a4dd126b0445ca02c4cceb7c46bf79aec871ac0dbd23c4` |

Any source hash change invalidates this authorization and requires a new review.

## Schema impact

- 006 creates `scoped_action_authorizations` and `scoped_action_authorization_material_refs` with actor, requirement, material, expiry, scope-hash, target, status and revocation constraints.
- 007 creates `product_work_sessions`, `product_work_turns`, `product_work_context_bindings`, `product_action_proposals`, `product_work_session_events`, and `product_work_turn_commands`.
- Five operational indexes protect open-session, active-turn, pending-proposal, actor/requirement authorization and pending-command access paths.
- Existing tables are referenced by foreign keys but are not altered or backfilled. Expected business rows created: 0. Existing row rewrites: 0.

## Zero-write preflight evidence

`npm run db:migrate:ai-ux-preflight` passed inside a read-only transaction:

- database `pfc_local`, schema `pfc`, loopback `127.0.0.1:5432`;
- prerequisite migration 005 present;
- target migrations 006/007 absent;
- seven required tables present;
- eight target tables and five target indexes absent.

The execution runner rejects missing/wrong authorization arguments before database access. Its exact authorization code is not a credential and is scoped only to this package.

## Exact execution sequence

1. Recompute both migration SHA-256 values and compare with this package.
2. Run `npm run db:migrate:ai-ux-preflight` and require PASS.
3. Run `npm run db:migrate:ai-ux -- --authorization=POD-PFC-001_AI-UX-R1_STANDARD_LOCAL_006_007_20260907`.
4. Run `npm run db:migrate:ai-ux-readback` and require two migrations, eight tables and five indexes.
5. Run `npm run test:gate:core`.

The runner accepts only a clean start where neither 006 nor 007 is applied, and it rejects any other database target or pre-existing target table. It temporarily binds each migration's internal authorization guard and restores the prior process environment afterward.

## Failure, rollback and stop conditions

- Kysely records each migration transaction separately. If 006 succeeds and 007 fails, stop immediately, preserve migration/table/error evidence, keep the feature flag disabled and request a new forward-recovery authorization. Do not drop tables or edit migration history.
- On any hash mismatch, target mismatch, missing 005, existing 006/007, object conflict, unexpected migration result, password/URL exposure, or non-loopback connection, do not execute.
- Rollback is operational: keep `PFC_AI_WORKSPACE_ENABLED=false` and continue using existing routes. Schema correction is forward-only; destructive down/drop is not authorized.
- PostgreSQL remains the only retained local process. API, Web, Bridge, Codex and browser processes are not needed for this migration package.

## Explicit exclusions

- No standard business/test data, fixtures, seed records, account changes, Skill/Bridge registration, or feature-flag enablement.
- No SIT, staging, production, remote database, remote Git, commit, push, merge, release or deployment.
- No dependency changes, MCP, Zed, customer data, external business calls, or deletion of existing facts.

## Result semantics and next route

Successful execution proves only `STANDARD_SCHEMA_READY`. It does not prove standard integration, product acceptance, release or external effect. After successful readback, the next route becomes `POD-PFC-001/M2/AI-UX-R1/standard-local-integration-design-confirmation`, where the initial context/Skill selection gap must be resolved before normal first-turn use.

Authorization is effective only after the product owner explicitly confirms this exact package in the current collaboration session.

## Authorization and execution record

- Product-owner confirmation: `确认 AI-UX-R1 Stage D 视觉验收，并授权 006/007 标准本地迁移包`.
- Executed at: `2026-09-07 21:24 +08:00` against the exact loopback target in this package.
- Source binding was recomputed before closeout: 006 `A157AE86FB6C4AD6249F06D3F71C9CD02AD1ECE8FC7880C98B9D5789B6619172`; 007 `02C0721E0ECF1735F6A4DD126B0445CA02C4CCEB7C46BF79AEC871AC0DBD23C4`.
- Preflight: `AIUX_STANDARD_MIGRATION_PREFLIGHT_PASS`; 005 present, both targets and all 13 target objects absent before execution.
- Execution: `AIUX_STANDARD_MIGRATION_PASS`; migrations 006/007 applied in order, eight tables created, `businessRowsCreated=0`.
- Independent readback: `AIUX_STANDARD_MIGRATION_READBACK_PASS`; two migration records, eight tables and five indexes present.
- Post-migration Core Gate: `PASS`; 75 unit/contract files with 332 tests, 26 integration files with 114 tests, isolated test-schema cleanup, all workspace builds and PostgreSQL connectivity passed.
- Result boundary: only `STANDARD_SCHEMA_READY` is established. Standard business integration, named acceptance and release remain incomplete and unauthorized.
