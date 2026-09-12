(() => {
  const P = window.PFC,
    { esc: e, btn: b } = P,
    A = P.actions;
  const commit = (fn, close = true) => {
    P.write();
    fn();
    P.save();
    if (close) P.close();
    P.render();
  };
  const form = (body) => `<form>${body}</form>`;
  const r = () => P.r();
  A['run-tests'] = (d) => commit(() => P.testRun(r(), d.fail === '1'));
  A['open-test-cases'] = () =>
    P.modal(
      '用例与提测交接',
      P.table(
        ['关联 AC', '前置条件', '步骤', '预期', '数据 / 自动化'],
        r().acs.map((a) => [
          e(a.id + ' ' + a.text),
          '当前方案确认，开发作业成功',
          '构造规则命中、边界和退出场景 → 执行动作 → 核对结果',
          '符合 AC，异常可追踪',
          'CODEx_TEST_ 合成场景 / 正式程序待接入',
        ]),
      ) +
        `<p class="muted">代码基线 ${e(P.stamp(r()))}；负责人 ${e(r().owner)}。本页面展示测试设计与模拟结果，不冒充正式自动化报告。</p>`,
      b('close-modal', '返回'),
      true,
    );
  A['resolve-defect'] = (d) => {
    P.write();
    P.modal(
      '登记缺陷修复',
      form(P.field('note', '修复说明 / 变更引用', '', 'textarea')),
      b('save-defect', '登记修复，等待复测', { id: d.id }, 'primary'),
    );
  };
  A['save-defect'] = (d) => {
    const f = P.form();
    P.assert(f.note.trim(), '填写修复说明');
    commit(() => {
      const bug = r().defects.find((x) => x.id === d.id);
      bug.status = 'RESOLVED';
      bug.note = f.note;
      P.log(r(), '缺陷修复登记', bug.id + ' · ' + f.note);
    });
  };
  A['accept-review'] = () => {
    P.write();
    P.current(r());
    P.assert(r().stage === 'accept', '请在验收阶段处理');
    P.modal(
      '填写产品验收结论',
      form(
        `<div class="checklist">${['功能与 AC 结果', '权限、边界与异常', '版本、差异与可追溯证据'].map((x, n) => `<label><input type="checkbox" name="check${n}" value="yes">${x}已核对</label>`).join('')}</div>` +
          P.field('note', '验收结论与残余风险', '', 'textarea'),
      ),
      b('save-accept', '确认产品验收', {}, 'primary'),
    );
  };
  A['save-accept'] = () => {
    const f = P.form();
    P.assert(
      f.check0 && f.check1 && f.check2 && f.note.trim(),
      '完成三项核对并填写验收结论',
    );
    commit(() => {
      P.assert(
        r().tests.length &&
          r().tests.every((t) => t.status === 'PASS') &&
          r().defects.every((d) => d.status === 'CLOSED'),
        '测试与缺陷尚未满足验收条件',
      );
      /* 客观质量门：存在未执行/未通过的门禁时阻断验收 */
      const gates = r().runs.at(-1)?.qualityGates || [];
      P.assert(
        !gates.length || gates.every((g) => g.status === '通过'),
        '质量门未全绿（存在失败或未执行项），请回开发修复后重跑',
      );
      r().accept = {
        id: 'ACCEPT-' + ++P.s.seq,
        at: P.now(),
        status: 'ACCEPTED',
        actor: '陈立',
        note: f.note,
        stamp: P.stamp(r()),
      };
      P.log(r(), '产品验收通过', f.note);
    });
  };
  A['accept-reject'] = () => {
    P.write();
    P.modal(
      '驳回验收',
      form(P.field('note', '问题与回流原因', '', 'textarea')),
      b('save-rejection', '返回开发处理', {}, 'danger'),
    );
  };
  A['save-rejection'] = () => {
    const f = P.form();
    P.assert(f.note.trim(), '填写回流原因');
    commit(() => {
      P.current(r());
      P.assert(r().stage === 'accept', '请在验收阶段处理');
      r().rejectedRunIds = r().runs.map((x) => x.id);
      P.invalidate(r(), 'dev');
      r().accept = { status: 'REJECTED', actor: '陈立', note: f.note };
      P.latest(r(), 'dev').confirmed = false;
      P.s.ui.stage = 'dev';
      P.log(r(), '验收驳回', f.note);
    });
  };
  A['release-form'] = () => {
    P.write();
    const rel = r().release;
    P.modal(
      '发布准备',
      form(
        P.select(
          'target',
          '目标环境',
          [
            ['本地演示环境', '本地演示环境'],
            ['SIT 演示目标', 'SIT 演示目标（不实际连接）'],
          ],
          rel?.target || '本地演示环境',
        ) +
          P.field(
            'scope',
            '准确发布范围',
            rel?.scope || r().name + ' 当前已验收版本',
            'textarea',
          ) +
          P.field('rollback', '回滚步骤', rel?.rollback || '', 'textarea') +
          P.field('hours', '观察窗口（小时）', rel?.hours || 24, 'number'),
      ),
      b('submit-release', '提交审批', {}, 'primary'),
    );
  };
  A['submit-release'] = () => {
    const f = P.form();
    commit(() => {
      P.requestRelease(r(), f);
      P.pushNotice('发布审批待处理：' + r().release.id, r().id, 'info');
    });
  };
  A['release-action'] = (d) => commit(() => P.releaseAction(r(), d.control));
  A['run-cicd'] = () => {
    P.write();
    P.current(r());
    commit(() => {
      const rel = r().release;
      P.assert(rel, '先准备并批准发布范围');
      P.assert(
        ['APPROVED', 'FAILED'].includes(rel.status),
        '仅批准后可执行 CI/CD；执行失败可重跑',
      );
      rel.cicd = {
        status: '通过',
        at: P.now(),
        steps: [
          { name: '构建产物', status: '通过' },
          { name: '单元测试', status: '通过' },
          { name: '部署到 ' + (rel.target || '演示环境'), status: '通过' },
          { name: '冒烟验证', status: '通过' },
        ],
      };
      P.log(r(), 'CI/CD 流水线执行', '构建/测试/部署/冒烟 4 步全部通过');
    });
    P.toast('CI/CD 流水线 4 步全部通过', 'ok');
  };
  A['observe-form'] = () => {
    P.write();
    const o = r().observation;
    P.assert(o, '没有成功发布对应的观察窗口');
    const members = P.s.team.members.map((m) => m.name).join('、');
    P.modal(
      '观察结果与最终复盘',
      form(
        P.field(
          'metrics',
          '本次观测指标及来源',
          o.metrics,
          'textarea',
          '演示请标识为模拟指标；正式结果需要真实来源。每次保存追加一条观测记录',
        ) +
          P.field(
            'followups',
            '后续事项（每行：事项 | 负责人 | 待处理/进行中/已完成）',
            (o.followups || [])
              .map((x) => `${x.text} | ${x.owner} | ${x.status}`)
              .join('\n'),
            'textarea',
            '负责人从团队成员中选择：' + members,
          ) +
          P.field(
            'conclusion',
            '结果、经验与最终复盘结论',
            o.conclusion,
            'textarea',
          ) +
          `<label class="form-field"><span>沉淀到知识库</span>${P.select(
            'knowledge-type',
            '',
            [
              ['', '不沉淀（仅本次复盘）'],
              ['复盘结论', '复盘结论'],
              ['组件规范', '组件规范'],
              ['接口契约', '接口契约'],
              ['踩坑记录', '踩坑记录'],
              ['Playbook', 'Playbook（可复用执行清单）'],
            ],
            o.knowledgeType || '',
          )}<small>沉淀后新需求创建时会自动检索引用，形成组织复利。</small></label>`,
      ),
      b('save-observation', '追加观测记录') +
        b('finish-observation', '完成最终复盘', {}, 'primary'),
    );
  };
  const observation = (finish) => {
    const f = P.form();
    P.assert(f.metrics.trim(), '填写指标与来源');
    if (finish) P.assert(f.conclusion.trim(), '填写最终复盘结论');
    commit(() => {
      const q = r(),
        o = q.observation;
      P.current(q);
      if (finish) {
        P.assert(
          P.now() - o.startedAt >= o.hours * 3600000,
          '观察窗口尚未结束，可先保存记录',
        );
        P.assert(q.release.status === 'SUCCEEDED', '发布状态未成功');
        q.closed = true;
      }
      /* 每次保存追加一条观测记录：时间 / 指标 / 来源 / 发布版本 */
      const entry = {
        at: new Date(P.now()).toISOString(),
        metrics: f.metrics,
        source: '成员录入（演示标识）',
        releaseStamp: o.releaseSnapshot?.stamp || q.release?.stamp || null,
      };
      o.entries = o.entries || [];
      o.entries.push(entry);
      o.metrics = f.metrics;
      o.conclusion = f.conclusion;
      o.knowledgeType = f['knowledge-type'] || '';
      /* 复盘结论 → 知识库反哺：打标类型并沉淀，新需求自动检索引用 */
      const kt = f['knowledge-type'];
      if (kt && f.conclusion.trim()) {
        q.knowledgeRefs = q.knowledgeRefs || [];
        const kid = 'KN-' + String(P.s.knowledge.length + 1).padStart(2, '0');
        P.s.knowledge.push({
          id: kid,
          title: (q.name + ' · ' + kt).slice(0, 60),
          type: kt,
          content: f.conclusion.trim().slice(0, 200),
          sourceReq: q.id,
          tags: [q.id],
          at: new Date(P.now()).toISOString(),
        });
        q.knowledgeRefs.push(kid);
        P.toast('已沉淀到知识库：' + kid);
      }
      o.followups = (f.followups || '')
        .split('\n')
        .map((x) => x.split('|').map((s) => s.trim()))
        .filter((p) => p.length >= 1 && p[0])
        .map((p) => ({
          text: p[0],
          owner: p[1] || q.owner,
          status: ['待处理', '进行中', '已完成'].includes(p[2])
            ? p[2]
            : '待处理',
        }));
      P.log(
        q,
        finish ? '最终复盘完成' : '观测记录追加',
        (entry.metrics || '').slice(0, 60),
      );
    });
  };
  A['save-observation'] = () => observation(false);
  A['finish-observation'] = () => observation(true);
  A['release-snapshot'] = (d) => {
    const q = r(),
      rel = q.releaseHistory.find((x) => x.id === d.id) || q.release;
    P.assert(rel, '发布记录不存在');
    const snap = rel.snapshot;
    P.modal(
      '发布快照 · ' + rel.id,
      `<p class="muted">${rel.status} · ${e(rel.target)} · 申请 ${e(P.time(rel.expiresAt || Date.now()))}</p>` +
        (snap
          ? P.table(
              ['冻结项', '值'],
              [
                ['基线', e(snap.stamp)],
                [
                  '产物版本',
                  e(Object.values(snap.artifacts || {}).join(' / ')),
                ],
                [
                  '作业 / 测试',
                  e((snap.runId || '—') + ' / ' + (snap.testRunId || '—')),
                ],
                ['验收 / 目标', e(snap.acceptId + ' · ' + snap.target)],
                ['冻结时间', e(P.time(snap.frozenAt))],
              ],
            )
          : '<p class="muted">该记录未生成冻结快照（早期申请或未批准）。</p>') +
        `<p class="source-note">发布快照用于历史包可重现：交付包按冻结版本生成，审批后变化不改变已发布记录。</p>`,
      b('deliver-package', '按此快照生成交付包', { rel: rel.id }) +
        b('close-modal', '返回'),
    );
  };
  A['delivery-download'] = () => A['deliver-package']();
})();
