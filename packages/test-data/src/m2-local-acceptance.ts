const hashPattern = /^sha256:[a-f\d]{64}$/i;

export function createM2LocalAcceptanceData(input: {
  runId: string;
  now: string;
  repositoryFingerprint: string;
  artifactContentHash: string;
}) {
  const runId = input.runId.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_]{2,39}$/.test(runId)) {
    throw new Error('M2_ACCEPTANCE_RUN_ID_INVALID');
  }
  if (
    !hashPattern.test(input.repositoryFingerprint) ||
    !hashPattern.test(input.artifactContentHash)
  ) {
    throw new Error('M2_ACCEPTANCE_HASH_INVALID');
  }
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error('M2_ACCEPTANCE_TIME_INVALID');
  }
  const prefix = `CODEx_TEST_M2_${runId}`;
  const id = (suffix: string) => `${prefix}_${suffix}`;
  return {
    runId,
    account: {
      id: id('ACCOUNT'),
      loginName: `codex.m2.${runId.toLowerCase().replaceAll('_', '-')}`,
      displayName: 'M2 R1 本地验收管理员',
    },
    team: {
      id: id('TEAM'),
      name: 'CODEx TEST M2 本地验收团队',
    },
    requirement: {
      id: id('REQUIREMENT'),
      name: 'CODEx_TEST_M2_R1 真实只读产物检查',
      originalIdea:
        '验证标准 PostgreSQL、Bridge 和 Codex 对已落地 RDC 前向评估报告的只读检查闭环。',
      currentStage: 'G8' as const,
    },
    baseline: {
      id: id('BASELINE'),
      versionNumber: 1,
      sourceType: 'INTERNAL_IMPROVEMENT' as const,
      materialPurpose: 'FACT' as const,
      sensitivity: 'INTERNAL' as const,
    },
    workspace: {
      id: id('WORKSPACE'),
      name: 'CODEx TEST 产品全链路方法仓库',
      repositoryLabel: 'product-full-chain',
      repositoryFingerprint: input.repositoryFingerprint.toLowerCase(),
      status: 'ACTIVE' as const,
      verificationStatus: 'UNVERIFIED' as const,
    },
    assignment: {
      responsibility: 'PRODUCT_OWNER',
      status: 'ACTIVE' as const,
    },
    requirementWorkspace: {
      allowedRelativePath:
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01',
      accessLevel: 'READ' as const,
    },
    artifact: {
      id: id('ARTIFACT'),
      capId: 'CAP-PFC-03',
      stage: 'G8' as const,
      artifactType: 'EVALUATION_REPORT',
      title: 'RDC 正式准入接入前向评估结论',
      status: 'ACTIVE' as const,
    },
    artifactVersion: {
      id: id('ARTIFACT_VERSION'),
      versionLabel: '2026-09-06-r1',
      sourceType: 'WORKSPACE_RELATIVE' as const,
      sourceRef:
        'evals/runs/2026-08-27-rdc-prd-gateway-integration-v01/evaluation.md',
      contentHash: input.artifactContentHash.toLowerCase(),
      sensitivity: 'INTERNAL' as const,
    },
    evidence: {
      timelineId: id('TIMELINE'),
      outboxId: id('OUTBOX'),
      auditId: id('AUDIT'),
      requestId: id('REQUEST'),
    },
    now: input.now,
  } as const;
}
