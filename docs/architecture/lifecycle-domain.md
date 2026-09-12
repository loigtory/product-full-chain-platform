# T1 Lifecycle Domain And Persistence

`CAP-PFC-01 T1` establishes the domain and PostgreSQL boundary shared by `UNIT-PFC-01-01` through `UNIT-PFC-01-05`. It does not expose business HTTP routes or authorize application-schema migration.

## Domain Boundary

- `packages/contracts` owns stable lifecycle, material, Question, GateRun, sensitivity, and error value sets.
- `packages/domain` owns G0 completeness, immutable Question transitions, adjacent-stage progression, stale-baseline handling, and bounded event summaries.
- A Requirement keeps one authoritative `currentStage`, `currentBaselineId`, and `rowVersion`. GateRun results remain separate historical records.
- Only a current-baseline/current-stage `PASS` can create an adjacent `StageAdvancement`; replaying the same advancement is idempotent.
- Event summaries reject body-like, answer, prompt, credential, token, cookie, and authorization fields. They accept at most 32 bounded JSON scalar fields.

Object-level authorization and sensitive-action authorization are deliberately deferred to T2. T1 stores ownership, sensitivity, access decisions, and audit references without inventing permission outcomes.

## Persistence Boundary

The first explicit Kysely migration is `packages/persistence/src/migrations/202609040001_create_lifecycle.ts`. It creates the `pfc` application schema when later applied through `npm run db:migrate`. T1 verification invokes the same schema builder only against a uniquely named `codex_test_*` schema and drops that schema after each run.

The migration creates 14 lifecycle tables:

- Current objects: `requirements`, `material_baselines`, `questions`, `gate_runs`, `material_impact_assessments`.
- Immutable facts: `decisions`, `material_refs`, `gate_checks`, `gate_run_evidence`, `stage_advancements`.
- Recovery and delivery: `timeline_events`, `outbox_events`, `audit_events`, `idempotency_records`.

Database constraints enforce valid enums and record shapes, one current baseline, one in-progress GateRun per Requirement/baseline/stage, baseline ownership, Question/Decision ownership, sequential advancement, one advancement per GateRun, and advancement only from a current completed PASS. Delete triggers reject physical deletion of lifecycle facts; migration rollback drops the owning schema rather than deleting rows.

`PostgresLifecycleRepository.createRequirement` writes the Requirement, optional first baseline, TimelineEvent, and pending OutboxEvent in one transaction. It validates timeline and outbox summaries again at the persistence boundary. Any failure rolls back the complete aggregate write.

## Commands And Evidence

- Unit and contract: `npm run test:unit`
- Isolated local PostgreSQL: `npm run test:integration`
- Test-schema cleanup readback: `npm run db:test-cleanup-check`
- Migration discovery dry-run: `npm run db:migrate:plan`
- Quick gate: `npm run test:gate:quick`
- Core gate: `npm run test:gate:core`
- Application migration command: `npm run db:migrate` (implemented, not executed during T1)

The integration command reads ignored `.env.local`, never prints `DATABASE_URL`, uses synthetic IDs prefixed with `CODEx_TEST_`, and limits Vitest to one worker. A missing database configuration fails the integration suite rather than silently skipping it.

T2 authorization, T3+ API/UI behavior, default `pfc` schema application, full gate, business acceptance, commit, remote operations, deployment, and release remain separate lifecycle actions.
