(() => {
  const P = window.PFC,
    { esc: e, icon: i, btn: b, badge, card } = P;
  const attIcon = (a) => {
    if (a.type === 'image') return 'image';
    if (a.type === 'pdf' || a.type === 'word' || a.type === 'sheet')
      return 'doc';
    if (a.type === 'text') return 'file';
    return 'clip';
  };
  const attBadge = (a) =>
    a.status === 'ready'
      ? badge('可引用', 'green')
      : a.status === 'parsing'
        ? badge('解析中', 'blue')
        : badge('解析失败', 'red');
  P.renderMsg = (m, r) => {
    const body = [];
    if (m.replyTo) {
      const target = r.messages.find((x) => x.id === m.replyTo);
      body.push(
        `<button type="button" class="msg-quote link" data-action="msg-source" data-id="${e(m.replyTo)}" title="查看引用来源消息">${e((target?.text || '原消息').slice(0, 60))}</button>`,
      );
    }
    body.push(`<div class="msg-text">${e(m.text || '')}</div>`);
    if (m.attachments?.length)
      body.push(
        `<div class="msg-atts">${m.attachments
          .map(
            (a) =>
              `<div class="att-card ${a.status === 'error' ? 'err' : ''}"><span class="att-ico">${i(attIcon(a))}</span><span class="att-name">${e(a.name)}</span><small>${e(a.size)}</small>${attBadge(a)}<div class="att-actions">${b('open-attachment', '预览', { id: a.id })}${a.error ? `<span class="att-err">${e(a.error)}</span>` : ''}</div></div>`,
          )
          .join('')}</div>`,
      );
    if (m.refs?.length)
      body.push(
        `<div class="msg-refs"><span class="ref-cap">本轮使用</span>${m.refs
          .map(
            (x, n) =>
              `<button type="button" class="ref-chip ref-link" data-action="ref-source" data-mid="${e(m.id)}" data-idx="${n}" title="查看引用来源">${i(x.kind === 'material' ? 'doc' : x.kind === 'code' ? 'code' : 'link')}${e(x.label)}</button>`,
          )
          .join('')}</div>`,
      );
    if (m.diff && !m.diffApplied && !m.diffRejected)
      body.push(
        `<div class="diff-card"><div class="diff-head">${i('code')} 字段级差异建议 ${b('diff-full', '完整视图', { mid: m.id }, 'ghost')}</div>${m.diff.fields
          .map(
            (f) =>
              `<div class="diff-field"><div class="diff-name">${e(f.name)}</div><div class="diff-row"><span class="diff-before">${e(f.before.slice(0, 220))}</span></div><div class="diff-row"><span class="diff-after">${e(f.after.slice(0, 220))}</span></div></div>`,
          )
          .join(
            '',
          )}<div class="btn-group">${b('accept-diff', '全部采纳为新版本', { mid: m.id }, 'primary')}${b('reject-diff', '拒绝建议', { mid: m.id })}</div><p class="source-note">采纳后生成新版本并使下游评审过期，可到画布查看差异。</p></div>`,
      );
    const actions = [];
    if (m.typing && m.role === 'ai')
      actions.push(b('stop-reply', '停止答复', { id: m.id }));
    if (m.role === 'user')
      actions.push(b('reply-message', '引用回复', { id: m.id }));
    if (
      m.role === 'user' &&
      ['failed', 'stopped'].includes(m.status) &&
      m.resent !== true
    )
      actions.push(b('resend-message', '重发（保留原文与附件）', { id: m.id }));
    if (m.status === 'stopped')
      body.push('<div class="msg-note">已停止生成（保留已输出部分）</div>');
    if (m.status === 'failed')
      body.push(`<div class="msg-note err">${e(m.error || '答复失败')}</div>`);
    if (m.proposal && !m.typing && m.status === 'ok')
      body.push(
        `<div class="btn-group">${b(m.proposal.action, m.proposal.label, { proposal: m.proposal.pid }, 'primary')}</div>`,
      );
    if (actions.length)
      body.push(`<div class="msg-actions">${actions.join('')}</div>`);
    return `<div class="msg ${m.role}"><div class="msg-avatar">${i(m.role === 'user' ? 'user' : 'sparkles')}</div><div class="msg-bubble ${m.typing ? 'typing' : ''}">${body.join('')}</div></div>`;
  };
  const hints = {
    idea: '先明确目标与边界，再确认需求草案。',
    req: '梳理 CAP / Unit 与验收标准，确认当前需求版本。',
    design: '对齐方案、依赖和实现范围，再发起本地作业。',
    dev: '在同一需求中跟进代码、Shell 和测试输出，随时补充信息或处理异常。',
    test: '把 AC 映射到测试与缺陷，保留失败结果并验证修复。',
    accept: '产品验收需负责人查看实际结果并记录结论。',
    release: '确认准确版本、环境和回滚；审批与执行分别记录。',
    observe: '完成观察窗口，记录实际指标、结论和后续事项。',
  };
  P.artifactCard = (r, stage) => {
    const raw = P.latest(r, stage) || {};
    const v = {
      title: raw.title ?? '（尚未生成版本）',
      id: raw.id ?? '—',
      fields: raw.fields ?? [],
      comments: raw.comments ?? [],
      confirmed: !!raw.confirmed,
      stale: !!raw.stale,
      version: raw.version ?? '0',
    };
    return card(
      i('file') + ' ' + e(v.title),
      `<p class="muted">${e(r.id)} · ${e(v.id)} · 材料基线 ${r.baseline}</p>` +
        `<table class="diff-table"><thead><tr><th>字段</th><th>当前内容</th></tr></thead><tbody>${v.fields.map((f) => `<tr><td class="field">${e(f.name)}</td><td class="doc-body">${e(f.value)}</td></tr>`).join('')}</tbody></table>` +
        `<div class="btn-group">${b('open-artifact', i('eye') + ' 查看 / 比较', { stage })}${b('edit-artifact', i('file') + (v.confirmed ? '创建后续草稿' : '编辑草稿'), { stage, disabled: !P.canWrite() })}${!v.confirmed || v.stale ? b('confirm-artifact', i('check') + ' 确认当前版本', { stage, id: v.id, disabled: !P.canWrite() }, 'primary') : ''}${b('review-artifact', '评审意见', { stage })}${b('download-artifact', i('download') + ' 下载当前版本', { stage, id: v.id })}</div>` +
        (v.comments.length
          ? `<div class="source-note">最近评审：${e(v.comments.at(-1).text)}</div>`
          : ''),
      badge(
        v.stale
          ? '需重新评审'
          : v.confirmed
            ? '已确认 ' + v.version
            : '待确认 v' + v.version,
        v.confirmed && !v.stale ? 'green' : 'blue',
      ),
    );
  };
  P.terminal = (r, run, panel = false) =>
    `<div class="${panel ? 'panel-term' : 'term-box'}" id="${panel ? 'panel-term' : 'mirror-term'}"><div class="t-head">${i('terminal')} ${e(run?.id || '尚未发起作业')} · ${e(r.workspace)} · ${e(run?.controller || 'Web')}</div>${run ? run.lines.map((l) => `<div class="term-line"><span class="${l.cls}">${e(l.text)}</span></div>`).join('') : '<div class="term-line">连接本地 Bridge 后，命令输出会在这里同步。</div>'}${run?.status === 'RUNNING' ? '<span class="term-cursor"></span>' : ''}<div class="source-note">${e(run ? P.labels[run.status] : '未开始')} · ${run?.exitCode === null || run?.exitCode === undefined ? '尚无退出码' : 'exit ' + run.exitCode} · ${e(run?._remote ? P.domain.source(run) : '原型模拟输出')}${run?._remote && window.PFCWS?.state !== 'connected' ? ' · 实时连接已断开，显示最后已知结果' : ''}</div></div>`;
  P.runCard = (r) => {
    const run = P.run(r);
    if (!run)
      return card(
        i('cpu') + ' 本地开发作业',
        `<p>将当前需求、已确认方案和工作区交给 Agent，按一次任务范围连续使用 Shell / 文件 / Git。</p><div class="btn-group">${b('plan-run', '准备作业范围', {}, 'primary')}</div>`,
      );
    const steps = [
      '读取需求与代码',
      '检查工作区',
      '实现代码与测试',
      '执行单元测试',
      '构建与预览',
      '汇总变更及证据',
    ];
    let controls = '';
    if (
      ['RUNNING', 'QUEUED', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(
        run.status,
      )
    )
      controls += b('run-control', '停止运行', {
        control: 'cancel',
        disabled: !P.canWrite(),
        title: '仅负责人或执行者可停止；取消后保留已输出记录',
      });
    if (['UNKNOWN', 'CANCELLED', 'FAILED'].includes(run.status))
      controls += b('run-control', '核验结果', {
        control: 'verify',
        disabled: !P.canWrite(),
      });
    if (['CANCELLED', 'FAILED'].includes(run.status) && run.verified)
      controls += b('plan-retry', '创建新尝试', { id: run.id }, 'primary');
    if (!run._remote && run.status === 'WAITING_INPUT')
      controls += b('run-input', '补充输入', {}, 'primary');
    if (!run._remote && run.status === 'WAITING_APPROVAL')
      controls += b('scope-approval', '查看新增范围', {}, 'primary');
    if (!run._remote && ['RUNNING', 'WAITING_INPUT'].includes(run.status))
      controls += b(
        'run-control',
        run.controller === 'Web' ? '交给 Zed 控制' : '取回 Web 控制',
        {
          control: 'handoff',
          title:
            '控制转移：Zed 会话镜像可接管运行，Web 保持观察；转移记录进审计',
        },
      );
    if (run.status === 'SUCCEEDED')
      controls +=
        b('plan-run', '发起新作业', {}, 'primary') +
        (run._remote
          ? ''
          : b('preview-toggle', run.preview ? '停止本地预览' : '启动本地预览'));
    if (!run._remote && run.preview) controls += b('preview-open', '查看预览');
    const history = `<div class="run-list">${r.runs.map((x) => b('select-run', e(x.id), { id: x.id }, x.id === run.id ? 'primary' : '')).join('')}</div>`;
    const pool = (() => {
      const all = Object.values(P.s.reqs).flatMap((q) =>
        q.runs.map((x) => ({ ...x, req: q.name })),
      );
      const running = all.filter((x) => x.status === 'RUNNING');
      const queued = all.filter((x) => x.status === 'QUEUED');
      const done = all.filter((x) =>
        ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(x.status),
      ).length;
      if (!running.length && !queued.length) return '';
      return card(
        i('layers') + ' 并行任务池',
        `<p class="muted">全局执行队列：并行上限 ${run.limit || 3} · 运行 ${running.length} · 排队 ${queued.length} · 已结束 ${done}</p>` +
          running
            .map(
              (x) =>
                `<div class="pool-row">${badge('运行中', 'cyan')}<span>${e(x.req)} · ${e(x.id)}</span><small>${e(x.operation)}</small></div>`,
            )
            .join('') +
          queued
            .map(
              (x) =>
                `<div class="pool-row">${badge('排队', 'gray')}<span>${e(x.req)} · ${e(x.id)}</span><small>${e(x.operation)}</small></div>`,
            )
            .join('') +
          `<p class="source-note">正式平台：任务池支持并行编排、优先级与资源配额；此处为全局队列快照演示。</p>`,
      );
    })();
    const git = run.git || P.gitMeta(r, 1);
    const queueLine = (() => {
      const activeN = Object.values(P.s.reqs)
        .flatMap((q) => q.runs)
        .filter((x) => x.status === 'RUNNING').length;
      const queuedN = Object.values(P.s.reqs)
        .flatMap((q) => q.runs)
        .filter((x) => x.status === 'QUEUED').length;
      return `<span class="queue-pos">执行队列 ${activeN}/${run.limit || 3} · 排队 ${queuedN}</span>`;
    })();
    return (
      pool +
      history +
      card(
        i('cpu') + ' AgentRun #' + e(run.id),
        `<p class="muted">${e(run.operation)} · ${e(r.workspace)} · 控制端 ${e(run.controller)}${run.parentId ? ' · 关联旧作业 ' + e(run.parentId) : ''}</p>` +
          `<div class="kv-row"><span>仓库</span><b>${e(git.repo)}</b></div><div class="kv-row"><span>分支 / 提交</span><b>${e(git.branch)} · ${e(git.commit)} ${git.dirty === null || git.dirty === undefined ? badge('工作区待核验', 'gray') : git.dirty ? badge('dirty', 'orange') : badge('干净', 'green')}</b></div><div class="kv-row"><span>队列 / 预算</span><b>${run._remote ? '未接入真实计量' : queueLine + ' · 预算 ' + Number(run.budget || 8000).toLocaleString() + ' 积分 · 已用 ' + Number(run.spent ?? Math.round(((run.pct || 0) / 100) * (run.budget || 8000))).toLocaleString()}</b></div><div class="kv-row"><span>控制 / 设备 / 租约</span><b>${e(run.controller)} 控制 · ${e(run.lease?.deviceName || '未绑定')} · ${run.lease?.state === 'lost' ? badge('租约失效', 'red') : run.lease?.state === 'active' ? badge('租约有效', 'green') : badge('租约未知', 'gray')}</b></div><div class="kv-row"><span>计划审批</span><b>${run.planApproved?.by ? badge('已批准 · ' + e(run.planApproved.by), 'green') : badge('未批准', 'orange')}</b></div>` +
          (run.qualityGates?.length
            ? `<div class="rail-title">质量门（客观检查）</div><div class="gate-list">${run.qualityGates
                .map(
                  (g) =>
                    `<div class="gate-item"><span>${e(g.name)}</span>${badge(
                      g.status,
                      g.status === '通过'
                        ? 'green'
                        : g.status === '失败'
                          ? 'red'
                          : 'gray',
                    )}</div>`,
                )
                .join('')}</div>`
            : '') +
          `<div class="progress-row"><div class="progress-bar"><div class="progress-fill" style="width:${run.pct}%"></div></div><span id="run-percent">${run.pct}%</span></div>` +
          `<div class="step-list">${steps.map((s, n) => `<div class="step-item ${n < run.step ? 'done' : n === run.step && run.status === 'RUNNING' ? 'active' : ''}"><span class="step-dot">${n < run.step ? i('check') : i('clock')}</span>${s}</div>`).join('')}</div>` +
          (run.status === 'UNKNOWN'
            ? P.notice('连接或页面中断后无法确认结果。核验旧作业后再决定重试。')
            : run.status === 'CANCELLING'
              ? P.notice('已请求取消，等待执行侧返回最终状态。')
              : '') +
          (run.stamp !== P.stamp(r) || r.rejectedRunIds?.includes(run.id)
            ? P.notice('该作业属于旧材料或方案版本，不能满足当前阶段退出条件。')
            : '') +
          `<div class="btn-group">${controls}${b('run-quality-gates', '运行质量门')}${b('replay-run', '回放执行')}${b('panel', '查看证据', { panel: 'evidence' })}</div>`,
        badge(
          P.labels[run.status],
          run.status === 'SUCCEEDED'
            ? 'green'
            : ['FAILED', 'UNKNOWN'].includes(run.status)
              ? 'red'
              : 'cyan',
        ),
      ) +
      (run.status === 'SUCCEEDED' && run.files?.length
        ? card(
            i('folder') + ' 工作区文件与变更',
            `<div class="ws-files">${run.files
              .map(
                (f) =>
                  `<div class="ws-file"><span class="ws-status ${e(f.status)}">${e(f.status)}</span><span class="ws-path">${e(f.path)}</span><small>${e(f.lines)}</small>${b('open-ws-file', '查看 / Diff', { id: run.id, file: f.path })}</div>`,
              )
              .join(
                '',
              )}</div><p class="source-note">正式接入由 Bridge 读回真实文件与 Git 差异，此处为演示数据。</p>`,
          )
        : '') +
      card(
        i('terminal') + ' Zed 对话流 · 实时镜像',
        P.terminal(r, run),
        badge(
          run.controller === 'Zed'
            ? 'Zed 控制 / Web 观察'
            : 'Web 控制 / Zed 镜像',
          'cyan',
        ),
      )
    );
  };
  P.testCard = (r) =>
    card(
      i('shield') + ' 测试执行与缺陷',
      `<p class="muted">提测基线 ${e(P.stamp(r))}。每条 AC 保留执行结果与缺陷关系。</p>` +
        P.table(
          ['验收标准', '结果', '实际结果', '执行'],
          (r.tests.length
            ? r.tests
            : r.acs.map((a) => ({ ...a, status: 'NOT_RUN' }))
          ).map((t) => [
            e(t.id + ' · ' + t.text),
            badge(
              t.status,
              t.status === 'PASS'
                ? 'green'
                : t.status === 'FAIL'
                  ? 'red'
                  : 'gray',
            ),
            e(t.actual || '尚未执行'),
            e(t.runId || '—'),
          ]),
        ) +
        `<div class="btn-group">${b('run-tests', '执行测试（演示）', {}, 'primary')}${b('run-tests', '演示测试失败', { fail: '1' })}${b('open-test-cases', '用例与提测说明')}</div>` +
        (r.testRuns?.length
          ? `<div class="test-history"><div class="rail-title">测试批次历史</div>${r.testRuns
              .slice(-5)
              .reverse()
              .map(
                (tr) =>
                  `<div class="event">${b('test-batch-detail', e(tr.id) + ' · ' + badge(tr.results.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS', tr.results.some((x) => x.status === 'FAIL') ? 'red' : 'green'), { id: tr.id }, 'ghost')}<small>${e(P.time(tr.at))} · 基线 ${e(tr.baseline)} · ${tr.results.map((x) => x.id + ':' + x.status).join('；')}</small></div>`,
              )
              .join('')}</div>`
          : '') +
        (r.defects.length
          ? P.table(
              ['缺陷', '关联 AC', '状态', '处理'],
              r.defects.map((d) => [
                e(d.id + ' · ' + d.title),
                e(d.ac),
                badge(d.status, d.status === 'CLOSED' ? 'green' : 'orange'),
                d.status === 'OPEN'
                  ? b('resolve-defect', '登记修复', { id: d.id })
                  : e(d.status === 'RESOLVED' ? '等待重新测试' : '已关闭'),
              ]),
            )
          : ''),
    );
  P.acceptCard = (r) => {
    const gates = (r.runs.at(-1)?.qualityGates || []).filter((g) => g.status);
    const gatesFail = gates.length && !gates.every((g) => g.status === '通过');
    return card(
      i('check') + ' 产品验收',
      `<p>负责人：${e(r.owner)}。测试通过与产品验收分别形成结论。</p>` +
        P.table(
          ['检查项', '证据'],
          [
            [
              '功能与 AC',
              e(
                r.tests.length
                  ? r.tests.map((t) => t.id + ': ' + t.status).join('；')
                  : '尚无测试结果',
              ),
            ],
            [
              '质量门',
              gates.length
                ? gates.map((g) => `${e(g.name)}·${e(g.status)}`).join('；')
                : '（旧记录无质量门）',
            ],
            ['版本与变更', e(P.stamp(r))],
            [
              '未接受风险',
              e(
                r.defects
                  .filter((d) => d.status !== 'CLOSED')
                  .map((d) => d.title)
                  .join('；') || '无未关闭缺陷',
              ),
            ],
          ],
        ) +
        (gatesFail
          ? P.notice('质量门未全绿，需回开发修复并重跑质量门后才能确认验收。')
          : '') +
        (r.accept?.status === 'ACCEPTED' && !r.tests.length
          ? P.notice(
              '检测到验收结论与测试记录不一致：验收已通过但无测试结果，需补测试门禁证据。',
            )
          : r.accept?.status === 'ACCEPTED' &&
              r.defects.some((d) => d.status !== 'CLOSED')
            ? P.notice('检测到验收结论与缺陷状态不一致：存在未关闭缺陷。')
            : '') +
        `<div class="btn-group">${b('accept-review', '填写验收结论', {}, 'primary')}${b('run-quality-gates', '运行质量门')}${b('accept-reject', '驳回并返回开发', {}, 'danger')}</div>` +
        (r.accept
          ? `<p class="doc-body">${e(r.accept.status + ' · ' + r.accept.actor + ' · ' + r.accept.note)}</p>`
          : ''),
    );
  };
  P.releaseCard = (r) => {
    const rel = r.release,
      expired = rel && rel.expiresAt <= P.now();
    const snapshotRows = (snap) =>
      snap
        ? [
            ['冻结基线', e(snap.stamp)],
            [
              '产物版本',
              e(
                snap.artifacts
                  ? Object.values(snap.artifacts).join(' / ')
                  : '—',
              ),
            ],
            [
              '作业 / 测试',
              e((snap.runId || '—') + ' / ' + (snap.testRunId || '—')),
            ],
            ['验收 / 目标', e(snap.acceptId + ' · ' + (snap.target || '—'))],
          ]
        : [];
    const changedAfterApproval =
      rel &&
      rel.status === 'APPROVED' &&
      rel.snapshot &&
      rel.snapshot.stamp !== P.stamp(r);
    return card(
      i('shield') + ' 发布准备与审批',
      (rel
        ? P.table(
            ['字段', '本次发布'],
            [
              ['发布记录', e(rel.id)],
              ['环境', e(rel.target)],
              ['范围', e(rel.scope)],
              ['版本', e(rel.stamp)],
              ['回滚', e(rel.rollback)],
              ['观察窗口', rel.hours + ' 小时'],
              [
                '审批有效期',
                expired ? badge('已过期', 'red') : e(P.time(rel.expiresAt)),
              ],
              ...snapshotRows(rel.snapshot),
            ],
          )
        : '<p>先填写目标、范围、回滚与观察窗口，提交后由负责人批准。</p>') +
        `<div class="btn-group">${b('release-form', rel ? '重新准备 / 申请' : '填写发布准备')}${rel?.status === 'PENDING' ? b('release-action', '批准范围', { control: 'approve' }, 'primary') + b('release-action', '拒绝', { control: 'reject' }, 'danger') : ''}${rel?.status === 'APPROVED' ? b('release-action', '执行发布（演示）', { control: 'execute', disabled: expired }, 'primary') : ''}${['APPROVED', 'FAILED'].includes(rel?.status) ? b('run-cicd', '执行 CI/CD（演示）') : ''}${['FAILED', 'SUCCEEDED'].includes(rel?.status) ? b('release-action', '执行回滚（演示）', { control: 'rollback' }, 'danger') : ''}</div>` +
        (rel?.cicd
          ? `<div class="rail-title">CI/CD 流水线 · ${e(rel.cicd.status)} ${rel.cicd.at ? '· ' + e(P.time(rel.cicd.at)) : ''}</div><div class="cicd-steps">${rel.cicd.steps
              .map(
                (s) =>
                  `<div class="cicd-step"><span class="cicd-dot">${s.status === '通过' ? '✓' : '○'}</span>${e(s.name)}${badge(
                    s.status,
                    s.status === '通过' ? 'green' : 'gray',
                  )}</div>`,
              )
              .join(
                '',
              )}</div><p class="source-note">正式接入 CI 平台（如 GitLab CI / Jenkins）自动执行与回填；此处为原型模拟。</p>`
          : '') +
        (rel?.status === 'APPROVED'
          ? P.notice(
              changedAfterApproval
                ? '审批后产物或基线已变化，原审批快照失效，执行会被拒绝；请重新申请发布审批。'
                : '已批准并冻结快照，尚未执行。审批后产物变化会使快照失效。',
            )
          : rel?.status === 'STALE'
            ? P.notice(
                '产物或基线已变化，原审批已失效；请重新准备并申请发布审批。',
                'release-form',
                '重新准备',
              )
            : rel?.status === 'FAILED'
              ? P.notice('发布失败。保留失败证据，可回滚并重新准备发布。')
              : '') +
        (rel?.status === 'APPROVED' && rel.snapshot
          ? `<p class="source-note">冻结快照于 ${e(P.time(rel.snapshot.frozenAt))} 生成；执行前若产物变化将拒绝执行。</p>`
          : '') +
        (r.releaseHistory.length
          ? `<div class="release-history"><div class="rail-title">历史发布记录</div>${r.releaseHistory
              .slice(-5)
              .reverse()
              .map(
                (x) =>
                  `<div class="event">${b('release-snapshot', e(x.id + ' · ' + x.status), { id: x.id })}<small>${e(x.target + ' · ' + (x.snapshot?.stamp || x.stamp || '—'))}</small></div>`,
              )
              .join('')}</div>`
          : ''),
      badge(
        rel
          ? expired && ['PENDING', 'APPROVED'].includes(rel.status)
            ? 'EXPIRED'
            : rel.status
          : '未申请',
        rel?.status === 'SUCCEEDED' ? 'green' : 'orange',
      ),
    );
  };
  P.observeCard = (r) => {
    const o = r.observation,
      elapsed = o ? Math.max(0, (P.now() - o.startedAt) / 3600000) : 0;
    return card(
      i('activity') + ' 观察与复盘',
      `<p>观察窗口：${elapsed.toFixed(1)} / ${o?.hours || 24} 小时。${r.closed ? '本需求已完成复盘。' : '完成窗口并记录指标后，可提交最终结论。'}</p>` +
        P.table(
          ['记录', '内容'],
          [
            ['发布版本', e(r.release?.stamp || '暂无发布记录')],
            [
              '冻结快照',
              e(
                r.observation?.releaseSnapshot?.stamp ||
                  r.release?.snapshot?.stamp ||
                  '未生成',
              ),
            ],
            ['回滚准备', e(r.release?.rollback || '—')],
            [
              '异常 / 回滚',
              o?.anomaly
                ? e(o.anomaly.reason + ' · ' + P.time(o.anomaly.at))
                : '无异常',
            ],
            ['最终结论', e(o?.conclusion || '尚未提交')],
            [
              '数据接入',
              '数仓 / 埋点自动拉取（正式接入）；当前为手工录入（演示）',
            ],
          ],
        ) +
        `<div class="rail-title">指标看板（观察期）</div><div class="metric-grid">${[
          ['页面访问（PV）', o?.entries?.length ? 12840 : 11820, '+8.6%'],
          ['核心转化率', '3.2%', '+0.4pt'],
          ['缺陷密度 / 千行', 0.9, '−0.3'],
          ['回滚次数', o?.anomaly ? 1 : 0, o?.anomaly ? '需关注' : '0'],
        ]
          .map(
            (m) =>
              `<div class="metric-cell"><span>${e(m[0])}</span><b>${e(m[1])}</b><small class="${m[2].startsWith('−') || m[2] === '0' ? 'ok' : ''}">${e(m[2])}</small></div>`,
          )
          .join(
            '',
          )}</div><p class="source-note">演示指标，不声称真实业务数据；正式接入由数仓 / 埋点自动拉取并按需求维度聚合。</p>` +
        (o?.entries?.length
          ? `<div class="rail-title">观测记录（${o.entries.length} 次）</div>` +
            P.table(
              ['时间', '指标与来源', '发布版本'],
              o.entries
                .slice(-5)
                .reverse()
                .map((x) => [
                  e(P.time(x.at)),
                  e((x.metrics || '').slice(0, 60)),
                  e(x.releaseStamp || '—'),
                ]),
            )
          : '') +
        (o?.followups?.length
          ? `<div class="rail-title">后续事项</div>` +
            P.table(
              ['事项', '负责人', '状态'],
              o.followups.map((x) => [
                e(x.text),
                e(x.owner) +
                  (x.ownerNote
                    ? ` <small class="owner-warn">${e(x.ownerNote)}</small>`
                    : ''),
                badge(
                  x.status,
                  x.status === '已完成'
                    ? 'green'
                    : x.status === '进行中'
                      ? 'cyan'
                      : 'orange',
                ),
              ]),
            )
          : '') +
        `<div class="btn-group">${b('observe-form', '记录指标与复盘', {}, 'primary')}${r.release?.status === 'SUCCEEDED' && !r.closed ? b('release-action', '异常：回滚发布', { control: 'rollback' }, 'danger') : ''}</div>` +
        `<p class="source-note">演示时间可在顶部“原型场景”推进；正式产品依照真实观察时间与指标来源判断。</p>`,
      badge(r.closed ? '已完成' : '观察中', r.closed ? 'green' : 'cyan'),
    );
  };
  P.renderWork = () => {
    const r = P.r();
    if (!r) return P.emptySpace();
    const u = P.s.ui,
      stage = u.stage,
      run = P.run(r),
      actual = P.index(r.stage);
    const rail =
      `<aside class="ctx-rail"><div class="rail-section"><div class="req-name">${e(r.name)}</div><p class="muted">${e(r.id)}</p>${badge(P.stageName(r.stage) + (r.closed ? ' · 已完成' : ' · 进行中'), 'orange')}<div class="btn-group">${b('switch-req', i('box') + ' 切换需求')}</div><div class="meta-row">${i('user')} ${e(r.owner)} · 基线 ${r.baseline}</div><div class="stage-rail">${P.D.STAGES.map((s, n) => `<button class="stage-node ${n < actual ? 'passed ' : ''}${s.id === stage ? 'active ' : ''}${s.id === r.stage ? 'current' : ''}" data-action="view-stage" data-stage="${s.id}" aria-current="${s.id === stage ? 'step' : 'false'}"><span class="stage-dot">${s.dot}</span><span>${s.label}</span>${s.id === r.stage ? '<small class="stage-label">当前</small>' : s.id === stage ? '<small class="stage-label">查看</small>' : ''}</button>`).join('')}</div></div>` +
      `<div class="rail-section"><div class="rail-title">上下文 · ${P.stageName(stage)}</div><div class="ctx-list">${r.materials
        .filter((m) => m.status !== '排除')
        .map((m) =>
          b('material-detail', i('file') + ' ' + e(m.name), { id: m.id }),
        )
        .join(
          '',
        )}</div><div class="btn-group">${b('add-material', '添加材料')}</div>${(() => {
        const pj = r._pg
          ? r.project
          : P.s.projects?.find((p) => p.id === r.projectId);
        const name = pj?.name || r.workspace;
        const srcBadge = pj
          ? badge(
              pj.source === 'existing' ? '现有系统迭代' : '全新项目',
              pj.source === 'existing' ? 'cyan' : 'gray',
            )
          : badge(r._pg ? '未关联' : '全新项目', 'gray');
        return (
          `<p class="rail-title">关联项目</p><div class="project-card"><div class="project-head"><b>${e(name)}</b>${srcBadge}</div>` +
          (pj
            ? `<p class="muted">${e(pj.path)}</p><div class="kv-row"><span>分支</span><b>${e(pj.branch)}</b></div><div class="kv-row"><span>技术栈</span><b>${e(pj.tech.join(' / '))}</b></div><div class="kv-row"><span>文件 / 加载</span><b>${r._pg ? '已登记，未扫描' : (pj.files || '—') + ' 个文件'} · ${P.time(pj.loadedAt)}</b></div>`
            : `<p class="muted">${e(r.workspace)}</p><p class="muted">${r._pg ? '可选择已登记项目作为后续计划输入' : '从零创建，开发时初始化项目骨架'}</p>`) +
          `<div class="btn-group">${b('attach-project', '切换 / 加载项目')}</div></div>`
        );
      })()}<p class="muted">${e(r.capId)} · ${r.units.length} Units</p>${(() => {
        const refs = r._pg
          ? (r.knowledgeRefs || []).map((k) => ({
              ...k,
              content: k.summary + ' · ' + k.reason,
            }))
          : (r.knowledgeRefs || [])
              .map((id) => P.s.knowledge.find((k) => k.id === id))
              .filter(Boolean);
        return refs.length
          ? `<p class="rail-title">知识库引用（自动检索 ${refs.length} 条）</p>` +
              refs
                .map(
                  (k) =>
                    `<div class="kn-ref">${badge(k.type, 'purple')} <span title="${e(k.content)}">${e(k.title)}</span></div>`,
                )
                .join('')
          : '';
      })()}${b('space-tab', '关系追踪', { tab: 'trace' })}</div>` +
      `<div class="rail-section"><div class="rail-title">本阶段启用能力</div><div class="bind-cell">${
        (function () {
          const c = P.s.stageCaps?.[stage];
          if (!c) return '<p class="muted">阶段能力未配置</p>';
          let html = '<p class="muted" style="font-size:11px;line-height:1.4" title="' + e(c.goal) + '">' + e(c.goal) + '</p>';
          if (Array.isArray(c.skills) && c.skills.length) html += c.skills.map((sk) => '<span class="skill-chip">' + e(sk) + '</span>').join('');
          else if (Array.isArray(c.skills)) html += '<p class="muted" style="font-size:11px;margin-top:2px">本机无匹配能力</p>';
          if (Array.isArray(c.tools) && c.tools.length) html += '<p class="muted" style="font-size:11px;margin-top:4px">工具：' + e(c.tools.join('、')) + '</p>';
          return html;
        })()
      }${
        (function () {
          const eff = P.effective(r, stage);
          if (!eff.length) return '';
          return '<div class="rail-sub">已装载</div>' + eff.map((c) => '<span class="skill-chip on">' + i('check') + e(c.name) + '</span>').join('');
        })()
      }</div></div></aside>`;
    let content =
      stage === 'dev'
        ? P.runCard(r)
        : ['idea', 'req', 'design'].includes(stage)
          ? P.artifactCard(r, stage)
          : stage === 'test'
            ? P.testCard(r)
            : stage === 'accept'
              ? P.acceptCard(r)
              : stage === 'release'
                ? P.releaseCard(r)
                : P.observeCard(r);
    if (stage === 'idea')
      content =
        card(
          i('alert') + ' 需要澄清',
          r.questions
            .map(
              (q) =>
                `<div class="clarify-q ${q.answer ? 'picked' : ''}"><span class="num">${q.answer ? i('check') : '?'}</span><div class="txt">${e(q.text)}<p class="muted">${e(q.answer || '待回答')}</p></div>${b('answer-question', q.answer ? '修改回答' : '回答', { id: q.id })}</div>`,
            )
            .join(''),
        ) + content;
    if (stage === 'req')
      content += card(
        i('layers') + ' CAP / Unit 与验收标准',
        (() => {
          const cs = P.capStatus(r);
          const rows = (uids) =>
            r.units
              .filter((x) => uids.includes(x.id))
              .map((x) => [
                e(x.id),
                e(x.name),
                e(x.owner || r.owner) +
                  (x.ownerNote
                    ? ` <small class="owner-warn">${e(x.ownerNote)}</small>`
                    : ''),
                e(x.dep || '—'),
                badge(
                  x.status,
                  x.status === '已实现' || x.status === '已完成'
                    ? 'green'
                    : x.status === '进行中'
                      ? 'cyan'
                      : 'gray',
                ),
              ]);
          return (
            cs.caps
              .map(
                (c) =>
                  `<div class="cap-block"><div class="cap-block-head">${i('layers')} <b>${e(c.id)}</b> · ${e(c.name)} ${badge(c.done ? '已完成' : '进行中', c.done ? 'green' : 'orange')}</div>${P.table(['Unit', '名称', '负责人', '依赖', '状态'], rows(c.unitIds))}</div>`,
              )
              .join('') +
            `<div class="cap-aggregate ${cs.blocked.length ? 'warn' : 'ok'}">聚合 · ${cs.done}/${cs.total} CAP 完成${cs.blocked.length ? '；未完成：' + e(cs.blocked.join('、')) : '；全部完成，可进入下游评审'}</div>` +
            `<p class="source-note">${r.acs.map((a) => e(a.id + ' ' + a.text)).join('<br>')}</p><div class="btn-group">${b('edit-scope', '维护拆解与 AC')}</div>`
          );
        })(),
      );
    if (stage === 'dev' && run?.status === 'SUCCEEDED')
      content += P.artifactCard(r, 'dev');
    const stageAll = !!u.stageAll;
    const filterBar = `<div class="msg-filter" role="group" aria-label="消息范围">${b('toggle-stage-all', '仅当前阶段', { all: '0' }, !stageAll ? 'primary' : '')}${b('toggle-stage-all', '全部阶段', { all: '1' }, stageAll ? 'primary' : '')}</div>`;
    let msgs;
    if (!stageAll) {
      msgs = r.messages
        .filter((m) => m.stage === stage)
        .map((m) => P.renderMsg(m, r))
        .join('');
    } else {
      const visible = u.expandAll ? r.messages : r.messages.slice(-40);
      const byStage = {};
      for (const m of visible) (byStage[m.stage] ||= []).push(m);
      msgs =
        P.D.STAGES.map((st) =>
          byStage[st.id]
            ? `<div class="stage-group"><div class="stage-group-title">${e(P.stageName(st.id))} · ${byStage[st.id].length} 条</div>${byStage[st.id].map((m) => P.renderMsg(m, r)).join('')}</div>`
            : '',
        ).join('') +
        (!u.expandAll && r.messages.length > 40
          ? `<div class="btn-group">${b('expand-early-msgs', '展开更早 ' + (r.messages.length - 40) + ' 条消息')}</div>`
          : '');
    }
    const intro = `<div class="msg ai"><div class="msg-avatar">${i('sparkles')}</div><div class="msg-bubble">${e(hints[stage])}<div class="source-note">${e(P.gates[stage])} · 当前需求 ${e(r.id)}</div></div></div>`;
    const blocks = P.blockers(r),
      isCurrent = stage === r.stage;
    const footer = `<div class="stage-footer"><span>${!isCurrent ? '正在查看 ' + P.stageName(stage) + '，当前阶段仍为 ' + P.stageName(r.stage) : r.closed ? '已完成本需求复盘' : blocks.length ? '待完成：' + e(blocks.join('；')) : '本阶段条件已满足'}</span>${!isCurrent ? b('view-stage', '返回当前阶段', { stage: r.stage }) : P.index(stage) < 6 ? b('advance', '进入' + P.stageName(P.D.STAGES[P.index(stage) + 1].id), { disabled: blocks.length || !P.canWrite(), title: blocks.join('；') }, 'primary') : ''}</div>`;
    const bag = P.uiBag(),
      refs = bag.refs,
      queue = bag.atts;
    const replyLine = bag.reply
      ? (() => {
          const t = r.messages.find((x) => x.id === bag.reply);
          return `<div class="reply-tray">${i('link')} 正在回复：<span class="reply-text">${e((t?.text || '原消息').slice(0, 60))}</span>${b('clear-reply', '取消', {}, 'ghost')}</div>`;
        })()
      : '';
    const composerExtra =
      replyLine +
      (refs.length
        ? `<div class="ref-tray">${refs
            .map(
              (x, n) =>
                `<span class="ref-chip ${x.excluded ? 'off' : ''}">${i(x.kind === 'material' ? 'doc' : 'link')}${e(x.label)}${b('toggle-ref', x.excluded ? '启用' : '排除', { idx: n })}</span>`,
            )
            .join('')}<span class="ref-cap">随消息引用</span></div>`
        : '') +
      (queue.length
        ? `<div class="attach-tray">${(() => {
            const bytes = queue.reduce((n, a) => n + (a.bytes || 0), 0);
            const sizeTxt =
              bytes >= 1048576
                ? (bytes / 1048576).toFixed(1) + ' MB'
                : Math.max(1, Math.round(bytes / 1024)) + ' KB';
            const pct = Math.min(100, (bytes / (50 * 1048576)) * 100);
            return (
              `<div class="att-cap"><span>附件 ${queue.length}/20 件 · ${sizeTxt} / 50 MB</span><div class="att-cap-bar" aria-hidden="true"><div class="att-cap-fill" style="width:${pct}%"></div></div></div>` +
              queue
                .map(
                  (a, n) =>
                    `<div class="att-card ${a.status === 'error' ? 'err' : ''} ${a.status === 'parsing' ? 'busy' : ''}"><span class="att-ico">${i(attIcon(a))}</span><span class="att-name">${e(a.name)}</span><small>${e(a.size)}</small>${attBadge(a)}<div class="att-actions">${a.status === 'error' ? b('retry-pending', '重试', { idx: n }) + b('open-attachment', '查看 / 恢复', { id: a.id }) : b('open-attachment', '预览', { id: a.id })}${b('remove-pending', '移除', { idx: n })}</div></div>`,
                )
                .join('')
            );
          })()}<span class="ref-cap">待发送附件</span></div>`
        : '');
    return P.workbenchShell.frame({
      context: r.id + ':' + stage,
      rail,
      main: `<main class="chat-main"><div class="req-context-bar"><strong class="name">${e(r.id + ' · ' + r.name)}</strong>${badge('阶段 · ' + P.stageName(r.stage))}${!isCurrent ? badge('查看 · ' + P.stageName(stage), 'gray') : ''}${badge('Owner ' + r.owner, 'gray')}${b('navigate', '返回工作台', { route: 'home' })}</div><div class="stream" id="stream">${r.impact ? P.notice('材料已有新版本，需评估对当前范围和产物的影响。', 'material-impact', '评估影响') : ''}${intro}${content}${filterBar}${msgs}</div>${footer}<div class="composer">${composerExtra ? `<div class="composer-context" tabindex="0" aria-label="待发送附件与引用">${composerExtra}</div>` : ''}${P.s.env?.execCapable && P.s.ui.stage === 'dev' ? `<div class="exec-bar"><span class="exec-cap">${i('cpu')} 开发执行（Codex · 受限读 · 受控计划）</span><input id="exec-workspace" placeholder="本地项目目录，如 D:/projects/demo" value="${e(P.s.ui.execWorkspace || '')}" aria-label="开发执行项目目录" /><input id="exec-restricted" placeholder="受限读目录（可选，逗号分隔）" value="${e((P.s.ui.execRestrictedDirs || []).join(', '))}" aria-label="受限读目录" /><details class="exec-control"><summary>受控执行计划（D5）</summary><label class="exec-field">模式<select id="exec-control-mode"><option value="strict" ${P.s.ui.execControl?.mode !== 'readonly' ? 'selected' : ''}>strict · 允许清单</option><option value="readonly" ${P.s.ui.execControl?.mode === 'readonly' ? 'selected' : ''}>readonly · 只读复核</option></select></label><label class="exec-field">允许文件（相对 workspace，逗号分隔）<input id="exec-control-files" value="${e((P.s.ui.execControl?.allowedFiles || ['workspace/**']).join(', '))}" aria-label="允许文件清单" /></label><label class="exec-field">允许命令（审计，逗号分隔）<input id="exec-control-cmds" value="${e((P.s.ui.execControl?.allowedCommands || []).join(', '))}" aria-label="允许命令清单" placeholder="如 node --test" /></label><span class="exec-hint">发送即按计划冻结；执行后差异超出允许清单将被拒绝并回滚到基线</span></details><span class="exec-hint">填写路径后发送即触发开发终端作业，输出实时回到对话流</span></div>` : ''}<div class="composer-row">${P.domainView?.pg() ? `<button class="attch-btn real-toggle ${P.s.ui.realMode ? 'on' : ''}" data-action="toggle-real-mode" aria-label="真实 AI 模式" title="真实 AI：调用本机 Codex 生成回复（消耗模型预算；未配置时会明确失败）"><span class="real-toggle-dot"></span><span class="real-toggle-label">${P.s.ui.realMode ? '真实' : '模拟'}</span></button>` : ''}<button class="attch-btn" data-action="attach-menu" aria-label="添加附件" title="添加附件 / 引用上下文">${i('clip')}</button><div class="composer-box"><textarea id="chat-input" rows="1" aria-label="继续对话" placeholder="继续对话：描述意图、追问、或让 Agent 发起作业…（支持拖拽 / 粘贴截图）">${e(P.s.ui.drafts[r.id] || '')}</textarea></div><button class="send-btn" data-action="send" aria-label="发送" ${!P.canWrite() || queue.some((a) => a.status !== 'ready') ? 'disabled' : ''}>${i('send')}</button></div></div></main>`,
      panel: P.renderPanel(r),
    });
  };
  P.renderPanel = (r) => {
    const u = P.s.ui,
      run = P.run(r),
      stage = u.artifactStage || u.stage,
      versions = r.artifacts[stage],
      v = versions.find((x) => x.id === u.version) || versions.at(-1);
    let body;
    if (u.panel === 'terminal')
      body = `<div class="panel-title">${i('terminal')} 开发终端 · 实时镜像（Codex / Zed）</div>${P.terminal(r, run, true)}<div class="btn-group">${b('panel', '执行范围与证据', { panel: 'evidence' })}</div>`;
    else if (u.panel === 'canvas')
      body = `<div class="panel-title">${i('eye')} ${e(v.title)} · v${v.version}</div><label class="form-field">产物版本<select id="version-select">${versions.map((x) => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>v${x.version} · ${x.confirmed ? '已确认' : '草稿'}</option>`).join('')}</select></label>${badge(v.stale ? '需重新评审' : v.confirmed ? '已确认' : '待确认', v.confirmed && !v.stale ? 'green' : 'blue')}<div class="doc-body">${v.fields.map((f) => `<section class="doc-section"><h3>${e(f.name)}</h3>${e(f.value)}</section>`).join('')}</div><div class="btn-group">${b('focus-artifact', '聚焦阅读', { stage, id: v.id })}${b('compare-artifact', '版本比较', { stage })}${b('edit-artifact', '创建 / 编辑草稿', { stage })}${b('download-artifact', i('download') + ' 下载', { stage, id: v.id })}</div>`;
    else
      body = `<div class="panel-title">${i('list')} 当前作业与证据</div>${P.table(
        ['关联', '记录'],
        [
          ['需求', e(r.id)],
          [
            'CAP / Unit',
            e(r.capId + ' / ' + r.units.map((x) => x.id).join(', ')),
          ],
          ['作业', e(run?.id || '未创建')],
          ['基线', e(run?.stamp || P.stamp(r))],
          ['工作区', e(r.workspace)],
          ['状态', e(run ? P.labels[run.status] : '未开始')],
          ['授权范围', e(run?.scope || '尚未授权')],
          [
            '能力快照',
            e(
              run?.snapshot.map((c) => c.name + ' ' + c.version).join('；') ||
                '示例初始作业',
            ),
          ],
          ['退出码', e(run?.exitCode ?? '未知')],
          ['数据源', '原型演示，无真实外部执行'],
        ],
      )}<div class="btn-group">${b('export-evidence', '导出证据摘要')}${b('mcp-read', '调用只读 MCP（演示）')}</div><div class="event-list">${r.timeline
        .slice(-8)
        .reverse()
        .map(
          (x) =>
            `<div class="event"><b>${e(x.action)}</b><small>${e(x.detail)} · ${P.time(x.time)}</small></div>`,
        )
        .join('')}</div>`;
    return P.workbenchShell.panel({ selected: u.panel, body });
  };
})();
