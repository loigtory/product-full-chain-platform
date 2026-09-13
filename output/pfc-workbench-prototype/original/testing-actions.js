(() => {
  'use strict';
  const P = window.PFC,
    A = P.verificationClient,
    V = P.testingView,
    e = (v) => P.esc(v),
    b = (...v) => P.btn(...v);
  const X = (P.testingActions = {});
  let form = null,
    comparison = null;
  X.current = () => {
    const q = P.r();
    P.assert(q && A.states[q.id], '请先读取当前测试工作区');
    return q;
  };
  const w = () => A.states[X.current().id];
  X.values = () => {
    const root = document.querySelector('#modal-root form');
    P.assert(root, '请重新打开登记窗口');
    const values = Object.fromEntries(
      [...new FormData(root)].filter(([, v]) => typeof v === 'string'),
    );
    for (const name of new Set(
      [...root.querySelectorAll('[type="checkbox"]')].map((x) => x.name),
    ))
      values[name] = [...root.querySelectorAll('[type="checkbox"]')]
        .filter((x) => x.name === name && x.checked)
        .map((x) => x.value);
    return values;
  };
  X.remember = () => {
    if (
      !form ||
      form.identity !== A.key(form.id) ||
      !document.querySelector('#modal-root form [name]')
    )
      return;
    const d = A.draft(form.id);
    d.forms = {
      ...d.forms,
      [form.key]: { values: X.values(), meta: form.meta, proofs: form.proofs },
    };
    A.save(form.id, d);
  };
  X.meta = () => {
    P.assert(
      form && form.id === P.r()?.id && form.identity === A.key(form.id),
      '需求或身份已切换，请重新打开',
    );
    return form.meta;
  };
  X.open = (key, title, body, footer = '', meta = {}) => {
    const q = X.current();
    P.modal(
      title,
      '<form>' + body + '</form>',
      footer +
        (footer && key !== 'compare' && key !== 'editor'
          ? b('r3-check-current', '核对最新依据')
          : '') +
        b('close-modal', '关闭'),
      true,
    );
    const saved = document.querySelector('#modal-root form [name]')
      ? A.draft(q.id).forms?.[key]
      : null;
    form = {
      id: q.id,
      key,
      title,
      body,
      footer,
      identity: A.key(q.id),
      meta: saved?.meta || { expectedRevision: q.revision, ...meta },
      proofs:
        saved?.proofs ||
        Object.fromEntries(q.attachments.map((a) => [a.id, a.version])),
    };
    A.activeForm = { reqId: q.id, key };
    for (const input of document.querySelectorAll('#modal-root [name]')) {
      const value = saved?.values?.[input.name];
      if (value === undefined || input.type === 'file') continue;
      if (input.type === 'checkbox')
        input.checked = Array.isArray(value) && value.includes(input.value);
      else input.value = value;
    }
  };
  X.finish = (id) => {
    if (form?.id === id) {
      form = null;
      A.activeForm = null;
      P.close();
    }
    P.render();
  };
  X.submit = async (path, input) => {
    const q = X.current();
    X.remember();
    const r = await A.write(q.id, path, {
      expectedRevision:
        form?.id === q.id ? X.meta().expectedRevision : q.revision,
      ...input,
    });
    X.finish(q.id);
    if (r.nextStage && P.r()?.id === q.id) {
      delete A.tabs[q.id];
      P.go({ stage: r.nextStage, artifactStage: null, version: null });
    }
    return r;
  };
  X.read = async (path) => {
    const q = X.current(),
      key = A.key(q.id),
      value = await A.request(q.id, path);
    P.assert(
      P.r()?.id === q.id && key === A.key(q.id),
      '需求或身份已切换，请重新打开',
    );
    return value;
  };
  X.evidence = (values) =>
    (values || []).map((id) => {
      const a = X.current().attachments.find((a) => a.id === id);
      P.assert(a, '附件已变化，请重新选择');
      P.assert(
        form?.proofs[id] === a.version,
        '附件版本已变化，请先核对最新依据并重新选择证据',
      );
      return { id, version: a.version };
    });
  const parse = (value, label) => {
    P.assert(
      new TextEncoder().encode(value).length <= 524288,
      label + '超过512 KiB',
    );
    try {
      return JSON.parse(value);
    } catch {
      throw Error(label + '格式不正确，原输入已保留');
    }
  };
  X.editor = (suite) => {
    const draft = A.draft(X.current().id).forms?.editor?.values?.cases;
    X.open(
      'editor',
      '完善测试套件',
      '<p>用例均为必测。保持稳定编号，补齐边界、数据策略和负责人；保存后需另行采用。</p>' +
        P.field('title', '套件名称', suite.title || '测试套件') +
        P.field(
          'cases',
          '用例内容（受约束 JSON）',
          draft || JSON.stringify(suite.cases, null, 2),
          'textarea',
        ) +
        P.select(
          'editIndex',
          '选择逐项编辑的用例',
          suite.cases.map((c, i) => [String(i), c.caseId + ' ' + c.title]),
          '0',
        ) +
        '<p>可逐项编辑，也可导入已整理的 JSON。旧测试结果不会复制到新套件。</p>',
      b('r3-suite-save', '保存套件草稿', {}, 'primary') +
        b('r3-case-edit', '编辑所选用例') +
        b('r3-case-edit', '增加用例', { index: suite.cases.length }) +
        b('r3-suite-import', '导入 JSON') +
        b('r3-suite-export', '导出 JSON') +
        b('r3-suite-compare', '比较当前采用版本'),
      {
        baseGroupId: w().groupId,
        baseSuiteId: suite.id,
        expectedRevision: X.current().revision,
      },
    );
  };
  X.suite = async () => {
    const s = w().currentSuite;
    if (!s?.casesPartial) return s;
    return (await X.read('/test-suites/' + s.id)).suite;
  };
  X.batch = async (id, offset = 0) => {
    const data = await X.read('/test-batches/' + id + '?offset=' + offset),
      cases = (await X.suite())?.cases || [];
    let body =
      '<p>' +
      e(data.batch.id) +
      ' · ' +
      e(data.batch.environment) +
      ' · ' +
      V.status(data.batch.state) +
      '</p>' +
      V.source;
    body += P.table(
      ['用例', '最新结果', '操作'],
      cases.map((c) => {
        const r = data.latest.find((r) => r.caseId === c.caseId);
        return [
          e(c.caseId) + ' ' + e(c.title),
          r ? V.status(r.status) + ' #' + r.sequence : '未登记',
          b('r3-result-open', '登记实际结果', {
            bid: id,
            case: c.caseId,
            disabled: data.batch.state !== 'OPEN' || !w().actions.canWrite,
          }),
        ];
      }),
    );
    body += P.table(
      ['历史记录', '实际结果 / 原因', '证据 / 缺陷'],
      data.results.items.map((r) => [
        e(r.id) +
          ' · ' +
          e(r.caseId) +
          ' #' +
          r.sequence +
          ' ' +
          V.status(r.status),
        e(r.actual || r.reason) +
          '<br>' +
          e(r.registeredBy) +
          ' · ' +
          e(P.time(r.executedAt)),
        V.evidence(r.evidence) +
          (r.status === 'FAIL'
            ? b('r3-defect-open', '登记缺陷', {
                rid: r.id,
                disabled: !w().actions.canWrite,
              })
            : ''),
      ]),
    );
    if (offset > 0)
      body += b('r3-batch', '上一页', { id, offset: Math.max(0, offset - 20) });
    if (offset + 20 < data.results.total)
      body += b('r3-batch', '下一页', { id, offset: offset + 20 });
    X.open(
      'batch:' + id,
      '测试批次',
      body,
      b(
        'r3-batch-complete',
        '完成测试并进入验收',
        { id, disabled: data.batch.state !== 'OPEN' || !w().actions.canWrite },
        'primary',
      ) +
        b('r3-results-import', '批量登记结果', {
          id,
          disabled: data.batch.state !== 'OPEN' || !w().actions.canWrite,
        }) +
        b('r3-cancel-open', '取消批次', {
          id,
          disabled: data.batch.state !== 'OPEN' || !w().actions.canWrite,
        }),
      { batch: data },
    );
  };
  X.actions = {
    'r3-check-current': async () => {
      X.meta();
      X.remember();
      const prior = form;
      const initial = A.draft(prior.id);
      if (!initial.forms?.[prior.key]) {
        initial.forms = {
          ...initial.forms,
          [prior.key]: {
            values: X.values(),
            meta: prior.meta,
            proofs: prior.proofs,
          },
        };
        A.save(prior.id, initial);
      }
      P.assert(!A.draft(prior.id).pending, '先核验原提交，再比较最新依据');
      await A.load(prior.id);
      P.assert(
        P.r()?.id === prior.id && A.key(prior.id) === prior.identity,
        '需求或身份已切换',
      );
      const current = w(),
        meta = { ...prior.meta, expectedRevision: X.current().revision };
      if (prior.key === 'handoff')
        meta.devVersionId = X.current().artifacts.dev.at(-1)?._serverId;
      if ('baseGroupId' in meta) meta.baseGroupId = current.groupId;
      if ('currentSuiteId' in meta)
        meta.currentSuiteId = current.currentSuite?.id || null;
      if (prior.key === 'batch-new')
        meta.baselineId = current.currentDelivery?.id;
      if (prior.key === 'acceptance') {
        P.assert(
          meta.baselineId === current.currentDelivery?.id &&
            meta.batchId === current.currentTest?.id,
          '交付或测试报告已更换，请重新核对报告后填写验收',
        );
      }
      let rows = [];
      if (meta.batchId && prior.key !== 'acceptance') {
        const data = await X.read('/test-batches/' + meta.batchId);
        P.assert(
          data.batch.state === 'OPEN' &&
            data.batch.baselineId === current.currentDelivery?.id,
          '原批次已关闭或交付已改变，请在当前批次重新登记',
        );
        rows = data.latest.map((r) => [
          e(r.caseId),
          e(r.id),
          '序号 ' + r.sequence,
        ]);
        if (meta.caseId) {
          const latest = data.latest.find((r) => r.caseId === meta.caseId);
          meta.sequence = (latest?.sequence || 0) + 1;
          meta.previousResultId = latest?.id || null;
        }
      }
      const draft = A.draft(prior.id),
        proofs = Object.fromEntries(
          X.current().attachments.map((a) => [a.id, a.version]),
        );
      comparison = { prior, meta, proofs, revision: X.current().revision };
      X.open(
        'compare',
        '核对最新依据',
        '<p>保留输入文字；确认后更新下列版本。已变更的附件将取消勾选，请重新查看证据。批量结果的序号须按最新记录自行核对。</p>' +
          P.table(
            ['依据', '填写时', '当前'],
            Object.keys(meta)
              .filter((k) => /Id$|Revision$|sequence/.test(k))
              .map((k) => [e(k), e(prior.meta[k]), e(meta[k])]),
          ) +
          P.table(
            ['附件', '填写时版本', '当前版本'],
            (draft.forms[prior.key]?.values.evidence || []).map((id) => [
              e(id),
              e(prior.proofs[id]),
              e(proofs[id] || '已移除'),
            ]),
          ) +
          (rows.length ? P.table(['用例', '最新结果', '版本'], rows) : ''),
        b('r3-use-current', '已核对，保留文字并更新依据', {}, 'primary'),
      );
    },
    'r3-use-current': () => {
      const c = comparison;
      P.assert(
        c && c.prior.id === P.r()?.id && c.prior.identity === A.key(c.prior.id),
        '需求或身份已切换，请重新核对',
      );
      P.assert(
        c.revision === X.current().revision,
        '核对期间内容又有更新，请重新核对',
      );
      const d = A.draft(c.prior.id);
      P.assert(!d.pending, '先核验原提交');
      const saved = d.forms[c.prior.key];
      saved.meta = c.meta;
      saved.proofs = c.proofs;
      if (saved.values.evidence)
        saved.values.evidence = saved.values.evidence.filter(
          (id) => c.prior.proofs[id] === c.proofs[id],
        );
      A.save(c.prior.id, d);
      const body = c.prior.body.replace(
        /<fieldset data-r3-evidence>[\s\S]*?<\/fieldset>/g,
        () => V.evidenceFields(),
      );
      X.open(c.prior.key, c.prior.title, body, c.prior.footer, c.meta);
      comparison = null;
    },
    'r3-refresh': async () => {
      await A.load(X.current().id);
      P.render();
    },
    'r3-tests': () => {
      A.tabs[X.current().id] = 'testing';
      P.go({ panel: 'canvas' });
    },
    'r3-artifacts': () => {
      A.tabs[X.current().id] = 'artifacts';
      P.go({ panel: 'canvas' });
    },
    'r3-retry': async () => {
      const id = X.current().id;
      const r = await A.retry(id);
      X.finish(id);
      if (r.nextStage && P.r()?.id === id) {
        delete A.tabs[id];
        P.go({ stage: r.nextStage, panel: 'canvas' });
      }
      P.toast('原提交已核实');
    },
    'r3-suite-new': async () => {
      const id = X.current().id;
      const r = await A.write(id, '/test-suites', {
        baseGroupId: w().groupId,
        fromAcceptance: true,
      });
      X.editor(r.suite);
    },
    'r3-suite-edit': async () => X.editor(await X.suite()),
    'r3-suite-save': async () => {
      const v = X.values(),
        meta = X.meta();
      const r = await X.submit('/test-suites', {
        ...meta,
        title: v.title,
        cases: parse(v.cases, '用例JSON'),
      });
      P.toast(
        r.suite.status === 'READY'
          ? '完整套件已保存，请比较后采用'
          : '草稿已保存，请继续补齐',
      );
      await X.actions['r3-suite-review']({ id: r.suite.id });
    },
    'r3-suite-review': async (d) => {
      const { suite } = await X.read('/test-suites/' + d.id);
      X.open(
        'suite:' + d.id,
        '套件版本 · ' + d.id,
        '<p>' +
          V.status(suite.status) +
          ' · 所属组 ' +
          e(suite.groupId) +
          '</p>' +
          suite.gaps.map((v) => '<p>' + e(v) + '</p>').join('') +
          P.table(
            ['用例', '覆盖', '预期'],
            suite.cases.map((c) => [
              e(c.caseId) + ' ' + e(c.title),
              e(c.acIds.join('、')),
              e(c.expected),
            ]),
          ),
        b(
          'r3-suite-adopt',
          '采用本套件',
          { disabled: suite.status !== 'READY' || !w().actions.canWrite },
          'primary',
        ) +
          b('r3-suite-copy', '基于此版完善', {
            disabled: !w().actions.canWrite,
          }),
        {
          suite,
          baseGroupId: w().groupId,
          currentSuiteId: w().currentSuite?.id || null,
          expectedRevision: X.current().revision,
        },
      );
    },
    'r3-suite-copy': () => {
      const suite = X.meta().suite;
      X.editor(suite);
    },
    'r3-suite-adopt': () => {
      const m = X.meta();
      return X.submit('/test-suites/' + m.suite.id + '/adopt', {
        baseGroupId: m.baseGroupId,
        currentSuiteId: m.currentSuiteId,
        expectedRevision: m.expectedRevision,
      });
    },
    'r3-suite-compare': async () => {
      X.remember();
      const text = X.values().cases,
        cases = parse(text, '用例JSON');
      await A.load(X.current().id);
      const current = await X.suite();
      X.open(
        'compare',
        '比较套件与当前依据',
        P.table(
          ['对象', '当前'],
          [
            ['关联组', e(w().groupId)],
            ['采用套件', e(current?.id || '无')],
          ],
        ) +
          P.table(
            ['编号', '变化'],
            cases.map((c) => {
              const old = current?.cases.find((x) => x.caseId === c.caseId);
              return [
                e(c.caseId),
                !old
                  ? '新增'
                  : JSON.stringify(old) === JSON.stringify(c)
                    ? '沿用'
                    : '内容变化',
              ];
            }),
          ) +
          P.table(
            ['从草稿移除的用例'],
            (current?.cases || [])
              .filter((c) => !cases.some((n) => n.caseId === c.caseId))
              .map((c) => [e(c.caseId)]),
          ),
        b('r3-suite-rebase', '已比较，沿用文字并更新依据'),
      );
    },
    'r3-suite-rebase': () => {
      const q = X.current(),
        d = A.draft(q.id);
      P.assert(!d.pending, '先核验原提交');
      d.forms.editor.meta = {
        baseGroupId: w().groupId,
        baseSuiteId: w().currentSuite?.id || null,
        expectedRevision: q.revision,
      };
      A.save(q.id, d);
      X.editor(w().currentSuite || { cases: [] });
    },
    'r3-case-edit': (d) => {
      X.remember();
      const draft = A.draft(X.current().id).forms.editor,
        cases = parse(draft.values.cases, '用例JSON'),
        i = Number(d.index ?? draft.values.editIndex ?? 0),
        c = cases[i] || {
          caseId: 'CASE-' + (cases.length + 1),
          acIds: [],
          ruleIds: [],
          steps: [],
          executionMode: 'USER_REPORTED',
        };
      X.open(
        'case:' + i,
        '逐项完善用例',
        P.field('caseId', '稳定用例编号', c.caseId) +
          P.field('acIds', '验收项编号（逗号分隔）', c.acIds.join(',')) +
          P.field('ruleIds', '规则编号（逗号分隔）', c.ruleIds.join(',')) +
          [
            'title',
            'scenario',
            'preconditions',
            'expected',
            'dataPolicy',
            'owner',
          ]
            .map((k, n) =>
              P.field(
                k,
                ['标题', '场景', '前置条件', '预期结果', '数据策略', '负责人'][
                  n
                ],
                c[k] || '',
                n > 0 && n < 5 ? 'textarea' : 'text',
              ),
            )
            .join('') +
          P.field(
            'steps',
            '操作步骤（每行一步）',
            c.steps.join('\n'),
            'textarea',
          ),
        b('r3-case-save', '保留用例并返回套件', {}, 'primary'),
        { index: i, cases, editor: draft },
      );
    },
    'r3-case-save': () => {
      const v = X.values(),
        m = X.meta();
      const c = {
        ...v,
        acIds: v.acIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ruleIds: v.ruleIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        steps: v.steps.split('\n').filter(Boolean),
        executionMode: 'USER_REPORTED',
      };
      m.cases[m.index] = c;
      const id = X.current().id,
        d = A.draft(id);
      d.forms.editor = {
        ...m.editor,
        values: { ...m.editor.values, cases: JSON.stringify(m.cases, null, 2) },
      };
      A.save(id, d);
      X.editor(w().currentSuite || { cases: [] });
    },
    'r3-suite-import': () => {
      X.remember();
      X.open(
        'import',
        '导入测试用例',
        P.field('file', 'JSON文件', '', 'file') +
          '<p>文件只作数据读取，最大512 KiB，最多200用例。导入后需保存并比较采用。</p>',
        b('r3-suite-import-save', '读取并继续编辑'),
      );
    },
    'r3-suite-import-save': async () => {
      const input = document.querySelector('#modal-root [name="file"]'),
        file = input.files[0],
        id = X.current().id,
        key = A.key(id);
      P.assert(file && file.size <= 524288, '请选择不超过512 KiB的JSON文件');
      const value = parse(await file.text(), '导入JSON');
      P.assert(P.r()?.id === id && key === A.key(id), '身份已切换');
      const cases = Array.isArray(value) ? value : value.cases;
      P.assert(Array.isArray(cases) && cases.length <= 200, '最多200用例');
      const d = A.draft(id);
      d.forms.editor.values.cases = JSON.stringify(cases, null, 2);
      A.save(id, d);
      X.editor(w().currentSuite || { cases: [] });
    },
    'r3-suite-export': () => {
      const text = JSON.stringify(parse(X.values().cases, '用例JSON'), null, 2);
      P.downloadBlob(
        new Blob([text], { type: 'application/json' }),
        '测试用例.json',
        'application/json',
      );
    },
    'r3-handoff': () => {
      const q = X.current(),
        dev = q.artifacts.dev.at(-1);
      P.assert(dev?._serverId, '请先保存开发记录');
      X.open(
        'handoff',
        '登记本次交付并提测',
        '<p>将冻结当前业务、设计、开发、套件及证据。版本引用由登记者声明。</p>' +
          [
            'versionRef',
            'changes',
            'implementation',
            'rollback',
            'unimplemented',
            'runId',
          ]
            .map((k, i) =>
              P.field(
                k,
                [
                  '提交 / 构建 / 版本引用',
                  '变更摘要',
                  '实施说明',
                  '回滚方式',
                  '未实现范围（可填无）',
                  '关联作业（选填）',
                ][i],
                '',
                i > 0 && i < 5 ? 'textarea' : 'text',
              ),
            )
            .join('') +
          V.evidenceFields(),
        b('r3-handoff-save', '登记交付并进入测试', {}, 'primary'),
        { devVersionId: dev._serverId, expectedRevision: q.revision },
      );
    },
    'r3-handoff-save': () => {
      const v = X.values();
      return X.submit('/delivery-baselines', {
        ...v,
        ...X.meta(),
        evidence: X.evidence(v.evidence),
      });
    },
    'r3-batch-new': () =>
      X.open(
        'batch-new',
        '开始本次人工测试',
        V.source + P.field('environment', '实际测试环境'),
        b('r3-batch-create', '创建批次', {}, 'primary'),
        {
          baselineId: w().currentDelivery?.id,
          expectedRevision: X.current().revision,
        },
      ),
    'r3-batch-create': async () => {
      const r = await X.submit('/test-batches', {
        ...X.meta(),
        environment: X.values().environment,
        source: 'USER_REPORTED',
      });
      await X.batch(r.batch.id);
    },
    'r3-batch': (d) => X.batch(d.id, Number(d.offset || 0)),
    'r3-result-open': async (d) => {
      const data = await X.read('/test-batches/' + d.bid),
        prior = data.latest.find((r) => r.caseId === d.case),
        c = (await X.suite()).cases.find((c) => c.caseId === d.case);
      X.open(
        'result:' + d.bid + ':' + d.case,
        '登记实际结果 · ' + d.case,
        '<p>' +
          e(c.expected) +
          '</p>' +
          V.source +
          P.select(
            'status',
            '执行状态',
            [
              ['NOT_RUN', '未执行'],
              ['BLOCKED', '阻塞'],
              ['FAIL', '失败'],
              ['PASS', '通过'],
            ],
            'NOT_RUN',
          ) +
          P.field('actual', '实际观察结果', '', 'textarea') +
          P.field('reason', '未完成原因', '', 'textarea') +
          P.field('executedAt', '实际执行时间', '', 'datetime-local') +
          V.evidenceFields(),
        b('r3-result-save', '追加本次结果', {}, 'primary'),
        {
          batchId: d.bid,
          caseId: d.case,
          sequence: (prior?.sequence || 0) + 1,
          previousResultId: prior?.id || null,
          expectedRevision: X.current().revision,
        },
      );
    },
    'r3-result-save': async () => {
      const v = X.values(),
        m = X.meta();
      P.assert(v.executedAt, '请填写实际执行时间');
      const r = {
        ...v,
        ...m,
        executedAt: new Date(v.executedAt).toISOString(),
        source: 'USER_REPORTED',
        evidence: X.evidence(v.evidence),
      };
      delete r.batchId;
      delete r.expectedRevision;
      await X.submit('/test-batches/' + m.batchId + '/results', {
        expectedRevision: m.expectedRevision,
        results: [r],
      });
      await X.batch(m.batchId);
    },
    'r3-results-import': (d) =>
      X.open(
        'results:' + d.id,
        '批量登记人工结果',
        '<p>每次最多100条。填写每例序号、前结果、实际值、执行时间与当前附件版本；不提供一键全通过。</p>' +
          P.field('results', '结果列表 JSON', '[]', 'textarea'),
        b('r3-results-save', '校验并追加'),
        { batchId: d.id, expectedRevision: X.current().revision },
      ),
    'r3-results-save': () => {
      const m = X.meta();
      return X.submit('/test-batches/' + m.batchId + '/results', {
        expectedRevision: m.expectedRevision,
        results: parse(X.values().results, '结果JSON'),
      });
    },
    'r3-batch-complete': (d) =>
      X.submit('/test-batches/' + d.id + '/complete', {}),
    'r3-cancel-open': (d) =>
      X.open(
        'cancel:' + d.id,
        '取消测试批次',
        P.field('reason', '取消原因', '', 'textarea'),
        b('r3-cancel-save', '确认取消'),
        { id: d.id },
      ),
    'r3-cancel-save': () =>
      X.submit('/test-batches/' + X.meta().id + '/cancel', {
        reason: X.values().reason,
      }),
    'r3-defect-open': async (d) => {
      const data = X.meta().batch;
      const result = [
        ...(data?.results.items || []),
        ...(data?.latest || []),
      ].find((r) => r.id === d.rid);
      P.assert(result?.status === 'FAIL', '请从失败结果打开缺陷登记');
      const c = (await X.suite()).cases.find((c) => c.caseId === result.caseId);
      X.open(
        'defect-new:' + d.rid,
        '从失败结果登记缺陷',
        '<p>失败结果 ' +
          e(result.id) +
          ' · 用例 ' +
          e(result.caseId) +
          ' · 验收项 ' +
          e(c?.acIds.join('、')) +
          '</p>' +
          P.field('title', '缺陷标题', c?.title || result.caseId) +
          P.field(
            'description',
            '复现情况与影响',
            '实际结果：' +
              result.actual +
              '\n预期：' +
              (c?.expected || '') +
              '\n复现步骤：\n' +
              (c?.steps || []).join('\n'),
            'textarea',
          ) +
          V.evidence(result.evidence),
        b('r3-defect-create', '登记缺陷', {}, 'primary'),
        { resultId: d.rid, expectedRevision: X.current().revision },
      );
    },
    'r3-defect-create': () =>
      X.submit('/defects', { ...X.values(), ...X.meta() }),
    'r3-defect': async (d) => {
      const offset = Number(d.offset || 0),
        value = await X.read('/defects/' + d.id + '?offset=' + offset),
        defect = value.defect;
      X.open(
        'defect:' + d.id,
        '缺陷 · ' + d.id,
        '<p>' +
          e(defect.title) +
          ' ' +
          V.status(defect.state) +
          '</p><p>' +
          e(defect.description) +
          '</p>' +
          P.table(
            ['事件', '结论与证据'],
            value.events.map((ev) => [
              e(ev.id) + ' ' + V.status(ev.state),
              e(ev.comment) + V.evidence(ev.evidence),
            ]),
          ),
        (offset > 0
          ? b('r3-defect', '上一页', {
              id: d.id,
              offset: Math.max(0, offset - 20),
            })
          : '') +
          (offset + 20 < value.total
            ? b('r3-defect', '下一页', { id: d.id, offset: offset + 20 })
            : '') +
          b('r3-resolve-open', '登记新开发版本修复', {
            disabled:
              !w().actions.canWrite ||
              !['OPEN', 'REOPEN'].includes(defect.state),
          }) +
          b('r3-retest-open', '登记回归结论', {
            disabled: !w().actions.canWrite || defect.state !== 'RESOLVED',
          }),
        { defect },
      );
    },
    'r3-resolve-open': () => {
      const d = X.meta().defect;
      X.open(
        'resolve:' + d.id,
        '声明修复并准备新交付',
        '<p>先保存包含修复的新开发版本，再声明修复；此操作不代表回归通过。</p>' +
          P.field(
            'devVersionId',
            '新开发版本编号',
            X.current().artifacts.dev.at(-1)?._serverId || '',
          ) +
          P.field('comment', '修复说明', '', 'textarea') +
          V.evidenceFields(),
        b('r3-resolve-save', '登记修复并返回开发'),
        { id: d.id },
      );
    },
    'r3-resolve-save': () => {
      const v = X.values();
      return X.submit('/defects/' + X.meta().id + '/resolve', {
        ...v,
        evidence: X.evidence(v.evidence),
      });
    },
    'r3-retest-open': () => {
      const d = X.meta().defect;
      X.open(
        'retest:' + d.id,
        '确认新交付回归',
        '<p>选择当前新交付中同用例的最新结果。通过则关闭，失败则重开。</p>' +
          P.field('resultId', '回归结果编号') +
          P.field('comment', '回归结论', '', 'textarea'),
        b('r3-retest-save', '登记回归结论'),
        { id: d.id },
      );
    },
    'r3-retest-save': () =>
      X.submit('/defects/' + X.meta().id + '/retest', X.values()),
    'r3-history': async (d) => {
      const offset = Number(d.offset || 0),
        k = d.kind;
      P.assert(
        [
          'test-suites',
          'delivery-baselines',
          'test-batches',
          'defects',
          'product-acceptances',
        ].includes(k),
        '历史类型无效',
      );
      const list = await X.read('/' + k + '?offset=' + offset);
      X.open(
        'history:' + k,
        '版本与交付历史',
        P.table(
          ['记录', '状态', '查看'],
          list.items.map((x) => [
            e(x.id) + ' ' + e(x.title || ''),
            V.status(x.state),
            b(
              k === 'test-suites'
                ? 'r3-suite-review'
                : k === 'test-batches'
                  ? 'r3-batch'
                  : k === 'defects'
                    ? 'r3-defect'
                    : 'r3-detail',
              '查看',
              { kind: k, id: x.id },
            ),
          ]),
        ),
        (offset > 0
          ? b('r3-history', '上一页', {
              kind: k,
              offset: Math.max(0, offset - 20),
            })
          : '') +
          (offset + 20 < list.total
            ? b('r3-history', '下一页', { kind: k, offset: offset + 20 })
            : '') +
          (k === 'test-suites'
            ? b('r3-history', '交付历史', {
                kind: 'delivery-baselines',
                offset: 0,
              })
            : ''),
      );
    },
    'r3-detail': async (d) => {
      P.assert(
        ['delivery-baselines', 'product-acceptances'].includes(d.kind),
        '详情类型无效',
      );
      const value = await X.read('/' + d.kind + '/' + d.id),
        r = value.delivery || value.acceptance;
      X.open(
        'detail:' + d.id,
        '冻结记录 · ' + d.id,
        '<p>历史记录不等于当前放行依据；当前条件以工作区和发布准备输入为准。</p>' +
          P.table(
            ['字段', '内容'],
            Object.entries(
              r.subject || {
                decision: r.decision,
                comment: r.comment,
                risks: r.risks,
                member: r.member,
              },
            )
              .filter(([k]) => !['evidence'].includes(k))
              .map(([k, v]) => [e(k), e(v)]),
          ) +
          P.table(
            ['冻结关联', '版本'],
            Object.entries(r.snapshot)
              .filter(([k]) => /Id$/.test(k))
              .map(([k, v]) => [e(k), e(v)]),
          ) +
          V.evidence(r.evidence || r.snapshot.evidence),
      );
    },
  };
  X.install = (remote) => {
    A.install();
    V.install();
    Object.assign(X.actions, P.acceptanceActions.actions);
    for (const [name, fn] of Object.entries(X.actions))
      remote[name] = async (...args) => {
        try {
          return await fn(...args);
        } catch (err) {
          X.remember();
          queueMicrotask(() => {
            const node = document.querySelector('#form-error');
            if (node) {
              node.tabIndex = -1;
              node.focus();
            }
          });
          throw err;
        }
      };
    const modal = P.modal,
      close = P.close;
    P.modal = (...args) => {
      X.remember();
      form = null;
      A.activeForm = null;
      return modal(...args);
    };
    P.close = (...args) => {
      X.remember();
      form = null;
      A.activeForm = null;
      return close(...args);
    };
    document.addEventListener('input', (ev) => {
      if (ev.target.closest('#modal-root form')) X.remember();
    });
    document.addEventListener('change', (ev) => {
      if (ev.target.closest('#modal-root form')) X.remember();
    });
    const advance = P.domainActions.advance;
    P.domainActions.advance = (q) =>
      A.enabled() && q.stage === 'dev'
        ? X.actions['r3-handoff']()
        : A.enabled() && q.stage === 'test'
          ? X.actions['r3-tests']()
          : A.enabled() && q.stage === 'accept'
            ? P.acceptanceActions.actions['r3-accept-open']()
            : advance(q);
  };
})();
