import { createHash } from 'node:crypto';

import type { LifecycleKysely } from '@pfc/persistence';

function digest(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function createM2R3TestData(runId: string) {
  const normalized = runId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const schemaSuffix = runId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40);
  const prefix = `CODEx_TEST_M2R3_${normalized}`;
  const now = '2026-09-09T01:00:00.000Z';
  const contents = {
    first: '# 需求规格\n\n首个版本。\n',
    second: '# 需求规格\n\n第二个版本。\n\n- 新增验收标准\n',
  } as const;
  return {
    prefix,
    schemaName: `codex_test_m2r3_${schemaSuffix}`,
    now,
    accountId: `${prefix}_ACCOUNT`,
    teamId: `${prefix}_TEAM`,
    baselineId: `${prefix}_BASELINE`,
    materialRefId: `${prefix}_MATERIAL`,
    skillReleaseId: `${prefix}_SKILL_RELEASE`,
    bridgeId: `${prefix}_BRIDGE`,
    workspaceId: `${prefix}_WORKSPACE`,
    sessionId: `${prefix}_SESSION`,
    turnId: `${prefix}_TURN`,
    capabilityId: `${prefix}_MCP_CAPABILITY`,
    mcpRequestId: `${prefix}_MCP_REQUEST`,
    evidenceId: `${prefix}_EVIDENCE`,
    mcpCommandId: `${prefix}_MCP_COMMAND`,
    requirementIds: [`${prefix}_REQ_1`, `${prefix}_REQ_2`] as const,
    artifactId: `${prefix}_ARTIFACT`,
    versionIds: [`${prefix}_VERSION_1`, `${prefix}_VERSION_2`] as const,
    reviewId: `${prefix}_REVIEW_1`,
    subjectIds: {
      requirement: `${prefix}_SUBJECT_REQ`,
      specVersion: `${prefix}_SUBJECT_SPEC`,
      unit: `${prefix}_SUBJECT_UNIT`,
      otherRequirement: `${prefix}_SUBJECT_OTHER_REQ`,
    },
    traceLinkId: `${prefix}_TRACE_1`,
    contents,
    hashes: {
      first: digest(contents.first),
      second: digest(contents.second),
      schema: digest('{"type":"object"}'),
      config: digest('local-tools/inspect_schema'),
      input: digest('{"query":"metadata"}'),
    },
    async seedR3bPrerequisites(database: LifecycleKysely): Promise<void> {
      const db = database.withSchema(`codex_test_m2r3_${schemaSuffix}`);
      const accountId = `${prefix}_ACCOUNT`;
      const teamId = `${prefix}_TEAM`;
      const requirementId = `${prefix}_REQ_1`;
      const baselineId = `${prefix}_BASELINE`;
      const materialRefId = `${prefix}_MATERIAL`;
      const artifactId = `${prefix}_ARTIFACT`;
      const versionId = `${prefix}_VERSION_1`;
      const skillReleaseId = `${prefix}_SKILL_RELEASE`;
      const bridgeId = `${prefix}_BRIDGE`;
      const workspaceId = `${prefix}_WORKSPACE`;
      const sessionId = `${prefix}_SESSION`;
      const turnId = `${prefix}_TURN`;
      await db
        .insertInto('accounts')
        .values({
          id: accountId,
          login_name: `codex.m2r3.${schemaSuffix}`,
          display_name: '陈立',
          password_hash: 'CODEx_TEST_HASH',
          password_salt: 'CODEx_TEST_SALT',
          status: 'ACTIVE',
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('teams')
        .values({
          id: teamId,
          name: `CODEx TEST M2R3 ${normalized}`,
          status: 'ACTIVE',
          owner_account_id: accountId,
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('team_memberships')
        .values({
          team_id: teamId,
          account_id: accountId,
          role: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          joined_at: now,
          created_at: now,
        })
        .execute();
      await db
        .insertInto('requirements')
        .values({
          id: requirementId,
          name: 'M2 R3 MCP 本地只读验证',
          original_idea: '使用合成元数据验证 MCP 只读证据链。',
          initiator_id: accountId,
          business_owner_id: accountId,
          current_stage: 'G3',
          current_baseline_id: null,
          row_version: 0,
          draft_source_type: null,
          draft_source_description: null,
          draft_material_purpose: null,
          draft_sensitivity: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('requirement_assignments')
        .values({
          requirement_id: requirementId,
          team_id: teamId,
          account_id: accountId,
          responsibility: 'PRODUCT_OWNER',
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('material_baselines')
        .values({
          id: baselineId,
          requirement_id: requirementId,
          version_number: 1,
          status: 'CURRENT',
          source_type: 'INTERNAL_IMPROVEMENT',
          source_description: null,
          material_purpose: 'FACT',
          sensitivity: 'INTERNAL',
          confirmed_by: accountId,
          confirmed_at: now,
          created_at: now,
        })
        .execute();
      await db
        .updateTable('requirements')
        .set({ current_baseline_id: baselineId })
        .where('id', '=', requirementId)
        .execute();
      await db
        .insertInto('material_refs')
        .values({
          id: materialRefId,
          baseline_id: baselineId,
          reference_type: 'SYNTHETIC_TEXT',
          source: 'CODEx_TEST public metadata only',
          version: '1',
          content_hash: digest('CODEx_TEST public metadata only'),
          location: 'synthetic://m2r3/material',
          sensitivity: 'INTERNAL',
          validity: 'VALID',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('artifacts')
        .values({
          id: artifactId,
          requirement_id: requirementId,
          cap_id: 'CAP-PFC-03',
          stage: 'G3',
          artifact_type: 'MCP_EVIDENCE_SPEC',
          title: 'MCP 只读证据规格',
          status: 'ACTIVE',
          current_version_id: null,
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('artifact_versions')
        .values({
          id: versionId,
          artifact_id: artifactId,
          version_label: 'V0.1',
          source_type: 'CONTROLLED_REFERENCE',
          source_ref: 'synthetic://m2r3/mcp-evidence-spec',
          content_hash: digest(contents.first),
          sensitivity: 'INTERNAL',
          created_by: accountId,
          created_at: now,
        })
        .execute();
      await db
        .updateTable('artifacts')
        .set({ current_version_id: versionId })
        .where('id', '=', artifactId)
        .execute();
      await db
        .insertInto('skill_releases')
        .values({
          id: skillReleaseId,
          skill_key: 'pfc-ai-product-work-session',
          display_name: 'AI 产品作业会话',
          description: 'CODEx_TEST deterministic Skill.',
          source_type: 'LOCAL_ALLOWLIST',
          logical_source: 'project-skill:pfc-ai-product-work-session',
          version: '2026.09.09-r3',
          content_hash: digest('CODEx_TEST skill'),
          license: null,
          compatible_harnesses: JSON.stringify(['codex-app-server/0.153']),
          required_capabilities: JSON.stringify(['PRODUCT_WORK_TURN']),
          risk_level: 'LOW',
          owner: '陈立',
          evaluation_status: 'PASSED',
          enabled_scopes: JSON.stringify(['PRODUCT_WORK_TURN']),
          context_cost: null,
          status: 'ACTIVE',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('bridge_registrations')
        .values({
          id: bridgeId,
          team_id: teamId,
          credential_digest: digest('CODEx_TEST bridge credential'),
          protocol_version: 'pfc-bridge/1',
          bridge_version: '0.1.0',
          node_version: '24.20.0',
          codex_version: '0.153.4',
          zed_version: null,
          status: 'ONLINE',
          last_heartbeat_at: now,
          revoked_at: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('workspaces')
        .values({
          id: workspaceId,
          team_id: teamId,
          name: 'CODEx TEST M2 R3 Workspace',
          repository_label: 'product-full-chain-platform',
          repository_fingerprint: digest('CODEx_TEST M2R3 repository'),
          status: 'ACTIVE',
          verification_status: 'VERIFIED',
          row_version: 0,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await db
        .insertInto('requirement_workspaces')
        .values({
          requirement_id: requirementId,
          team_id: teamId,
          workspace_id: workspaceId,
          allowed_relative_path: 'synthetic/m2r3',
          access_level: 'READ',
          created_at: now,
        })
        .execute();
      await db
        .insertInto('bridge_workspace_bindings')
        .values({
          bridge_id: bridgeId,
          workspace_id: workspaceId,
          repository_fingerprint: digest('CODEx_TEST M2R3 repository'),
          allowed_relative_path: 'synthetic/m2r3',
          verification_status: 'VERIFIED',
          current_git_baseline: 'd'.repeat(64),
          verified_at: now,
          created_at: now,
        })
        .execute();
      await db
        .insertInto('bridge_capability_snapshots')
        .values({
          id: `${prefix}_BRIDGE_CAPABILITY`,
          bridge_id: bridgeId,
          capabilities: {
            snapshotVersion: 'pfc-bridge-capabilities/2',
            capturedAt: now,
            runtime: {
              nodeVersion: '24.20.0',
              codexAppServer: 'AVAILABLE',
              zedCli: 'UNVERIFIED',
            },
            workspaces: [{ workspaceId, gitBaseline: 'd'.repeat(64) }],
            skills: [
              {
                releaseId: skillReleaseId,
                contentHash: digest('CODEx_TEST skill'),
              },
            ],
            productWorkTurn: {
              state: 'AVAILABLE',
              protocolVersion: 'product-work-turn/1',
            },
            mcp: {
              state: 'AVAILABLE',
              configFingerprint: digest('local-tools/inspect_schema'),
              servers: [
                {
                  name: 'local-tools',
                  runtimeStatus: 'CONNECTED',
                  authStatus: 'UNSUPPORTED',
                  tools: [
                    {
                      name: 'inspect_schema',
                      inputSchemaHash: digest('{"type":"object"}'),
                      readOnlyHint: true,
                    },
                  ],
                },
              ],
            },
          },
          captured_at: now,
          expires_at: new Date(Date.parse(now) + 60 * 60_000).toISOString(),
        })
        .execute();
      await db
        .insertInto('product_work_sessions')
        .values({
          id: sessionId,
          team_id: teamId,
          requirement_id: requirementId,
          opened_requirement_version: 0,
          current_requirement_version: 0,
          opened_baseline_id: baselineId,
          opened_stage: 'G3',
          status: 'ACTIVE',
          control_surface: 'WEB',
          active_turn_id: null,
          last_sequence: 0,
          owner_id: accountId,
          title: 'CODEx_TEST M2 R3 MCP',
          block_reason: null,
          row_version: 0,
          created_by: accountId,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await db
        .insertInto('product_work_turns')
        .values({
          id: turnId,
          session_id: sessionId,
          sequence: 1,
          intent_kind: 'READ_MCP',
          input_text: '查询本地公开元数据。',
          visible_response: null,
          status: 'WAITING_INPUT',
          skill_release_id: skillReleaseId,
          bridge_id: bridgeId,
          external_thread_id: null,
          external_turn_id: null,
          usage_summary: null,
          failure_reason: null,
          recovery_action: null,
          content_retention_until: null,
          redacted_at: null,
          row_version: 0,
          created_by: accountId,
          created_at: now,
          updated_at: now,
          terminal_at: null,
        })
        .execute();
      await db
        .updateTable('product_work_sessions')
        .set({ active_turn_id: turnId })
        .where('id', '=', sessionId)
        .execute();
    },
  } as const;
}
