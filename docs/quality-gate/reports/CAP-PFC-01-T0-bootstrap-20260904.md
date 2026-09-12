# CAP-PFC-01 T0 Bootstrap Quality Report

> Reported at: `2026-09-04 14:11:16 +08:00`  
> Authorization: `AUTH-PFC01-T0-001`, confirmed by the current user  
> Physical root: `D:\项目管理\product-full-chain-platform`  
> Conclusion: `T0_BOOTSTRAP_PASS / BUSINESS_FEATURES_NOT_STARTED`

## Scope And Boundaries

This run created a local development and quality-gate baseline only. It did not implement `UNIT-PFC-01-01` through `UNIT-PFC-01-05`, connect Codex/Zed/Bridge, write to SIT or production, create a Git remote, commit, push, merge, deploy, or use real customer data.

## Environment Evidence

| Item         | Observed result      | Source or control                                                                                                                                   |
| ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js      | `24.20.0`            | Official Node archive; project-local `.tools/node-v24.20.0-win-x64`; ZIP SHA-256 `6CAC9FFBCA8F6A47091E4B5C772E0606049C3871CB67D900C0CEDDE630E545BA` |
| npm          | `11.19.0`            | Bundled with the project-local Node distribution                                                                                                    |
| Git          | `2.42.0.windows.2`   | Existing host installation                                                                                                                          |
| PostgreSQL   | `18.6`               | PostgreSQL website-linked EDB Windows x64 binary archive; ZIP SHA-256 `59F8CE701C63C2ED623C665A5E51B3EF6F2E37CCF837B68FFEED0742D0AE6ABD`            |
| Package lock | lockfile version `3` | SHA-256 `2DEE3E2ADF85AD55D476A3739E39AA62BFDA47FCBB608B3234A4746B9AD6F844` at report time                                                           |

The PostgreSQL ZIP was obtained over HTTPS from the official EDB binary page linked by PostgreSQL.org. Archive entries were checked before extraction: 22,018 entries, all under `pgsql/`, with no absolute or parent traversal paths. The extracted `postgres.exe` is not Authenticode-signed; this limitation is recorded instead of being represented as a signature PASS.

## Local Database Evidence

- Windows service: `pfc-postgresql-18`, `DEMAND_START`, retained in `RUNNING` state.
- Service PID at handoff: `40516`; PostgreSQL listener PID: `24620`.
- Listener readback: `TCP 127.0.0.1:5432 LISTENING`; no `0.0.0.0`, IPv6, firewall, or public listener was added.
- Connection readback: `pfc_local | pfc_app_local | 18.6 | 127.0.0.1 | 5432`.
- Physical data: `.local/postgres-data`; runtime alias: `%LOCALAPPDATA%\PFCPlatform` junction to the physical project root. The alias is required because `initdb` rejected the Chinese physical path during UTF-8 bootstrap.
- Local passwords and `.env.local` are stored only in ignored `.local/` or `.env.local` paths with current-user ACLs. Values were not printed or copied into this report.
- Stop command: elevated `sc.exe stop pfc-postgresql-18`. The service and alias must not be removed while the service is running.

## Dependency Review

- All top-level versions are exact; `package-lock.json` resolves HTTPS registry artifacts only from `registry.npmjs.org`.
- Runtime stack includes React `19.2.8`, Vite `8.2.2`, Fastify `5.12.1`, Kysely `0.29.5`, and pg `8.23.0`.
- Quality stack includes TypeScript `6.0.3`, Vitest `5.0.0`, ESLint `10.9.1`, Prettier `3.9.6`, and Playwright `1.62.1`.
- License inventory is limited to MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT-0, MPL-2.0, BlueOak-1.0.0, CC0-1.0, and CC-BY-4.0 in the installed tree.
- The only registry install-time script is `esbuild@0.28.2 postinstall: node install.js`; it was reviewed, executed, version-checked, and recorded as the pinned `allowScripts` entry. `npm install-scripts ls` reports no unreviewed scripts.
- Initial online `npm audit` returned 0 vulnerabilities for 365 dependency nodes. After adding stable Playwright, online audit refresh timed out twice at the npm advisory endpoint; bounded offline audit returned 0 for 368 nodes. A fresh post-Playwright online result remains unverified.

## Verification Results

| Check                      | Result         | Evidence                                                                                                                             |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TDD red                    | Expected fail  | 2 suites failed because T0 domain/API modules did not exist                                                                          |
| TDD green                  | PASS           | 2 files, 2 tests passed after the minimal bootstrap implementation                                                                   |
| Quick dry-run              | PASS           | Planned config, lint, format, typecheck, and unit commands; status `READY_TO_RUN`                                                    |
| Core dry-run               | PASS           | Quick plus build and local database check; status `READY_TO_RUN`                                                                     |
| Full dry-run               | Expected BLOCK | Missing PC E2E, permission, concurrency, recovery, security, and performance evidence                                                |
| `npm run test:gate:quick`  | PASS           | Config, ESLint, Prettier, TypeScript, and Vitest passed                                                                              |
| `npm run test:gate:core`   | PASS           | Quick, Fastify/Web production builds, and PostgreSQL readback passed                                                                 |
| `npm run test:gate:full`   | Expected BLOCK | `FULL_GATE_BLOCKED`; no empty implementation was reported as product quality PASS                                                    |
| Desktop render smoke       | PASS           | Edge, `1440x900`, nonblank page, correct identity/content, no horizontal overflow, 0 console errors/warnings, reload recovery PASS   |
| Candidate-file secret scan | PASS           | 44 candidate files; 0 findings for private keys, common tokens, or populated secret variables                                        |
| Process cleanup            | PASS           | Vite/API ports `5173`/`3001` clear; project Node process count 0; temporary browser script/logs and temporary installer copy removed |

Desktop screenshot evidence is retained outside the repository at `%TEMP%\pfc-t0-desktop-20260904.png`. It contains only the local T0 status screen.

## Rework And Residual Risk

- Execution window: approximately 78 minutes from initial target creation to evidence cutoff.
- Gate remediation: 3 quick iterations and 3 core iterations before final PASS. Causes were Node PATH leakage, Node globals/format/CSS typing, shared compile root, and generated artifact lint scope.
- Browser smoke remediation: 2 iterations for the temporary CommonJS runner and missing favicon.
- No product acceptance was performed. The page is only a T0 status surface and has no business controls.
- Full quality, CAP functional acceptance, one-workday observation, release readiness, and post-release smoke remain out of scope and BLOCKED.
- Project-level Node 22 is authorized as a fallback but was not installed because Node 24.20.0 passed the current dependency and gate checks.

## Git And External Effects

- Branch: `feat/cap-pfc-01-m1`; repository has no commit.
- Git remotes: none.
- All deliverable files remain untracked pending a separate commit authorization.
- No push, merge, deployment, external environment write, production/customer data, or public listener occurred.
