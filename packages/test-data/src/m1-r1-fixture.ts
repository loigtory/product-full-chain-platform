export function createM1R1Fixture(runId: string) {
  const prefix = `CODEx_TEST_M1_R1_${runId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const now = '2026-09-06T02:00:00.000Z';
  return {
    now,
    account: {
      id: `${prefix}_ACCOUNT`,
      loginName: `codex.${runId.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      displayName: `${prefix} 产品负责人`,
      passwordHash: 'synthetic-password-hash',
      passwordSalt: 'synthetic-password-salt',
    },
    team: {
      id: `${prefix}_TEAM`,
      name: `${prefix} 产品团队`,
    },
    requirement: {
      id: `${prefix}_REQ`,
      name: `${prefix} 本地持久化需求`,
      originalIdea: 'Synthetic local-only M1 requirement.',
    },
    workspace: {
      id: `${prefix}_WORKSPACE`,
      name: `${prefix} 工作区`,
      repositoryLabel: 'product-full-chain-platform',
      repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
      allowedRelativePath: 'docs/requirements',
    },
    artifact: {
      id: `${prefix}_ARTIFACT`,
      versionIds: [`${prefix}_VERSION_1`, `${prefix}_VERSION_2`],
    },
    requestIds: {
      createArtifact: `${prefix}_REQUEST_CREATE`,
      appendVersion: `${prefix}_REQUEST_APPEND`,
    },
  } as const;
}
