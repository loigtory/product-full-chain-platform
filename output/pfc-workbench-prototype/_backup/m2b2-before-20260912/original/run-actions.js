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
      '本地作业 · 计划审批（硬门）',
      `<p>${e(r().id + ' · ' + r().name)}</p><p>已确认方案：${e(P.latest(r(), 'design').id)}</p><p>${(() => {
        const pj = P.s.projects?.find((p) => p.id === r().projectId);
        return pj
          ? '项目：' + e(pj.name + '（' + pj.path + ' · ' + pj.branch + '）— 现有系统迭代，基于已加载项目开发')
          : '工作区：' + e(r().workspace) + '（全新项目，开发时初始化骨架）';
      })()}；网络关闭；最大并行 3 个作业。</p><div class="checklist"><p><b>执行计划：</b>1) 读取项目结构与目标文件 2) 按方案实现改动并运行测试 3) 格式化、构建并汇总差异供验收。</p><p>可执行：读取/修改项目文件、Shell、Git 只读、格式化、测试、构建、本地预览。</p><p>同一任务范围内连续执行；新增范围会单独显示原因和确认入口。</p></div>` +
        form(
          P.field(
            'reject-reason',
            '拒绝原因（如拒绝计划）',
            '',
            'textarea',
            '批准后按计划执行；拒绝将记录原因并进入审计，不发起作业。',
          ),
        ) +
        `<p class="muted">这是原型模拟，不会调用实际 Shell 或修改工作区。</p>`,
      b('close-modal', '取消') +
        b('reject-plan', '拒绝计划', {}, 'danger') +
        b('start-run', '批准计划并执行', { parent: d.parent || '' }, 'primary'),
    );
  };
  A['reject-plan'] = () => {
    const f = P.form();
    commit(() => {
      P.log(
        r(),
        '作业计划被拒绝',
        (f['reject-reason'] || '').trim().slice(0, 120) || '未说明原因',
      );
      P.pushNotice('作业计划被拒绝：' + r().id, r().id, 'warn');
    });
    P.toast('计划已拒绝，未发起作业', 'warn');
  };
  A['run-quality-gates'] = (d) => {
    P.write();
    const run = d.id ? r().runs.find((x) => x.id === d.id) : P.run(r());
    P.assert(run, '没有关联作业');
    commit(() => {
      /* 确定性演示：seed 由 run id 字符和决定，coverage 偶发失败以演示阻断路径 */
      const seed = [...run.id].reduce((n, c) => n + c.charCodeAt(0), 0);
      run.qualityGates = [
        { id: 'lint', name: 'Lint / 静态检查', status: '通过' },
        { id: 'unit', name: '单元测试', status: '通过' },
        {
          id: 'coverage',
          name: '覆盖率 ≥ 80%',
          status: seed % 5 === 0 ? '失败' : '通过',
        },
        { id: 'build', name: '构建', status: '通过' },
        { id: 'security', name: '安全扫描', status: '通过' },
      ];
      const failed = run.qualityGates.filter((g) => g.status === '失败');
      P.log(
        r(),
        '质量门执行',
        failed.length ? '存在失败项：' + failed.map((g) => g.name).join('、') : '全部通过',
      );
      if (failed.length)
        P.pushNotice(
          '质量门未通过：' + failed.map((g) => g.name).join('、'),
          r().id,
          'warn',
        );
    });
    P.toast(
      (d.id ? P.run(r()) : run).qualityGates.every((g) => g.status === '通过')
        ? '质量门全部通过'
        : '质量门存在失败项，需修复后重跑',
      run.qualityGates.every((g) => g.status === '通过') ? 'ok' : 'warn',
    );
  };
  A['replay-run'] = (d) => {
    P.write();
    const run = d.id ? r().runs.find((x) => x.id === d.id) : P.run(r());
    P.assert(run, '没有关联作业');
    const lines = run.lines.map((l) => l.text);
    P.modal(
      '执行回放 · ' + e(run.id),
      `<p class="muted">沙箱快照回放：逐行重放终端与文件快照，可用于审计与复盘。</p><div class="replay-box">` +
        lines
          .map(
            (t, n) =>
              `<div class="replay-line" data-n="${n}">${n + 1}. ${e(t)}</div>`,
          )
          .join('') +
        `</div><div class="replay-snap">快照：${e(
          run.replay?.map((s) => s.label).join(' → ') || '绑定 → 读取 → 实现 → 测试 → 构建',
        )}</div>`,
      `<div class="btn-group">${b('replay-play', '播放', {}, 'primary')}${b('replay-pause', '暂停')}${b('replay-reset', '重置')}</div><div class="btn-group">${b('close-modal', '关闭')}</div>`,
    );
    P.replayTimer = null;
    P.replayIdx = 0;
    const step = () => {
      const box = document.querySelector('.replay-box');
      if (!box) return;
      box.querySelectorAll('.replay-line').forEach((el, n) => {
        el.classList.toggle('active', n <= P.replayIdx);
      });
      P.replayIdx++;
      if (P.replayIdx > lines.length && P.replayTimer) {
        clearInterval(P.replayTimer);
        P.replayTimer = null;
      }
    };
    step();
  };
  A['replay-play'] = () => {
    if (P.replayTimer) return;
    P.replayTimer = setInterval(() => {
      const box = document.querySelector('.replay-box');
      if (!box) {
        clearInterval(P.replayTimer);
        P.replayTimer = null;
        return;
      }
      box.querySelectorAll('.replay-line').forEach((el, n) => {
        el.classList.toggle('active', n <= P.replayIdx);
      });
      P.replayIdx++;
      if (P.replayIdx > box.querySelectorAll('.replay-line').length) {
        clearInterval(P.replayTimer);
        P.replayTimer = null;
      }
    }, 420);
  };
  A['replay-pause'] = () => {
    if (P.replayTimer) clearInterval(P.replayTimer);
    P.replayTimer = null;
  };
  A['replay-reset'] = () => {
    if (P.replayTimer) clearInterval(P.replayTimer);
    P.replayTimer = null;
    P.replayIdx = 0;
    document
      .querySelectorAll('.replay-box .replay-line')
      .forEach((el) => el.classList.remove('active'));
    document
      .querySelector('.replay-box .replay-line[data-n="0"]')
      ?.classList.add('active');
    P.replayIdx = 1;
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
  A['preview-open'] = () => {
    const run = P.run(r());
    P.modal(
      '本地预览 · 演示',
      `<div class="guide-notice">这块区域展示开发产物的预览入口，正式接入本地预览服务。</div><h3>${e(r().name)}</h3><p class="doc-body">${e(r().goal)}</p>` +
        P.table(
          ['字段', '内容'],
          [
            ['作业', e(run?.id || '—')],
            ['工作区', e(r().workspace)],
            [
              '预览地址',
              'http://127.0.0.1:5173/' +
                e((run?.id || 'preview').toLowerCase()),
            ],
            [
              '进程',
              'PID ' +
                String(((run?.id?.charCodeAt(1) || 52) % 9000) + 1000) +
                '（演示）',
            ],
            ['端口', '5173'],
            ['控制', run?.preview ? '预览运行中' : '预览未启动'],
          ],
        ) +
        `<div class="btn-group">${run?.preview ? b('preview-toggle', '停止本地预览', {}, 'danger') : b('preview-toggle', '启动本地预览', {}, 'primary')}</div><p class="source-note">正式版本显示真实地址、PID、端口、归属作业与停止入口。</p>`,
      b('close-modal', '返回作业'),
    );
  };
  A['open-ws-file'] = (d) => {
    const run = r().runs.find((x) => x.id === d.id) || P.run(r());
    const file = run?.files?.find((x) => x.path === d.file);
    P.assert(file, '文件不存在');
    const git = run.git || P.gitMeta(r(), 1);
    const before =
      file.before ||
      (file.kind === 'test'
        ? '//（新增测试文件，无前置版本）'
        : '/* 变更前版本：当前会话未保留全文，仅保留差异摘要（演示） */');
    const after = file.preview || '（无内容预览）';
    P.modal(
      '工作区文件 · ' + file.path,
      `<p class="muted">${e(file.kind === 'test' ? '测试文件' : file.kind === 'config' ? '配置' : '源码')} · ${e(file.lines)} · 作业 ${e(run.id)} · ${e(git.branch)}@${e(git.commit)}</p>` +
        `<div class="file-diff"><div class="diff-cols"><div><h4>${file.status === 'A' ? '新增前' : '变更前'}</h4><div class="code-preview dim">${e(before)}</div></div><div><h4>变更后</h4><div class="code-preview">${e(after)}</div></div></div></div>` +
        `<div class="ws-fail-log">${file.kind === 'code' ? '<div class="rail-title">失败定位日志（演示）</div><div class="term-box"><div class="term-line"><span class="err">ERROR  src/feature/service.ts:24  — 期望对象包含 notifiedAt，实际 undefined</span></div><div class="term-line"><span class="info">      at handleExpiryNotify (src/feature/service.ts:24:19)</span></div></div>' : '<p class="muted">该文件无失败定位日志。</p>'}</div>` +
        `<div class="btn-group">${b('download-workspace-file', i('download') + ' 下载文件内容', { id: run.id, file: file.path })}${b('close-modal', '返回')}</div>`,
      b('close-modal', '关闭'),
      true,
    );
  };
})();
