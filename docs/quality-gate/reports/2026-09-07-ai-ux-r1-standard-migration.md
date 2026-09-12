# AI-UX-R1 standard local migration report

> Date: 2026-09-07  
> Parent POD / milestone: `POD-PFC-001 / M2`  
> Scope: migrations 006/007 only  
> Result: `PASS / STANDARD_SCHEMA_READY / INTEGRATION_NOT_STARTED`

## Authorization and target

- Product-owner authorization: `确认 AI-UX-R1 Stage D 视觉验收，并授权 006/007 标准本地迁移包`.
- Authorization binding: `POD-PFC-001_AI-UX-R1_STANDARD_LOCAL_006_007_20260907`.
- Environment and target: local loopback `127.0.0.1:5432`, database `pfc_local`, schema `pfc`.
- Configuration source: ignored `.env.local`; only the configured target identity was reported, and no connection URL or password was logged.
- 006 SHA-256: `A157AE86FB6C4AD6249F06D3F71C9CD02AD1ECE8FC7880C98B9D5789B6619172`.
- 007 SHA-256: `02C0721E0ECF1735F6A4DD126B0445CA02C4CCEB7C46BF79AEC871AC0DBD23C4`.

## Executed evidence

| Command                                                                                            | Environment/data policy                         | Result                                                                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run db:migrate:ai-ux-preflight`                                                               | Standard schema, read-only transaction          | PASS; 005 present, targets absent, 7 prerequisites present, 8 tables/5 indexes absent           |
| `npm run db:migrate:ai-ux -- --authorization=POD-PFC-001_AI-UX-R1_STANDARD_LOCAL_006_007_20260907` | Authorized standard schema DDL; no row creation | PASS; 006/007 applied in order, 8 tables created, `businessRowsCreated=0`                       |
| `npm run db:migrate:ai-ux-readback`                                                                | Standard schema, read-only transaction          | PASS; 2 migration records, 8 tables and 5 indexes present                                       |
| `npm run test:gate:core`                                                                           | Local source checkout; isolated test schemas    | PASS; 75 files/332 tests, 26 integration files/114 tests, builds, cleanup and database check    |
| final `npm run test:gate:quick`                                                                    | Local source checkout                           | First attempt blocked by Windows `spawn EPERM`; unchanged-source rerun PASS, 75 files/332 tests |

## Data, cleanup and risk

- No business rows, test rows, fixtures, seeds, accounts, Skills or Bridge registrations were created in standard `pfc`.
- Core integration tests used isolated `codex_test_*` schemas; cleanup readback reported `remaining=0`.
- The first final Quick attempt reached unit-test startup after config, governance, UI, lint, format and type checks passed, then was blocked by restricted child-process creation (`spawn EPERM`). The same command was rerun with the same source under the approved project execution context and passed; no speculative code change was made.
- The standard schema change is intentionally retained. No destructive down/drop or migration-history edit was authorized or performed.
- Operational rollback remains `PFC_AI_WORKSPACE_ENABLED=false`; schema correction, if later required, is forward-only.
- No sensitive data was read into evidence or persisted by this package.

## Conclusion and next route

This run proves `STANDARD_SCHEMA_READY` only. It does not prove standard business integration, product acceptance, release, deployment or external effect. Named code review, testing and security owners remain `陈立` and have not issued acceptance conclusions.

The next route is `POD-PFC-001/M2/AI-UX-R1/standard-local-integration-design-confirmation`. That design must resolve initial material-context and compatible-Skill selection for a newly created session before any standard business data setup, feature-flag enablement or first-turn verification is authorized.
