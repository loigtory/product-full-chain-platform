import { fixture as base } from './r3-verification-fixture.mjs';
export const schema = 'codex_test_m2c_20260913_release';
export const runId = 'CODEx_TEST_M2C_20260913_release';
export function planData(
  evidence = [],
  owner = 'CODEx_TEST_owner',
  now = Date.now(),
) {
  return {
    target: 'CODEx_TEST_local',
    scope: 'CODEx_TEST_名称必填校验',
    versionRef: 'CODEx_TEST_build_1',
    releaseOwner: owner,
    dependencies: '无',
    risks: '无',
    monitoring: 'CODEx_TEST_本地合成指标',
    alertOwner: owner,
    rollback: {
      target: 'CODEx_TEST_build_0',
      steps: 'CODEx_TEST_恢复前一版本',
      trigger: 'CODEx_TEST_冒烟失败',
    },
    hours: 1,
    smoke: [{ checkId: 'SMOKE_1', title: 'CODEx_TEST_名称不能为空' }],
    metrics: [
      {
        metricId: 'METRIC_1',
        name: 'CODEx_TEST_校验成功率',
        target: '100',
        unit: '%',
        source: 'CODEx_TEST_合成日志',
        sampling: 'CODEx_TEST_窗口末端',
        owner,
        baseline: '0',
      },
    ],
    authorization: {
      id: 'CODEx_TEST_AUTH',
      target: 'CODEx_TEST_local',
      versionRef: 'CODEx_TEST_build_1',
      scope: 'CODEx_TEST_名称必填校验',
      actions: ['DEPLOY', 'ROLLBACK'],
      from: new Date(now - 86400000).toISOString(),
      until: new Date(now + 86400000).toISOString(),
      actor: owner,
      evidence,
    },
    evidence,
    source: 'USER_REPORTED',
  };
}
export function resultData(evidence = [], now = Date.now()) {
  return {
    source: 'USER_REPORTED',
    target: 'CODEx_TEST_local',
    versionRef: 'CODEx_TEST_build_1',
    status: 'SUCCESS',
    startedAt: new Date(now - 3 * 3600000).toISOString(),
    endedAt: new Date(now - 2 * 3600000).toISOString(),
    checkedAt: new Date(now).toISOString(),
    actual: 'CODEx_TEST_成员登记，平台未执行',
    evidence,
    smoke: [
      { checkId: 'SMOKE_1', status: 'PASS', actual: 'CODEx_TEST_提示必填' },
    ],
    previousRecordId: null,
  };
}
export async function fixture(options = {}) {
  const f = await base({ ...options, release: true });
  if (f.schema !== schema) {
    await f.cleanup();
    throw Error('TEST_TARGET_MISMATCH');
  }
  const accepted = async (suffix = 'release') => {
    const item = await f.prepare(suffix),
      batch = await f.batch(item);
    await f.write(
      item.id,
      '/test-batches/' + batch.id + '/results',
      {
        results: item.cases.map((c) => ({
          ...f.result(item),
          caseId: c.caseId,
        })),
      },
      201,
    );
    await f.write(item.id, '/test-batches/' + batch.id + '/complete', {});
    await f.write(
      item.id,
      '/product-acceptances',
      {
        baselineId: item.delivery.id,
        batchId: batch.id,
        decision: 'ACCEPTED',
        checks: { functionality: true, exceptions: true, evidence: true },
        comment: 'CODEx_TEST_本地合成验收',
        risks: '无',
      },
      201,
    );
    return item;
  };
  const plan = async (item) =>
    (
      await f.write(
        item.id,
        '/release-plans',
        planData([item.evidence], runId + '_owner'),
        201,
      )
    ).plan;
  const approve = async (item, p) => {
    await f.write(item.id, '/releases', { planId: p.id }, 201);
    return f.api('/releases/' + p.id + '/approve', 'POST', {
      ...f.command(),
      expectedRevision: (await f.refresh(item.id)).revision,
      comment: 'CODEx_TEST_只批准准备记录',
    });
  };
  // Valid historical chain first, then change only the original Owner's access.
  const recovery = async (suffix, disabled = false) => {
    await f.login('owner2');
    const item = await accepted(suffix),
      p = await plan(item);
    await approve(item, p);
    const original = resultData([item.evidence]);
    const unknown = (
      await f.write(
        item.id,
        '/releases/' + p.id + '/reported-results',
        {
          ...original,
          status: 'UNKNOWN',
          endedAt: null,
          locator: 'CODEx_TEST_原尝试待核实',
          responsible: runId + '_owner',
        },
        201,
      )
    ).record;
    const member = (await f.api('/members')).items.find(
      (m) => m.name === runId + '_owner',
    );
    const changed = await f.api(
      '/members/' + member.id + (disabled ? '' : '/role'),
      disabled ? 'DELETE' : 'PATCH',
      {
        ...f.command(),
        expectedRevision: member.revision,
        ...(disabled ? {} : { role: 'viewer' }),
      },
      'owner2',
    );
    const read = (path) => f.api(path, 'GET', undefined, 'owner2');
    const write = async (
      path,
      body,
      status = 200,
      who = 'owner2',
      global = false,
    ) =>
      f.api(
        global ? path : '/reqs/' + item.id + path,
        'POST',
        {
          ...body,
          ...f.command(),
          expectedRevision: (await read('/reqs/' + item.id)).req.revision,
        },
        who,
        status,
      );
    const review = (status = 200, who = 'owner2') =>
      write(
        '/releases/' + p.id + '/approve',
        {
          comment: 'CODEx_TEST_现任Owner核对冻结验收与原尝试',
        },
        status,
        who,
        true,
      );
    const restore = () =>
      disabled
        ? f.admin.query(
            `UPDATE "${schema}".members SET active=true,disabled_at=NULL,revision=revision+1 WHERE public_id=$1 AND name=$2 AND NOT active`,
            [member.id, runId + '_owner'],
          )
        : f.api(
            '/members/' + member.id + '/role',
            'PATCH',
            {
              role: 'owner',
              expectedRevision: changed.member.revision,
              ...f.command(),
            },
            'owner2',
          );
    return {
      item,
      plan: p,
      original,
      unknown,
      member,
      read,
      write,
      review,
      restore,
    };
  };
  return { ...f, accepted, plan, approve, recovery };
}
