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
  A['plan-run'] = (d) => {
    P.write();
    P.current(r());
    P.modal(
      '本地作业 · 确认本次范围',
      `<p>${e(r().id + ' · ' + r().name)}</p><p>已确认方案：${e(P.latest(r(), 'design').id)}</p><p>工作区：${e(r().workspace)}；网络关闭；最大并行 3 个作业。</p><div class="checklist"><p>可执行：读取/修改项目文件、Shell、Git 只读、格式化、测试、构建、本地预览。</p><p>同一任务范围内连续执行；新增范围会单独显示原因和确认入口。</p></div><p class="muted">这是原型模拟，不会调用实际 Shell 或修改工作区。</p>`,
      b('close-modal', '取消') +
        b('start-run', '按此范围执行', { parent: d.parent || '' }, 'primary'),
    );
  };
  A['plan-retry'] = (d) => {
    const old = r().runs.find((x) => x.id === d.id);
    P.assert(
      old?.verified && ['CANCELLED', 'FAILED'].includes(old.status),
      '先核验旧作业',
    );
    A['plan-run']({ parent: d.id });
  };
  A['start-run'] = (d) => commit(() => P.startRun(r(), d.parent || null));
  A['run-control'] = (d) => {
    if (d.control !== 'verify')
      return commit(() => P.runControl(r(), d.control));
    const run = P.run(r());
    P.modal(
      '核验执行结果',
      '<p>正式接入后由 Bridge 读回进程与执行记录。此处选择模拟回传，核验不等于取消或成功。</p>' +
        form(
          P.select(
            'observed',
            '模拟执行侧回传',
            Object.entries(P.labels).filter(([id]) =>
              [
                'UNKNOWN',
                'RUNNING',
                'SUCCEEDED',
                'FAILED',
                'CANCELLED',
              ].includes(id),
            ),
            run.status,
          ),
        ),
      b('confirm-verification', '开始核验（演示）', {}, 'primary'),
    );
  };
  A['confirm-verification'] = () => {
    const f = P.form();
    commit(() => {
      P.run(r()).verificationResult = f.observed;
      P.runControl(r(), 'verify');
    });
  };
  A['run-input'] = () => {
    P.write();
    P.modal(
      '补充作业输入',
      form(P.field('answer', '补充说明', '', 'textarea')),
      b('resume-input', '提交并继续', {}, 'primary'),
    );
  };
  A['resume-input'] = () => {
    const f = P.form();
    P.assert(f.answer.trim(), '请填写补充说明');
    commit(() => {
      P.runControl(r(), 'input');
      P.log(r(), '补充输入', f.answer);
    });
  };
  A['scope-approval'] = () =>
    P.modal(
      '作业需要补充范围',
      `<p>建议将新增项目文件纳入当前任务，继续生成测试。</p><p>工作区保持 ${e(r().workspace)}，网络保持关闭。</p>`,
      b('run-control', '批准新增范围', { control: 'grant' }, 'primary') +
        b('run-control', '拒绝并取消', { control: 'cancel' }, 'danger'),
    );
  A['preview-toggle'] = () =>
    commit(() => {
      const run = P.run(r());
      P.assert(run?.status === 'SUCCEEDED', '先完成当前作业');
      run.preview = !run.preview;
      P.log(
        r(),
        run.preview ? '预览已启动' : '预览已停止',
        run.id + ' · 模拟进程，无真实端口',
      );
    });
  A['preview-open'] = () =>
    P.modal(
      '本地预览 · 演示',
      `<div class="guide-notice">这块区域展示开发产物的预览入口，正式接入本地预览服务。</div><h3>${e(r().name)}</h3><p class="doc-body">${e(r().goal)}</p><p>作业：${e(P.run(r()).id)} · ${e(r().workspace)}</p>`,
      b('close-modal', '返回作业'),
    );
})();
