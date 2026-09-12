# T0 Bootstrap Architecture

This repository is the implementation workspace for `CAP-PFC-01 V0.1/R4`. T0 establishes a reproducible local toolchain and an empty modular-monolith shell. It does not implement `UNIT-PFC-01-01` through `UNIT-PFC-01-05`.

## Fixed Decisions

- npm workspaces with project-local Node 24.
- React/Vite PC Web and Fastify API.
- PostgreSQL/Kysely persistence boundary with explicit migrations.
- HTTP plus SSE for browser updates; no browser-to-terminal path.
- Local-only bootstrap. No Codex, Zed, Git remote, Bridge, SIT, production, or customer-data integration.

## Local Infrastructure

- Physical project root: `D:\项目管理\product-full-chain-platform`.
- PostgreSQL service: `pfc-postgresql-18`, manual start.
- Runtime alias: `%LOCALAPPDATA%\PFCPlatform` directory junction to the physical project root.
- Listener: `127.0.0.1:5432` only.
- Database/role: `pfc_local` / `pfc_app_local`.
- Secrets and database data remain under ignored `.local/` paths.

## Current Exit Boundary

T0 is ready only after the project rules, quality profile, lockfile, configuration boundary, local database check, build, and quick gate dry-run are verified. Full product gates remain blocked until business implementation and its acceptance evidence exist.
