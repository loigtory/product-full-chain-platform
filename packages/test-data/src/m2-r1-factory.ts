export function createM2R1TestData(runId: string) {
  const suffix = runId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const id = (name: string) => `CODEx_TEST_M2_${suffix}_${name}`;
  const now = '2026-09-06T03:00:00.000Z';
  return {
    now,
    accountId: id('ACCOUNT'),
    teamId: id('TEAM'),
    requirementId: id('REQUIREMENT'),
    baselineId: id('BASELINE'),
    workspaceId: id('WORKSPACE'),
    artifactId: id('ARTIFACT'),
    artifactVersionId: id('ARTIFACT_VERSION'),
    skillReleaseId: id('SKILL_RELEASE'),
    bridgeId: id('BRIDGE'),
    capabilitySnapshotId: id('CAPABILITY'),
    runId: id('RUN'),
    eventIds: [id('EVENT_1'), id('EVENT_2'), id('EVENT_3')],
    sourceEventIds: [id('SOURCE_EVENT_1'), id('SOURCE_EVENT_2')],
    commandId: id('COMMAND'),
    gitBaseline: '0123456789abcdef0123456789abcdef01234567',
    artifact: {
      sourceRef: 'docs/requirements/requirement.md',
      contentHash:
        'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    },
    skill: {
      key: 'pfc-readonly-artifact-check',
      version: '2026.09.06-r1',
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
  } as const;
}
