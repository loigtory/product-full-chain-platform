import { fixture as base } from './m2c-governance-fixture.mjs';
export {
  bundle,
  completeArtifacts,
  toRequirement,
} from './r2-artifact-fixture.mjs';
export const schema = 'codex_test_m2c_20260913_verification';
export const runId = 'CODEx_TEST_M2C_20260913_verification';
export async function fixture(options = {}) {
  if (
    process.env.PFC_R3_EVIDENCE_DIR &&
    process.env.PFC_R3_EVIDENCE_DIR !==
      'docs/quality-gate/reports/m2c-4-release-observation-20260913'
  )
    throw Error('R3_EVIDENCE_TARGET_NOT_AUTHORIZED');
  const f = await base({ ...options, artifacts: true, testing: true });
  if (
    !options.release &&
    (f.schema !== schema || f.runId !== 'CODEx_TEST_M2C_20260913_verification')
  ) {
    await f.cleanup();
    throw Error('TEST_TARGET_MISMATCH');
  }
  const runId = f.runId;
  const refresh = async (id) => (await f.api('/reqs/' + id)).req;
  const write = async (id, path, body, status = 200, who = 'owner') =>
    f.api(
      '/reqs/' + id + path,
      'POST',
      {
        ...body,
        ...f.command(),
        expectedRevision: (await refresh(id)).revision,
      },
      who,
      status,
    );
  const upload = async (id) => {
    const bytes = Buffer.from(runId + ' 人工测试合成证据；不是实际业务验收');
    const r = await write(
      id,
      '/materials',
      {
        name: runId + '.txt',
        usage: 'attachment',
        allowed: true,
        file: {
          name: runId + '.txt',
          mimeType: 'text/plain',
          encoding: 'base64',
          content: bytes.toString('base64'),
        },
      },
      201,
    );
    return { id: r.material.id, version: r.material.version };
  };
  const saveDev = async (id, label = '实现必填校验') => {
    const req = await refresh(id),
      v = req.versions
        .filter((v) => v.stage === 'dev')
        .sort((a, b) => b.version - a.version)[0];
    return write(
      id,
      '/versions',
      {
        stage: 'dev',
        baseVersionId: v.id,
        content: {
          title: 'CODEx_TEST_开发交付',
          fields: [
            { name: '实施说明', value: 'CODEx_TEST_' + label },
            { name: '范围', value: '合成表单名称验证' },
          ],
        },
      },
      201,
    );
  };
  const prepare = async (suffix = 'ready', { handoff = true } = {}) => {
    const project = (
      await f.api(
        '/projects',
        'POST',
        {
          ...f.command(),
          name: runId + '_' + suffix,
          path: 'D:/CODEx_TEST_/verification',
          branch: 'CODEx_TEST_branch',
          source: 'existing',
          tech: ['JS'],
        },
        'owner',
        201,
      )
    ).project;
    let req = await f.readyRequirement({
      projectId: project.id,
      name: runId + '_' + suffix,
    });
    f.createdIds.push(req.id, project.id);
    const id = req.id,
      evidence = await upload(id);
    await saveDev(id);
    const group = (await f.api('/reqs/' + id + '/artifact-workspace'))
      .currentGroup;
    const draft = await write(
      id,
      '/test-suites',
      { baseGroupId: group.id, fromAcceptance: true },
      201,
    );
    const cases = draft.suite.cases.map((c) => ({
      ...c,
      dataPolicy: 'CODEx_TEST_空名称与普通名称',
      owner: runId + '_executor',
    }));
    const saved = await write(
      id,
      '/test-suites',
      { baseGroupId: group.id, baseSuiteId: draft.suite.id, cases },
      201,
    );
    await write(id, '/test-suites/' + saved.suite.id + '/adopt', {
      baseGroupId: group.id,
      currentSuiteId: null,
    });
    const deliveryBody = async () => ({
      devVersionId: (await refresh(id)).versions
        .filter((v) => v.stage === 'dev')
        .sort((a, b) => b.version - a.version)[0].id,
      versionRef: 'CODEx_TEST_build_1',
      changes: 'CODEx_TEST_实现必填校验',
      implementation: 'CODEx_TEST_本地合成实现说明',
      rollback: 'CODEx_TEST_回到前一版本',
      unimplemented: '无',
      evidence: [evidence],
    });
    const handoffNow = async () =>
      write(id, '/delivery-baselines', await deliveryBody(), 201);
    const delivery = handoff ? (await handoffNow()).delivery : null;
    req = await refresh(id);
    return {
      id,
      req,
      project,
      group,
      draft,
      suite: saved.suite,
      cases,
      evidence,
      delivery,
      deliveryBody,
      handoff: handoffNow,
    };
  };
  const batch = async (item) => {
    const req = await refresh(item.id),
      deliveryId = req.verification.currentDelivery.id;
    return (
      await write(
        item.id,
        '/test-batches',
        {
          baselineId: deliveryId,
          environment: 'CODEx_TEST_隔离本地环境',
          source: 'USER_REPORTED',
        },
        201,
      )
    ).batch;
  };
  const result = (
    item,
    status = 'PASS',
    sequence = 1,
    previousResultId = null,
  ) => ({
    caseId: item.cases[0].caseId,
    status,
    sequence,
    previousResultId,
    actual: runId + '名称留空时提示必填',
    reason:
      status === 'BLOCKED' || status === 'NOT_RUN' ? 'CODEx_TEST_等待' : '',
    executedAt: '2026-09-13T01:00:00Z',
    source: 'USER_REPORTED',
    evidence: [item.evidence],
  });
  return { ...f, refresh, write, upload, saveDev, prepare, batch, result };
}
