# Product Full Chain Platform - Agent Instructions

These rules apply to the implementation repository at `D:\项目管理\product-full-chain-platform`.

## Active Handoff Scope - 2026-09-12

- The current user-confirmed development path is the original HTML/JavaScript prototype plus the Express server. Start with [19 - Roadmap](docs/planning/prototype-v3/19-开发路线图-20260912.md), [20 - Task template](docs/planning/prototype-v3/20-Codex交接提示词-20260912.md), and [21 - Implementation checkpoint](docs/planning/prototype-v3/21-M2b-2前端切领域API-20260912.md). Read all three: roadmap completion labels do not supersede the checkpoint's incomplete implementation, verification, or scope decisions. Unresolved differences must be aligned with the user before expanding implementation.
- Active frontend: `output/pfc-workbench-prototype/index.html` and `original/`, plain HTML/CSS/JavaScript without a framework or build-system migration. Active backend: `server/`, Node 24 + Express 4 + ws + jsonwebtoken + pg. Use the existing dependencies and pinned `.tools/node-v24.20.0-win-x64` runtime.
- The React/Vite, Fastify/SSE, Kysely, `packages/ui`, workspace commands, and module rules below continue to govern the retained `apps/`, `packages/`, and their `scripts/` and `tests/`. These are prior engineering assets, not the default implementation path for this handoff. Do not retire, migrate, delete, or resume that implementation based solely on prototype work. Shared root dependencies remain necessary for prototype ESLint and Playwright checks.
- M2b-2 local protocol/UI work under 24 was accepted by the user on 2026-09-12 (reviewed commit `6dedc41`). The next prototype step is the M2c design and scope confirmation under roadmap 19. The unresolved scope in 21 records the historical checkpoint; the later user approval in 24 covers verifying and completing that existing draft. Approval to organize files under [22 - Cleanup scope](docs/planning/prototype-v3/22-主线收口与历史代码整理建议-20260912.md) alone never authorized API expansion. M2c and the old POD ledger's next route are distinct records; do not silently update either scope or status.
- Preserve the original desktop interaction. For this standalone frontend, inspect its `original/` styles and the approved original-prototype reference, then use the existing browser-aware static and real PC browser verification. Do not import `@pfc/ui` or a framework merely to match the older workspace rules.
- The handoff's six verification entry points are `output/pfc-workbench-prototype/verify-prototype.mjs`, `verify-m1-layer.mjs`, `verify-m1-e2e.mjs`, and `server/verify-server.mjs`, `verify-server-m2.mjs`, `verify-m2b.mjs`. The two M2b-2 focused checks are `output/pfc-workbench-prototype/verify-m2b2-model.mjs` and `server/verify-m2b2-domain.mjs`. Run these with the pinned Node runtime. Passing existing regression scripts does not establish the new UI flow's acceptance or replace root Quick/Core/Full for changes to the older workspace.
- Current handoff verification uses synthetic browser contexts and loopback memory servers with `PFC_DB=memory` and an empty `DATABASE_URL`. PostgreSQL domain persistence is a later task, not a completed fact. `server/src/db.js` can execute schema SQL when given a database URL; do not enable that path without the existing scope-specific migration authorization. Sim-bridge protocol output is synthetic and must remain visibly identified. Browser code must not execute Shell, Git, Codex, Zed, or database commands directly.
- `archive/prototype-v3-reference-20260912/` contains the old V3 reference only. Read its README and manifest for original paths; its historical scripts are not current gates. Preserve all `output/pfc-workbench-prototype/_backup/`, `output/playwright/`, other old verification scripts/images, and `output/pfc-design-overview.html` in place. Only the 12 named files in 22 are authorized for this archive move.
- All existing authorization, lifecycle, secrets, local binding, test-data, external-effects, release, and process-cleanup requirements still apply. Git is now authoritative for version recovery: initial baseline `69ec9eb`, with the current remote head checked at each task start. Read [23 - Development protocol](docs/planning/prototype-v3/23-Codex防走偏协议-20260912.md); use scoped feature branches, explicit file staging, opening/closing commits, and user review before merging main. Historical manifests and backups remain preserved.
- The user approved M2b-2 acceptance closeout on 2026-09-12. Its scope, file whitelist, verification and review status are recorded in [24 - Acceptance closeout](docs/planning/prototype-v3/24-M2b-2验收收尾-20260912.md). Exercise the existing 21 draft's creation/version/stage/run flow and fix reproduced defects within that scope; align any new contract semantics first. The subsequent user message “评审通过，继续” authorizes the reviewed M2b-2 no-ff merge and main push under 23, plus preparation of the next M2c scope. New M2c design choices, database schema application, and real workspace execution are not implied by accepting M2b-2.

## Purpose And Lifecycle

- Build the PC Web product-requirement lifecycle platform defined by the approved `product-full-chain` methodology.
- Every system iteration follows requirements -> design -> development -> testing -> acceptance -> release -> observation -> retrospective.
- The current bootstrap establishes tooling and empty application boundaries only. It does not authorize CAP business behavior.
- Do not implement, commit, push, merge, publish, deploy, or write to an external environment without explicit scope-specific authorization.

## Runtime And Stack

- Node.js: project-local Node 24.x; npm 11.x; use the pinned runtime under `.tools/` for all project commands.
- Monorepo: npm workspaces.
- PC Web: React 19 + Vite 8. Mobile layouts and mobile acceptance are out of scope.
- API: Fastify 5 modular monolith, bound to loopback by default.
- Persistence: PostgreSQL 18 + Kysely with explicit SQL migrations.
- Browser updates: HTTP plus SSE. Browser code must never invoke Shell, Git, Codex, Zed, or the database directly.

## Module Boundaries

- `apps/web`: PC SPA, routes, interaction, and SSE client.
- `apps/server`: HTTP/SSE boundary, authorization entry, configuration, and module assembly.
- `packages/domain`: product lifecycle objects, state machines, invariants, and domain errors.
- `packages/contracts`: versioned DTOs, error codes, SSE events, and cross-CAP ports.
- `packages/persistence`: repositories, migrations, transactions, and outbox support.
- `packages/test-data`: deterministic synthetic fixtures and factories only.
- `packages/ui`: shared desktop UI primitives and design tokens; never authoritative business state.
- Modules do not edit another module's tables directly. Cross-module behavior goes through application services or domain events.
- Independently routed frontend pages belong in separate feature directories. `App.tsx` composes routes and cross-page state; shared feature UI, hooks, and formatters live in an explicit feature-owned shared module instead of accumulating multiple pages in one large file.
- Backend features keep transport routes, application services, domain policy, and repository ports in separate modules. A file has one primary responsibility; do not combine multiple independently changeable pages, API boundaries, or persistence concerns merely to reduce file count.
- When an existing oversized file is touched for a system iteration, include the smallest safe responsibility split in the design and protect the resulting boundary with an architecture test.

## POD Delivery Governance

- `.quality-gate/delivery-plan.json` is the implementation repository's machine-readable progress ledger for the confirmed `POD-PFC-001` scope. It must retain all 5 CAPs, all 26 Units, M1-M3 membership, current status, real dependency source, and exactly one POD-level next route while delivery is incomplete.
- The adjacent methodology repository remains authoritative for product scope and confirmed behavior. Update the local ledger only from a confirmed authority version; never use the ledger to invent, remove, or silently defer a CAP or Unit.
- Every iteration design, checkpoint, gate report, and completion handoff must state parent POD, milestone, CAP/Unit scope, implementation status, integration status, acceptance status, deferred scope, and POD-level next route. A final Txx or CAP task returns control to the parent POD instead of implying that the platform is complete.
- M1 cannot complete from `CAP-PFC-01` alone. It also requires `UNIT-PFC-02-01` and `UNIT-PFC-04-01` through `UNIT-PFC-04-03` with standard local PostgreSQL persistence and real local integration evidence. Equivalent M2 and M3 scope is enforced by the delivery ledger.
- `LOCAL_VERIFIED`, `INTEGRATED`, `ACCEPTED`, and `RELEASED` are distinct conclusions. Fixture, mock, unavailable adapter, generated report, dry-run, or isolated test result cannot be counted as real integration, product acceptance, release, or external effect.
- UI redesign work may address confirmed usability defects but must not silently replace the current POD next route. Before starting another UI-only iteration, record why it blocks the active milestone; otherwise continue the active CAP/Unit plan.
- Run `npm run check:delivery-governance` through every quick/core/full gate. A mismatch between the confirmed POD scope, milestone claim, persistence policy, dependency source, or next route fails closed.

## Runtime Data Policy

- Standard local product operation persists business facts in PostgreSQL database `pfc_local`, schema `pfc`, through reviewed migrations and repositories. In-memory state and `pfc_experience` data are not product facts and cannot satisfy CAP, milestone, acceptance, or release evidence.
- Fixtures and deterministic factories are test infrastructure only. They may write only to disposable `codex_test_*` schemas or remain process-local, must use the `CODEx_TEST_` prefix, and must be cleaned and read back after tests.
- `PFC_EXPERIENCE_MODE` and `pfc_experience` are legacy visual-evaluation paths pending retirement before M1 exit. They remain disabled by default, must be visibly identified when temporarily used, and cannot be used for business acceptance.
- New user-visible workflows that require persistence must include a PostgreSQL migration/repository/API readback plan in their confirmed design. Do not substitute seeded demonstration records because a persistent model has not yet been designed.

## UI Design System

- `packages/ui` is the only source of visual tokens, shared controls, and cross-page interaction patterns. Inspect the local `/ui-kit` catalog before creating or changing a page.
- Business pages in `apps/web` compose `@pfc/ui` components and may own only domain layout, data binding, and business-specific state mapping.
- New visual values or interaction states must first be added to the three token layers and the UI catalog with tests. Do not add page-local colors, font families, font sizes, line heights, radii, shadows, or motion durations.
- Run `npm run check:ui-design`; bypassing or allowlisting a failure requires an explicitly confirmed design-system change, not a page-local exception.
- Preserve the dense PC operational model. Do not turn tables into marketing cards, introduce decorative hero content, or add external fonts/assets without a separately confirmed design.
- Visual quality must not be traded for implementation speed. A technically complete page is not complete when its visual hierarchy, interaction feedback, or reference fidelity is still unverified.
- Reference-led UI work must complete a durable reference study before implementation. Sample all relevant page types and states available in the reference, including navigation, list or workbench, detail, data-dense content, empty/loading/error where available, keyboard focus, hover, filtering, and URL/state preservation.
- The reference study must extract evidence-backed primitive, semantic, and component tokens; typography roles; layout grid; surface hierarchy; icon language; motion; interaction states; page templates; and explicit adaptations for this platform. A few generic similarities such as “blue, rounded, centered” are insufficient.
- Record the reference study under `docs/design-system/`, then obtain explicit user confirmation of the platform visual baseline before changing business pages. Implement one real representative page first and compare side-by-side at 1280, 1440, and 1920 widths; do not migrate other pages until that sample is visually accepted.
- Browser screenshots, computed styles, interaction evidence, and the local `/ui-kit` are required visual evidence. Automated tests and quality gates do not substitute for human visual acceptance, and no completion claim may conflate the two.
- If required design, browser, font, icon, or inspection tooling is unavailable or incomplete, stop the affected phase. Enable or install the smallest suitable tool only after dependency and supply-chain review plus any required authorization; never silently downgrade to a lower-fidelity workflow.
- Dense operational design means compact, scannable information with clear hierarchy. It does not mean flat styling, undifferentiated rows, one-note color, missing overview context, or the absence of purposeful cards and visual emphasis.

## Commands And Quality Gates

Activate the project runtime in PowerShell before running npm commands:

```powershell
$env:Path="$PWD\.tools\node-v24.20.0-win-x64;$env:Path"
```

- Quick: `npm run test:gate:quick`
- Core: `npm run test:gate:core`
- Full: `npm run test:gate:full`
- Gate planning: append `-- --dry-run`.
- Quick covers lint, formatting, type checking, configuration checks, and unit tests.
- Core adds isolated migration/repository integration tests, production builds, and local PostgreSQL connectivity.
- Full runs core plus real PC browser, permission, concurrency, recovery, security, local performance-smoke, and dependency-audit checks, and fails closed on any failed step. A dry-run is not a PASS.
- Use TDD for behavior changes when practical: confirm the expected failure, implement the smallest change, then rerun proportional gates.

## Test Data And Evidence

- Use only synthetic local fixtures during development. Test identifiers use the `CODEx_TEST_` prefix plus a runId.
- Before data-dependent tests, record scenario, business validity, boundaries, permission/state combinations, assertions, isolation, created IDs, cleanup, and sensitive-data handling.
- Create a deterministic factory when setup exceeds three steps or when scenarios cover CRUD, state, permissions, versions, boundaries, concurrency, or negative paths.
- Store durable, redacted gate reports under `docs/quality-gate/reports/`. Do not treat generated console output as business acceptance.

## Database And Migrations

- Local PostgreSQL is `pfc-postgresql-18`, manually started, loopback-only, database `pfc_local`, application role `pfc_app_local`.
- The Windows runtime uses the current-user junction `%LOCALAPPDATA%\PFCPlatform` because PostgreSQL initialization cannot safely consume the Chinese physical path. All binaries and data remain physically inside this repository.
- Schema changes happen only through reviewed migration files. Application startup must not silently mutate schema.
- Validate every migration against an isolated local database. Production DDL/DML and real-environment changes require separate authorization and review.
- `npm run db:migrate` applies pending migrations to the configured local database; do not run it against the default application schema without a scope-specific local schema-change authorization.
- Never print database passwords or connection URLs in test output, screenshots, logs, or reports.

## Secrets And Generated Artifacts

- Local configuration comes from ignored `.env.local`; CI and deployment values come from their secret providers. Only key names and safe examples belong in `.env.example`.
- Required runtime keys are validated at startup. Fixture adapters are allowed only when `APP_ENV` is `local` or `test`.
- Never commit credentials, tokens, cookies, customer data, prompts containing restricted material, private URLs, or real operational logs.
- Do not edit generated bundles, coverage, lockfile internals, database data, or vendored artifacts manually. Change source and run the owning command.

## External Effects And Release

- Local services bind to `127.0.0.1` unless a separately approved design says otherwise. Do not add firewall rules.
- No SIT, staging, production, customer system, remote database, Git remote, Codex/Zed bridge, or external publication is available by default.
- Release requires an approved artifact source, environment and owner, rollback, smoke/readiness checks, observation window, monitoring, and explicit authorization.
- Stop and preserve evidence on credential exposure, permission bypass, duplicate lifecycle advancement, stale-baseline corruption, unexplained dependency scripts, or resource errors.

## Ownership And Process Hygiene

- 陈立 is the product owner, development/engineering owner, code-review owner, testing owner, and security owner for `POD-PFC-001`.
- The product owner has explicitly accepted same-person ownership for the local development lifecycle. Missing or independent personnel must not block delivery; each role conclusion still requires its own evidence and must not be inferred from another role's result.
- Parallel work requires non-overlapping ownership, stable interfaces, independent verification, and an integration order.
- Close short-lived dev servers, browsers, watchers, and test runners before handoff. Report any retained process with PID, port, purpose, and stop command.
