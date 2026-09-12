const hashPattern = /^sha256:[a-f\d]{64}$/i;

export function createM2R2TestData(input: {
  runId: string;
  now?: string;
  repositoryFingerprint?: string;
  artifactContentHash?: string;
}) {
  const runId = input.runId.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_]{2,31}$/.test(runId)) {
    throw new Error('M2_R2_TEST_RUN_ID_INVALID');
  }
  const now = input.now ?? '2026-09-07T01:00:00.000Z';
  if (!Number.isFinite(Date.parse(now))) {
    throw new Error('M2_R2_TEST_TIME_INVALID');
  }
  const repositoryFingerprint =
    input.repositoryFingerprint ?? `sha256:${'a'.repeat(64)}`;
  const artifactContentHash =
    input.artifactContentHash ?? `sha256:${'b'.repeat(64)}`;
  if (
    !hashPattern.test(repositoryFingerprint) ||
    !hashPattern.test(artifactContentHash)
  ) {
    throw new Error('M2_R2_TEST_HASH_INVALID');
  }
  const prefix = `CODEx_TEST_M2_R2_${runId}`;
  const id = (suffix: string) => `${prefix}_${suffix}`;
  const artifactSourceRef =
    'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md';
  return {
    runId,
    now,
    requester: {
      id: id('REQUESTER'),
      loginName: `codex.m2.r2.${runId.toLowerCase()}.requester`,
      displayName: 'M2 R2 本地写入发起人',
      role: 'PRODUCT_MANAGER' as const,
    },
    approver: {
      id: id('APPROVER'),
      loginName: `codex.m2.r2.${runId.toLowerCase()}.approver`,
      displayName: 'M2 R2 本地审批人',
      role: 'TEAM_ADMIN' as const,
    },
    team: { id: id('TEAM'), name: `CODEx TEST M2 R2 ${runId}` },
    requirement: {
      id: id('REQUIREMENT'),
      name: 'CODEx_TEST_M2_R2 隔离写入与人工审批',
      originalIdea:
        '验证标准本地 PostgreSQL 中工作区写入的四眼审批、拒绝、取消与未知结果核验闭环。',
      currentStage: 'G8' as const,
    },
    baselineId: id('BASELINE'),
    baseline: {
      id: id('BASELINE'),
      versionNumber: 1,
      sourceType: 'INTERNAL_IMPROVEMENT' as const,
      materialPurpose: 'FACT' as const,
      sensitivity: 'INTERNAL' as const,
    },
    workspace: {
      id: id('WORKSPACE'),
      name: `CODEx TEST M2 R2 ${runId} 工作区`,
      repositoryLabel: 'product-full-chain',
      repositoryFingerprint: repositoryFingerprint.toLowerCase(),
      allowedRelativePath:
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01',
      accessLevel: 'WRITE' as const,
      status: 'ACTIVE' as const,
      verificationStatus: 'UNVERIFIED' as const,
    },
    artifact: {
      id: id('ARTIFACT'),
      versionId: id('ARTIFACT_VERSION'),
      capId: 'CAP-PFC-03',
      stage: 'G8' as const,
      artifactType: 'EVALUATION_REPORT',
      title: 'RDC 正式准入接入前向评估结论',
      status: 'ACTIVE' as const,
      versionLabel: '2026-09-07-r2',
      sourceType: 'WORKSPACE_RELATIVE' as const,
      sourceRef: artifactSourceRef,
      contentHash: artifactContentHash.toLowerCase(),
      sensitivity: 'INTERNAL' as const,
    },
    assignment: {
      responsibility: 'PRODUCT_OWNER',
      status: 'ACTIVE' as const,
    },
    evidence: {
      timelineId: id('TIMELINE'),
      outboxId: id('OUTBOX'),
      auditId: id('AUDIT'),
      requestId: id('REQUEST'),
    },
    run: {
      id: id('RUN'),
      executionInstanceId: id('EXECUTION'),
      capsuleId: id('CAPSULE'),
    },
    approval: { id: id('APPROVAL') },
    commands: {
      startId: id('COMMAND_START'),
      resolveId: id('COMMAND_RESOLVE'),
      interruptId: id('COMMAND_INTERRUPT'),
      verifyId: id('COMMAND_VERIFY'),
    },
    runScope: {
      allowedRelativePaths: [artifactSourceRef],
      allowedActions: ['EDIT_FILES'] as const,
      networkAccess: false as const,
      maxChangedFiles: 1,
      maxChangedBytes: 65_536,
    },
  } as const;
}
