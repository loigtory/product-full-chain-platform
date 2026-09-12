(() => {
  const prefix = 'PFC_FLOW_DEMO_V1:';
  const stages = [
    'idea',
    'req',
    'design',
    'dev',
    'test',
    'accept',
    'release',
    'observe',
  ];
  const validId = (id) =>
    /^CODEx_TEST_FLOW_20260912_[A-Za-z0-9_-]{1,80}$/.test(id);
  function requirement(id, title) {
    return {
      id,
      title,
      goal: '在积分到期前提醒会员查看和使用积分',
      stage: 'idea',
      closed: false,
      materials: [
        {
          id: id + '-material',
          name: '积分提醒规则 · 合成材料',
          text: '样例：到期前 7 天发送站内提醒；无实际会员或消息发送。',
          version: 1,
        },
      ],
      versions: [],
      proposal: null,
      question: null,
      prepared: false,
      draft: '',
      messages: [],
      events: [],
      history: [],
      run: null,
      tests: null,
      acceptance: null,
      release: null,
      observation: null,
      impact: null,
      flags: { partial: false, testFailure: false, releaseFailure: false },
    };
  }
  function create(runId, returnHash = '#/home') {
    if (!validId(runId)) throw Error('仅允许 CODEx_TEST_ 合成演练编号');
    const first = requirement(runId + '-A', '会员积分到期提醒'),
      second = requirement(runId + '-B', '积分提醒 · 另一合成需求');
    return {
      schema: 1,
      source: 'simulation',
      runId,
      revision: 0,
      role: 'owner',
      selected: first.id,
      returnHash,
      reqs: [first, second],
      receipts: [],
      ui: {
        stage: 'idea',
        panel: 'canvas',
        tab: 'prototype',
        version: null,
        expanded: false,
      },
    };
  }
  function bundle(r, days = 7) {
    const prev = r.versions.at(-1),
      version = r.versions.length + 1,
      id = r.id + '-B' + version;
    return {
      id,
      version,
      source: 'simulation',
      complete: true,
      businessConfirmed: false,
      designApproved: false,
      prototype: {
        id: r.id + '-prototype-' + version,
        version,
        days,
        enabled: true,
      },
      prd: {
        id: r.id + '-prd-' + version,
        version,
        days,
        text:
          '在积分到期前 ' +
          days +
          ' 天通过站内消息提醒；重复处理同一到期批次只产生一条提醒。',
      },
      ac: {
        id: r.id + '-ac-' + version,
        version,
        days,
        items: [
          '提前 ' + days + ' 天产生提醒',
          '关闭提醒时不产生消息',
          '重复处理同一到期批次不重复发送',
        ],
      },
      design: prev
        ? structuredClone(prev.design)
        : {
            id: r.id + '-design-1',
            version: 1,
            text: '合成准备稿：到期筛选、提醒去重、站内消息适配；真实接口与执行需另行接入。',
          },
    };
  }
  window.PFCFlowData = { prefix, stages, validId, requirement, create, bundle };
})();
