---
name: pfc-readonly-artifact-check
description: Inspect a product requirement's workspace artifacts and evidence chain without modifying files or invoking external systems.
---

# Read-Only Artifact Check

Inspect the current workspace for the registered product requirement's artifacts and evidence. Work only inside the provided workspace and treat the checked-out Git baseline as fixed.

## Boundaries

- Read files and Git metadata only. Do not create, edit, delete, format, commit, or stage files.
- Do not access parent directories, unrelated repositories, network services, MCP servers, databases, credentials, environment values, or customer data.
- Do not run commands that install software, start services, execute project code, or produce external side effects.
- Stop with `BLOCKED` when the requirement, baseline, artifact location, or evidence cannot be established from workspace content. Do not infer missing business facts.
- Report only workspace-relative paths. Redact any credential-like or personal value encountered accidentally.

## Check

1. Locate the requirement and its current approved baseline from repository-owned documentation or machine-readable delivery records.
2. Identify the artifacts claimed for that baseline and verify that each referenced workspace-relative file exists.
3. Check whether the artifacts state their requirement or CAP identity, version or baseline, lifecycle stage, owner, and verification or acceptance evidence where applicable.
4. Compare cross-file identifiers and versions. Record contradictions, stale references, missing evidence, and paths that leave the workspace.
5. Do not judge business acceptance. Distinguish structural presence from executed test evidence and explicit human acceptance.

## Output

Return a concise report with:

- `status`: `PASS`, `WARN`, or `BLOCKED`;
- `baseline`: the verified Git and requirement baseline identifiers;
- `checked`: workspace-relative files actually inspected;
- `findings`: severity, evidence path and line when available, and the concrete impact;
- `evidenceGaps`: missing or unverifiable evidence;
- `summary`: one short conclusion that does not overstate integration, acceptance, release, or external effect.
