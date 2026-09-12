(() => {
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
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
      r().accept = {
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
    commit(() => P.requestRelease(r(), f));
  };
  A['release-action'] = (d) => commit(() => P.releaseAction(r(), d.control));
  A['observe-form'] = () => {
    P.write();
    const o = r().observation;
    P.assert(o, '没有成功发布对应的观察窗口');
    P.modal(
      '观察结果与最终复盘',
      form(
        P.field(
          'metrics',
          '实际指标及来源',
          o.metrics,
          'textarea',
          '演示请标识为模拟指标；正式结果需要真实来源',
        ) +
          P.field(
            'conclusion',
            '结果、经验与后续事项',
            o.conclusion,
            'textarea',
          ),
      ),
      b('save-observation', '保存观察记录') +
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
      o.metrics = f.metrics;
      o.conclusion = f.conclusion;
      P.log(
        q,
        finish ? '最终复盘完成' : '观察记录更新',
        f.conclusion || f.metrics,
      );
    });
  };
  A['save-observation'] = () => observation(false);
  A['finish-observation'] = () => observation(true);
})();
