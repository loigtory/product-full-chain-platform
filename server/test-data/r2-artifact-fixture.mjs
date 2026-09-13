import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const runId = 'CODEx_TEST_M2C_20260913_artifacts';
export const schema = 'codex_test_m2c_20260913_artifacts';
export function bundle(title = runId) {
  return {
    prototype: {
      representation: 'spec',
      spec: require('../src/domain/prototype-spec').template('form-table', {
        title,
      }),
    },
    prd: {
      title: title + '_PRD',
      fields: [{ name: '填写规则', value: '名称不能为空' }],
    },
    acceptance: {
      items: [
        {
          acId: 'AC1',
          ruleId: 'RULE1',
          scenario: '保存表单',
          precondition: '已打开表单',
          steps: ['不输入名称', '点击检查'],
          expected: '显示必填提示',
        },
      ],
    },
    rules: [{ ruleId: 'RULE1', fieldIndex: 0 }],
  };
}
export const scope = {
  goal: 'CODEx_TEST_验证',
  files: 'CODEx_TEST_合成模块',
  capabilityIds: [],
  validation: 'CODEx_TEST_单元和隔离接口',
  exit: 'CODEx_TEST_仅协议模拟',
  rollback: 'CODEx_TEST_停止并核验原运行',
};
export async function toRequirement(f, suffix = 'work') {
  let req = (
    await f.api(
      '/reqs',
      'POST',
      {
        name: f.runId + '_' + suffix,
        goal: 'CODEx_TEST_连续协作',
        ...f.command(),
      },
      'owner',
      201,
    )
  ).req;
  for (const q of req.questions)
    req = (
      await f.api(
        '/reqs/' + req.id + '/questions/' + q.id + '/answer',
        'POST',
        {
          answer: 'CODEx_TEST_回答',
          expectedRevision: req.revision,
          ...f.command(),
        },
      )
    ).req;
  const v = req.versions
    .filter((x) => x.stage === 'idea')
    .sort((a, b) => b.version - a.version)[0];
  req = (
    await f.api('/reqs/' + req.id + '/versions/' + v.id + '/confirm', 'POST', {
      expectedRevision: req.revision,
      ...f.command(),
    })
  ).req;
  return (
    await f.api('/reqs/' + req.id + '/stage', 'PATCH', {
      to: 'req',
      expectedRevision: req.revision,
      ...f.command(),
    })
  ).req;
}
export async function completeArtifacts(
  api,
  req,
  command,
  { stopAtDesign = false } = {},
) {
  const path = '/reqs/' + req.id;
  let w = await api(path + '/artifact-workspace');
  if (
    !w.currentGroup ||
    w.currentGroup.inputFingerprint !== w.inputFingerprint
  ) {
    const p = await api(
      path + '/artifact-proposals',
      'POST',
      {
        ...command(),
        expectedRevision: req.revision,
        baseGroupId: w.currentGroup?.id || null,
        inputFingerprint: w.inputFingerprint,
        inputMode: 'manual',
        changes: w.currentGroup
          ? {
              prototype: w.currentGroup.prototype.content,
              prd: w.currentGroup.prd.content,
              acceptance: w.currentGroup.acceptance.content,
              rules: w.currentGroup.rules,
            }
          : bundle(),
        sourceRefs: w.currentGroup?.inputs.explicitRefs || [],
      },
      'owner',
      201,
    );
    const result = await api(
      path + '/artifact-proposals/' + p.proposal.id + '/adopt',
      'POST',
      {
        ...command(),
        expectedRevision: p.req.revision,
        baselineGroupId: w.currentGroup?.id || null,
        inputFingerprint: p.proposal.inputFingerprint,
      },
    );
    req = result.req;
    w = await api(path + '/artifact-workspace');
  }
  if (req.stage === 'req')
    req = (
      await api(
        path + '/artifact-groups/' + w.currentGroup.id + '/confirm-business',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          inputFingerprint: w.inputFingerprint,
          comment: 'CODEx_TEST_业务确认',
          advanceTo: 'design',
        },
      )
    ).req;
  w = await api(path + '/artifact-workspace');
  if (req.stage === 'design' && !stopAtDesign)
    req = (
      await api(
        path + '/artifact-groups/' + w.currentGroup.id + '/confirm-design',
        'POST',
        {
          ...command(),
          expectedRevision: req.revision,
          designVersionId: req.versions
            .filter((x) => x.stage === 'design')
            .sort((a, b) => b.version - a.version)[0].id,
          scope,
          comment: 'CODEx_TEST_设计确认',
          advanceTo: 'dev',
        },
      )
    ).req;
  return req;
}
export async function fixture(options = {}) {
  return (await import('./m2c-governance-fixture.mjs')).fixture({
    ...options,
    artifacts: true,
  });
}
