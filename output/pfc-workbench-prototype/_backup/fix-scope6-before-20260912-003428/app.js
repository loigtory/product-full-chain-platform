(() => {
  const P = window.PFC,
    { esc: e, btn: b, icon: i } = P,
    A = P.actions;
  P.raws = P.raws || {};
  const routes = new Set(['home', 'work', 'product', 'delivery', 'gov']);
  P.go = (patch) => {
    Object.assign(P.s.ui, patch);
    if (!P.s.reqs[P.s.ui.req]) P.s.ui.req = Object.keys(P.s.reqs)[0] || '';
    const u = P.s.ui;
    const q = new URLSearchParams();
    for (const k of [
      'req',
      'stage',
      'panel',
      'productTab',
      'govTab',
      'artifactStage',
      'version',
      'runId',
    ])
      if (u[k]) q.set(k, u[k]);
    const hash = '#/' + u.route + '?' + q;
    if (location.hash !== hash) history.pushState(null, '', hash);
    if (!P.conflict) P.save();
    P.render();
  };
  function parse() {
    const [path, query = ''] = location.hash.slice(2).split('?');
    const route = routes.has(path) ? path : 'home';
    P.s.ui.route = route;
    const params = new URLSearchParams(query);
    for (const k of [
      'req',
      'stage',
      'panel',
      'productTab',
      'govTab',
      'artifactStage',
      'version',
      'runId',
    ])
      if (params.has(k)) P.s.ui[k] = params.get(k);
    const u = P.s.ui;
    if (!P.s.reqs[u.req]) u.req = Object.keys(P.s.reqs)[0] || '';
    if (P.index(u.stage) < 0) u.stage = P.r()?.stage || 'idea';
    if (!['terminal', 'canvas', 'evidence'].includes(u.panel))
      u.panel = 'terminal';
    if (P.index(u.artifactStage) < 0) u.artifactStage = null;
    if (
      !['requirements', 'materials', 'artifacts', 'trace', 'timeline'].includes(
        u.productTab,
      )
    )
      u.productTab = 'requirements';
    if (!['catalog', 'bind', 'team', 'workspace', 'audit'].includes(u.govTab))
      u.govTab = 'catalog';
  }
  P.render = ({ quiet = false } = {}) => {
    const app = document.querySelector('#app'),
      old = app.querySelector('.work-layout')?.dataset.context,
      context = P.s.ui.req + ':' + P.s.ui.stage;
    const scrolls =
      old === context
        ? [
            '#stream',
            '.ctx-rail',
            '.panel-body',
            '#panel-term',
            '#mirror-term',
          ].map((s) => [s, document.querySelector(s)?.scrollTop || 0])
        : [];
    const focus = document.activeElement,
      focusId = focus?.id,
      selection = focus?.selectionStart;
    const active = P.s.ui.route === 'work' ? 'home' : P.s.ui.route;
    document.querySelector('#global-header').innerHTML =
      `<div class="brand"><span class="brand-mark">${i('zap')}</span>PFC 产品全链路</div><nav class="main-nav" aria-label="主导航">${[
        ['home', '我的工作台', 'home'],
        ['product', '产品空间', 'box'],
        ['delivery', '交付中心', 'git'],
        ['gov', '治理中心', 'shield'],
      ]
        .map(
          ([id, text, icon]) =>
            `<button class="nav-item ${active === id ? 'active' : ''}" data-action="navigate" data-route="${id}">${i(icon)}${text}</button>`,
        )
        .join(
          '',
        )}</nav><div class="header-right"><button class="search-box" data-action="search">${i('search')} 全局搜索 / 命令</button><button class="icon-btn" data-action="notifications" aria-label="通知">${i('bell')}</button><button class="demo-tag" data-action="scenarios">交互原型 · 场景切换</button><span class="avatar" title="${P.s.role === 'viewer' ? '只读体验' : '负责人体验'}">${P.s.role === 'viewer' ? '读' : '陈'}</span></div>`;
    const notice = P.conflict
      ? P.notice(
          '另一窗口已更新。为避免覆盖，当前只读；草稿保留。',
          'reload-state',
          '载入最新记录',
        )
      : P.storageError
        ? P.notice('浏览器存储不可用，当前更改只能保留在此页面。')
        : P.s.role === 'viewer'
          ? P.notice(
              '当前以只读成员体验，可查看记录，修改操作会被阻止。',
              'scenarios',
              '切换体验角色',
            )
          : '';
    const blocked = P.stateView();
    app.innerHTML =
      notice +
      (blocked ||
        (P.s.ui.route === 'work'
          ? P.renderWork()
          : P.s.ui.route === 'home'
            ? P.renderHome()
            : P.s.ui.route === 'product'
              ? P.renderProduct()
              : P.s.ui.route === 'delivery'
                ? P.renderDelivery()
                : P.renderGovernance()));
    scrolls.forEach(([s, y]) => {
      const el = document.querySelector(s);
      if (el) el.scrollTop = y;
    });
    if (focusId && focus?.closest('#app')) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(selection, selection);
        } catch {}
      }
    }
    if (!quiet)
      document.title =
        'PFC · ' +
        (P.s.ui.route === 'work'
          ? P.r()?.name || '需求工作区'
          : {
              home: '我的工作台',
              product: '产品空间',
              delivery: '交付中心',
              gov: '治理中心',
            }[P.s.ui.route]);
  };
  A.send = () => {
    P.write();
    const q = P.r(),
      bag = P.uiBag(),
      input = document.querySelector('#chat-input'),
      text = input.value.trim();
    const queue = bag.atts;
    P.assert(text || queue.length, '请输入内容，或通过附件选择文件后发送');
    P.assert(text.length <= 8000, '单条输入不超过 8000 字');
    P.assert(
      !queue.some((a) => a.status === 'error'),
      '有附件解析失败，请先移除或重试后再发送',
    );
    for (const m of q.messages)
      if (m.typing) {
        m.text = m.full;
        m.typing = false;
        m.status = m.status === 'stopping' ? 'stopped' : 'ok';
      }
    const turnId = 'T-' + ++P.s.seq;
    const refs = bag.refs
      .filter((x) => !x.excluded)
      .map((x) => ({ ...x }));
    const userMsg = {
      id: 'MSG-' + ++P.s.seq,
      turnId,
      role: 'user',
      stage: P.s.ui.stage,
      text,
      attachments: queue.map((a) => ({ ...a })),
      refs,
      replyTo: bag.reply || null,
      status: 'ok',
      error: '',
    };
    q.messages.push(userMsg);
    P.s.ui.drafts[q.id] = '';
    bag.atts = [];
    bag.refs = [];
    bag.reply = null;
    let proposal = null;
    if (/代码|开发|构建|shell|执行命令/i.test(text) && q.stage === 'dev')
      proposal = { action: 'plan-run', label: '查看本地作业范围' };
    else if (/测试/.test(text) && q.stage === 'test')
      proposal = { action: 'run-tests', label: '执行本阶段测试（演示）' };
    else if (/预览/.test(text) && P.run(q)?.status === 'SUCCEEDED')
      proposal = { action: 'preview-toggle', label: '切换本地预览' };
    else if (/草稿|文档|方案/.test(text))
      proposal = { action: 'generate-draft', label: '查看产物修改建议' };
    if (proposal) {
      const v = P.latest(q, P.s.ui.stage);
      proposal.stage = P.s.ui.stage;
      proposal.versionId = v?.id;
      proposal.runId = P.s.ui.runId;
      proposal.stamp = P.stamp(q);
      proposal.at = P.now();
      proposal.pid = 'PR-' + ++P.s.seq;
      P.proposals = P.proposals || {};
      P.proposals[proposal.pid] = proposal;
    }
    const diff = detectDiff(text, q);
    const usage = refs.length
      ? '已引用 ' + refs.map((x) => x.label).join('、') + '，按此上下文处理。'
      : queue.length
        ? '已收到 ' + queue.length + ' 份随消息附件。'
        : '';
    const full = `已记录在「${q.name}」的${P.stageName(P.s.ui.stage)}对话中。${usage}${proposal ? '可以按下方建议继续，范围与结果会回到当前工作区。' : diff ? '按建议生成字段级差异，可单项采纳或整体拒绝。' : '当前需要处理：' + (P.blockers(q).join('；') || '确认下一步推进') + '。'}`;
    const reply = {
      id: 'MSG-' + ++P.s.seq,
      turnId: 'T-' + ++P.s.seq,
      role: 'ai',
      stage: P.s.ui.stage,
      text: '',
      full,
      typing: true,
      status: 'ok',
      proposal,
      diff,
      refs,
      attachments: [],
    };
    q.messages.push(reply);
    P.log(q, '对话输入', (text || '附件发送').slice(0, 100));
    P.save();
    P.render();
    document.querySelector('#chat-input')?.focus();
    let count = 0;
    const timer = setInterval(() => {
      if (!reply.typing) {
        clearInterval(timer);
        return;
      }
      if (reply.status === 'stopping') {
        reply.typing = false;
        reply.status = 'stopped';
        clearInterval(timer);
        P.save();
        P.render({ quiet: true });
        return;
      }
      count += 12;
      reply.text = full.slice(0, count);
      if (count >= full.length) {
        reply.typing = false;
        clearInterval(timer);
        P.save();
      }
      P.render({ quiet: true });
      const stream = document.querySelector('#stream');
      if (stream && P.s.ui.req === q.id && P.s.ui.stage === reply.stage)
        stream.scrollTop = stream.scrollHeight;
    }, 60);
  };
  A['stop-reply'] = () => {
    P.write();
    const q = P.r(),
      active = q.messages.filter((m) => m.typing).at(-1);
    P.assert(active, '当前没有正在生成的答复');
    active.status = 'stopping';
    P.save();
    P.render();
    P.toast('已停止生成，保留已输出部分');
  };
  A['reply-message'] = (d) => {
    const q = P.r(),
      target = q.messages.find((x) => x.id === d.id);
    P.assert(target, '消息不存在');
    P.uiBag().reply = target.id;
    P.save();
    P.render();
    document.querySelector('#chat-input')?.focus();
  };
  A['clear-reply'] = () => {
    P.write();
    P.uiBag().reply = null;
    P.save();
    P.render();
  };
  A['resend-message'] = (d) => {
    P.write();
    const q = P.r(),
      old = q.messages.find((x) => x.id === d.id);
    P.assert(old, '消息不存在');
    P.assert(old.role === 'user', '只能重发用户消息');
    P.assert(
      old.status === 'failed' || old.status === 'stopped' || d.force === '1',
      '只有失败或被停止的答复需要重发',
    );
    /* 重发：保留原文与附件，形成新回合，不重复发起已执行的副作用 */
    const msg = {
      id: 'MSG-' + ++P.s.seq,
      turnId: 'T-' + ++P.s.seq,
      role: 'user',
      stage: old.stage,
      text: old.text,
      attachments: (old.attachments || []).map((a) => ({ ...a })),
      refs: (old.refs || []).map((x) => ({ ...x })),
      replyTo: old.replyTo,
      status: 'ok',
      error: '',
      resent: true,
    };
    q.messages.push(msg);
    P.save();
    P.render();
    P.toast('已重新发送（新回合，保留原消息关系）');
  };
  A['attach-menu'] = () => {
    P.write();
    P.modal(
      '添加附件 · 随消息发送',
      `<div class="attach-menu"><button class="attach-opt" data-action="attach-files">${i('clip')} 上传本地文件 / 粘贴截图</button><button class="attach-opt" data-action="attach-material-ref">${i('doc')} 引用已有材料</button><button class="attach-opt" data-action="attach-artifact-ref">${i('link')} 引用当前产物</button><button class="attach-opt" data-action="add-material">${i('plus')} 登记长期材料（材料区）</button></div><p class="source-note">上传文件只保存在当前浏览器会话；正式接入由对象存储与 Bridge 处理。</p>`,
      b('close-modal', '取消'),
    );
  };
  A['attach-files'] = () => {
    P.write();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.csv,.xlsx,.json';
    input.onchange = async () => {
      const files = [...input.files];
      for (const file of files) await P.enqueueFile(file);
      P.close();
      P.render();
    };
    input.click();
  };
  A['attach-material-ref'] = () => {
    const q = P.r();
    P.modal(
      '引用已有材料（本轮上下文）',
      `<div class="search-results">${
        q.materials
          .filter((m) => m.status !== '排除')
          .map((m) =>
            m.allowed === false
              ? `<button type="button" class="btn" disabled title="仅登记，不用于 AI">${e(m.name)} ${P.badge('v' + m.version)}<small class="lock-note">仅登记 · 不可引用</small></button>`
              : b('pick-ref', e(m.name) + ' ' + P.badge('v' + m.version), {
                  kind: 'material',
                  id: m.id,
                  label: m.name + ' v' + m.version,
                }),
          )
          .join('') || '<div class="empty-stage">当前需求还没有材料</div>'
      }</div>`,
      b('close-modal', '取消'),
    );
  };
  A['attach-artifact-ref'] = () => {
    const q = P.r();
    P.modal(
      '引用当前产物（本轮上下文）',
      `<div class="search-results">${P.D.STAGES.map((st) => {
        const v = P.latest(q, st.id);
        return v
          ? b(
              'pick-ref',
              e(v.title + ' · v' + v.version + ' · ' + v.id),
              { kind: 'artifact', id: v.id, stage: st.id, label: v.title + ' v' + v.version },
            )
          : '';
      }).join('')}</div>`,
      b('close-modal', '取消'),
    );
  };
  A['pick-ref'] = (d) => {
    P.write();
    const bag = P.uiBag();
    if (d.kind === 'material') {
      const m = P.r().materials.find((x) => x.id === d.id);
      P.assert(m, '材料不存在');
      P.assert(m.allowed !== false, '该材料仅登记、不用于 AI，不能加入本轮引用');
      bag.refs.push({
        kind: 'material',
        id: m.id,
        label: m.name + ' v' + m.version,
        version: m.version,
        target: m.id,
      });
    } else {
      bag.refs.push({
        kind: 'artifact',
        id: d.id,
        stage: d.stage,
        label: d.label,
        target: d.id,
      });
    }
    P.close();
    P.save();
    P.render();
    P.toast('已加入本轮引用，可在输入框上方调整或排除');
  };
  A['toggle-ref'] = (d) => {
    P.write();
    const refs = P.uiBag().refs;
    const ref = refs[Number(d.idx)];
    if (ref) ref.excluded = !ref.excluded;
    P.save();
    P.render();
  };
  A['remove-pending'] = (d) => {
    P.write();
    P.uiBag().atts.splice(Number(d.idx), 1);
    P.save();
    P.render();
  };
  A['retry-pending'] = async (d) => {
    const queue = P.uiBag().atts;
    const a = queue[Number(d.idx)];
    P.assert(a, '附件不存在');
    P.assert(
      !/不支持|超过/.test(a.error || ''),
      '该附件无法重试（类型或大小受限），请移除后重新添加',
    );
    a.status = 'parsing';
    P.save();
    P.render();
    await new Promise((r) => setTimeout(r, 500));
    a.status = 'ready';
    a.error = '';
    P.save();
    P.render();
  };
  A['test-batch-detail'] = (d) => {
    const q = P.r(),
      tr = q.testRuns.find((x) => x.id === d.id);
    P.assert(tr, '测试批次不存在');
    const defects = q.defects.filter((x) => x.runId === tr.id);
    P.modal(
      '测试批次 · ' + tr.id,
      `<div class="kv-row"><span>时间</span><b>${e(P.time(tr.at))}</b></div><div class="kv-row"><span>基线</span><b>${e(tr.baseline)}</b></div><div class="kv-row"><span>执行人</span><b>陈立</b></div><p class="muted">该批次结果来自当前基线的执行记录，旧批次不覆盖最新状态。</p>` +
        P.table(
          ['用例', '结果', '实际'],
          tr.results.map((x) => [e(x.id + ' · ' + x.text), P.badge(x.status, x.status === 'PASS' ? 'green' : 'red'), e(x.actual)]),
        ) +
        (defects.length
          ? '<div class="rail-title" style="margin-top:10px">关联缺陷</div>' +
            P.table(
              ['缺陷', '状态'],
              defects.map((x) => [e(x.id + ' · ' + x.title), P.badge(x.status, x.status === 'CLOSED' ? 'green' : 'orange')]),
            )
          : '<p class="muted">无关联缺陷。</p>'),
      b('close-modal', '关闭'),
    );
  };
  A['ref-source'] = (d) => {
    const q = P.r(),
      msg = [...q.messages].reverse().find((m) => m.refs?.length) || q.messages.at(-1);
    const ref = msg?.refs?.[Number(d.idx)];
    P.assert(ref, '引用不存在');
    let title, body, staleness = '';
    if (ref.kind === 'material') {
      const m = q.materials.find((x) => x.id === ref.id);
      P.assert(m, '该材料已被移除');
      title = '引用来源 · 材料';
      staleness = m.status === '排除' ? '<div class="guide-notice">该材料已被排除，不再纳入上下文。</div>' : m.status === '待影响评估' ? '<div class="guide-notice">该材料有新版待影响评估，引用版本可能已过时。</div>' : '';
      body = `<div class="kv-row"><span>名称</span><b>${e(m.name)}</b></div><div class="kv-row"><span>编号</span><b>${e(m.id)} · v${e(m.version)}</b></div><div class="kv-row"><span>级别 / 使用</span><b>${e(m.classification)} · ${m.allowed ? '允许分析' : '仅登记'}</b></div><div class="kv-row"><span>状态</span><b>${e(m.status)}</b></div><p class="muted">${e(m.content ? m.content.slice(0, 300) : '仅登记文件元信息，正文待解析。')}${m.content?.length > 300 ? '…' : ''}</p>`;
    } else {
      const v = ref.stage ? q.artifacts[ref.stage]?.find((x) => x.id === ref.id) : null;
      P.assert(v, '该产物版本已被移除');
      const latest = P.latest(q, ref.stage);
      title = '引用来源 · 产物版本';
      staleness =
        latest && latest.id !== v.id
          ? `<div class="guide-notice">当前已有新版本 ${e(latest.id)}，本引用指向旧版本 ${e(v.id)}，答复结论可能过时。</div>`
          : v.stale
            ? '<div class="guide-notice">该版本已标记为需重新评审（下游材料或方案变化）。</div>'
            : v.confirmed
              ? ''
              : '<div class="guide-notice">该版本为草稿，尚未确认。</div>';
      body = `<div class="kv-row"><span>标题</span><b>${e(v.title)}</b></div><div class="kv-row"><span>版本</span><b>${e(v.id)}</b></div><div class="kv-row"><span>状态</span><b>${e(v.review || (v.confirmed ? '已确认' : '待确认'))}</b></div>${v.fields.slice(0, 4).map((f) => `<div class="kv-row"><span>${e(f.name)}</span><b>${e(String(f.value).slice(0, 80))}</b></div>`).join('')}`;
    }
    P.modal(title, staleness + body, b('close-modal', '关闭'));
  };
  A['open-attachment'] = (d) => {
    const bag = P.uiBag(),
      pending = bag.atts.find((x) => x.id === d.id);
    const q = P.r(),
      msg = pending
        ? null
        : q.messages.find((m) => (m.attachments || []).some((x) => x.id === d.id));
    const a = pending || (msg?.attachments || []).find((x) => x.id === d.id);
    P.assert(a, '附件不存在');
    const body =
      a.type === 'image' && (P.raws[a.id] || a.thumb)
        ? `<p class="muted">${e(a.name)} · ${e(a.size)}</p><img class="att-preview-img" src="${P.raws[a.id] || a.thumb}" alt="${e(a.name)}">`
        : a.content
          ? `<p class="muted">${e(a.name)} · ${e(a.size)}</p><div class="doc-body">${e(a.content.slice(0, 4000))}</div>`
          : `<p class="muted">${e(a.name)} · ${e(a.size)}</p><div class="guide-notice">${a.status === 'parsing' ? '接收成功，正在解析…' : '原型仅保留元信息；PDF / Word / 表格正文解析属于正式接入。'}</div>`;
    P.modal(a.name + ' · ' + (a.status === 'error' ? '解析失败' : a.status === 'parsing' ? '解析中' : '预览'), body, b('close-modal', '关闭'));
  };
  A['accept-diff'] = (d) => {
    P.write();
    const q = P.r(),
      active = q.messages.find((x) => x.id === d.mid) ||
        [...q.messages].reverse().find((m) => m.diff && m.status === 'ok' && !m.diffApplied);
    P.assert(active?.diff && !active.diffApplied, '没有待处理的差异建议');
    const diff = active.diff;
    P.assert(P.latest(q, diff.stage).id === diff.base, '产物已有新版本，建议已过期，请重新提出');
    const fields = P.latest(q, diff.stage).fields.map((f) => {
      const ch = diff.fields.find((x) => x.name === f.name);
      return ch ? { ...f, value: ch.after } : f;
    });
    const v = P.newVersion(q, diff.stage, fields);
    active.diffApplied = true;
    P.s.ui.stage = diff.stage;
    P.s.ui.artifactStage = diff.stage;
    P.s.ui.version = v.id;
    P.s.ui.panel = 'canvas';
    P.log(q, '对话采纳差异', diff.stage + ' → ' + v.id);
    P.save();
    P.render();
  };
  A['reject-diff'] = (d) => {
    P.write();
    const q = P.r(),
      active = q.messages.find((x) => x.id === d.mid) ||
        [...q.messages].reverse().find((m) => m.diff && !m.diffApplied);
    P.assert(active?.diff && !active.diffApplied, '没有待处理的差异建议');
    active.diffApplied = true;
    active.diffRejected = true;
    P.log(q, '对话拒绝差异', active.diff.stage);
    P.save();
    P.render();
  };
  A['download-artifact'] = (d) => {
    const q = P.r(),
      stage = d.stage || P.s.ui.stage,
      v = P.latest(q, stage);
    const md = `# ${v.title} · ${v.id}\n\n需求：${q.id} · ${q.name}\n基线：${P.stamp(q)}\n\n` +
      v.fields.map((f) => `## ${f.name}\n\n${f.value}`).join('\n\n') +
      (v.confirmed ? '\n\n已确认' : '\n\n草稿 · 待确认');
    downloadBlob(md, v.id + '.md', 'text/markdown');
    P.toast('已下载 ' + v.id + '.md');
  };
  function detectDiff(text, q) {
    if (!['idea', 'req', 'design'].includes(P.s.ui.stage)) return null;
    const m = text.match(/(?:把|将)(.+?)(?:改为|改成|调整为)(.+)/);
    if (!m) return null;
    const v = P.latest(q, P.s.ui.stage);
    const target = m[1].trim(),
      repl = m[2].trim();
    if (!target || !repl) return null;
    const fields = v.fields
      .map((f) => {
        if (f.value.includes(target)) {
          return {
            name: f.name,
            before: f.value,
            after: f.value.replace(target, repl),
          };
        }
        return null;
      })
      .filter(Boolean);
    return fields.length
      ? { stage: P.s.ui.stage, base: v.id, fields }
      : null;
  }
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  P.downloadBlob = downloadBlob;
  P.enqueueFile = async (file) => {
    P.write();
    const bag = P.uiBag(),
      queue = bag.atts;
    const id = 'ATT-' + ++P.s.seq;
    const size =
      file.size > 1024 * 1024
        ? (file.size / 1024 / 1024).toFixed(1) + ' MB'
        : Math.max(1, Math.round(file.size / 1024)) + ' KB';
    const isText = /\.(md|txt|csv|json)$/i.test(file.name);
    const isImage = /\.(png|jpe?g|gif)$/i.test(file.name);
    const base = {
      id,
      name: file.name,
      size,
      status: 'parsing',
      error: '',
      origin: 'browser',
    };
    if (file.size > 10 * 1024 * 1024) {
      queue.push({ ...base, status: 'error', error: '超过 10 MB 上限' });
      P.save();
      return;
    }
    if (!isText && !isImage && !/\.(pdf|docx|xlsx)$/i.test(file.name)) {
      queue.push({ ...base, status: 'error', error: '不支持的文件类型' });
      P.save();
      return;
    }
    queue.push(base);
    P.save();
    P.render();
    try {
      if (isImage) {
        const [thumb, raw] = await Promise.all([readThumb(file), readRaw(file)]);
        const a = queue.find((x) => x.id === id);
        if (a) {
          a.status = 'ready';
          a.type = 'image';
          a.thumb = thumb;
        }
        P.raws[id] = raw;
      } else if (isText) {
        if (file.size > 200000) throw Error('文本预览超过 200 KB');
        const content = await file.text();
        const a = queue.find((x) => x.id === id);
        if (a) {
          a.status = 'ready';
          a.type = 'text';
          a.content = content.slice(0, 50000);
        }
      } else {
        const a = queue.find((x) => x.id === id);
        if (a) {
          a.status = 'ready';
          a.type = /\.(pdf)$/i.test(file.name) ? 'pdf' : /\.(docx)$/i.test(file.name) ? 'word' : 'sheet';
          a.content = '（演示解析）已接收 ' + file.name + '，正文提取与结构化属于正式接入。';
        }
      }
    } catch (err) {
      const a = queue.find((x) => x.id === id);
      if (a) {
        a.status = 'error';
        a.error = err.message || '解析失败';
      }
    }
    P.save();
    P.render();
  };
  function readRaw(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function readThumb(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 160;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  A['generate-draft'] = () => {
    P.write();
    const q = P.r(),
      stage = P.s.ui.stage;
    P.assert(
      ['idea', 'req', 'design', 'dev'].includes(stage),
      '本阶段使用对应的结果记录',
    );
    P.modal(
      '产物修改建议',
      `<p>基于当前需求、材料基线和最近对话生成新草稿；原型提供字段编辑，以明确后续 AI 建议的确认入口。</p>`,
      b('edit-artifact', '查看并编辑建议', { stage }, 'primary') +
        b('close-modal', '取消'),
    );
  };
  A.search = () => {
    P.modal(
      '全局搜索 / 命令',
      `<label class="form-field" for="global-query"><span>搜索需求、产物、作业或命令</span><input id="global-query" placeholder="输入编号、名称；或输入“创建”“治理”"></label><div class="search-results" id="search-results"></div>`,
    );
    P.searchResults('');
  };
  P.searchResults = (term) => {
    const results = [];
    for (const q of Object.values(P.s.reqs)) {
      if ((q.id + q.name).includes(term))
        results.push(
          b('search-open', e(q.id + ' · ' + q.name), {
            req: q.id,
            stage: q.stage,
          }),
        );
      for (const [stage, versions] of Object.entries(q.artifacts)) {
        const v = versions.at(-1);
        if (term && (v.title + v.id).includes(term))
          results.push(
            b('search-open', e(q.id + ' · ' + v.title + ' · v' + v.version), {
              req: q.id,
              stage,
              panel: 'canvas',
            }),
          );
      }
      for (const run of q.runs)
        if (term && run.id.includes(term))
          results.push(
            b('search-open', e(q.id + ' · ' + run.id), {
              req: q.id,
              stage: 'dev',
              panel: 'terminal',
              runId: run.id,
            }),
          );
    }
    if (!term || '创建需求'.includes(term))
      results.push(b('new-requirement', '命令：创建需求'));
    if (!term || '治理中心'.includes(term))
      results.push(b('search-governance', '命令：打开治理中心'));
    document.querySelector('#search-results').innerHTML =
      results.slice(0, 20).join('') ||
      '<div class="empty-stage">没有匹配结果，请更换关键词。</div>';
  };
  A['search-open'] = (d) => {
    P.close();
    A['open-work'](d);
  };
  A['search-governance'] = () => {
    P.close();
    P.go({ route: 'gov' });
  };
  A.notifications = () =>
    P.modal(
      '最近动态',
      `<div class="event-list">${
        P.s.audit
          .slice(0, 10)
          .map(
            (x) =>
              `<div class="event"><b>${e(x.action)}</b><small>${e(x.req + ' · ' + x.detail)}</small></div>`,
          )
          .join('') || '<div class="empty-stage">暂无新动态</div>'
      }</div>`,
    );
  A.scenarios = () =>
    P.modal(
      '原型场景 · 仅改变演示记录',
      `<p class="muted">用这些场景检查例外路径。所有结果均为模拟，不调用实际工具。</p><div class="scenario-grid">${[
        ['normal', '正常显示'],
        ['loading', '加载中'],
        ['error', '加载失败'],
        ['viewer', '只读成员'],
        ['owner', '负责人'],
        ['offline', 'Bridge 离线'],
        ['online', 'Bridge 恢复'],
        ['input', '作业等待输入'],
        ['approval', '作业等待授权'],
        ['unknown', '作业结果未知'],
        ['failed', '作业执行失败'],
        ['expiry', '发布审批过期'],
        ['release-failure', '下次发布失败'],
        ['window', '完成观察窗口'],
        ['version-conflict', '下次保存版本冲突'],
        ['empty', '空产品空间'],
      ]
        .map(([id, l]) => b('scenario', l, { scenario: id }))
        .join(
          '',
        )}</div><div class="btn-group">${b('reset-prototype', '重置原型演示数据', {}, 'danger')}</div><p class="source-note">存储与正式平台、V3 对照稿隔离。</p>`,
    );
  A.scenario = (d) => {
    const q = P.r(),
      s = P.s;
    const kind = d.scenario;
    if (['normal', 'loading', 'error'].includes(kind)) s.viewState = kind;
    else if (kind === 'viewer' || kind === 'owner') s.role = kind;
    else if (kind === 'offline' || kind === 'online')
      s.bridges.forEach((br) => {
        if (br.status !== 'REVOKED')
          br.status = kind === 'online' ? 'ONLINE' : 'OFFLINE';
      });
    else if (['input', 'approval', 'unknown', 'failed'].includes(kind)) {
      P.assert(q, '先创建需求');
      let run = P.run(q);
      P.assert(run, '先发起一次作业');
      if (['SUCCEEDED', 'CANCELLED', 'FAILED'].includes(run.status)) {
        run = {
          ...P.clone(run),
          id: 'R-' + ++s.seq,
          parentId: run.id,
          pct: 8,
          step: 0,
          exitCode: null,
          preview: false,
        };
        q.runs.push(run);
      }
      run.status = {
        input: 'WAITING_INPUT',
        approval: 'WAITING_APPROVAL',
        unknown: 'UNKNOWN',
        failed: 'FAILED',
      }[kind];
      run.verified = kind === 'failed';
      s.ui.runId = run.id;
      s.ui.route = 'work';
      s.ui.stage = 'dev';
      q.stage = 'dev';
    } else if (kind === 'expiry') {
      P.assert(q?.release, '先申请一次发布审批');
      q.release.expiresAt = P.now() - 1;
    } else if (kind === 'release-failure') s.failRelease = true;
    else if (kind === 'window') {
      P.assert(q?.observation, '先完成发布并进入观察');
      s.clockOffset += q.observation.hours * 3600000;
    } else if (kind === 'version-conflict') s.simulateConflict = true;
    else if (kind === 'empty') {
      P.modal(
        '进入空空间场景',
        '<p>当前原型记录会清空为一个空团队；可创建新需求，或通过重置恢复示例。</p>',
        b('confirm-empty', '确认进入空空间', {}, 'danger') +
          b('close-modal', '取消'),
      );
      return;
    }
    P.save();
    P.close();
    P.render();
    P.toast('已切换原型场景');
  };
  A['confirm-empty'] = () => {
    P.s.reqs = {};
    P.s.ui.req = '';
    P.s.ui.route = 'product';
    P.save();
    P.close();
    P.render();
  };
  A['clear-view'] = () => {
    P.s.viewState = 'normal';
    P.save();
    P.render();
  };
  A['reset-prototype'] = () =>
    P.modal(
      '重置原型演示数据',
      '<p>仅清除这一版原型的本地记录。V3、其他页面与正式平台数据保持独立。</p>',
      b('confirm-reset', '确认重置', {}, 'danger') + b('close-modal', '取消'),
    );
  A['confirm-reset'] = () => {
    P.reset();
    P.close();
    P.go({ route: 'home' });
  };
  A['reload-state'] = () => {
    const drafts = P.clone(P.s.ui.drafts),
      edit = P.clone(P.s.ui.editDrafts);
    const next = JSON.parse(localStorage.getItem(P.KEY));
    P.assert(P.valid(next), '最新存储不可用，请保留当前页面并导出记录');
    P.s = next;
    P.s.ui.drafts = { ...next.ui.drafts, ...drafts };
    P.s.ui.editDrafts = { ...next.ui.editDrafts, ...edit };
    P.conflict = false;
    for (const q of Object.values(P.s.reqs))
      for (const run of q.runs)
        if (['RUNNING', 'CANCELLING'].includes(run.status)) {
          run.status = 'UNKNOWN';
          run.verified = false;
        }
    P.close();
    P.render();
  };
  const saveOriginal = A['save-artifact'];
  A['save-artifact'] = () => {
    if (P.s.simulateConflict) {
      P.s.simulateConflict = false;
      const q = P.s.reqs[P.editor.req];
      P.newVersion(q, P.editor.stage, P.latest(q, P.editor.stage).fields);
      P.save();
    }
    saveOriginal();
  };
  document.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    try {
      /* 对话建议绑定校验：对象或版本变化后过期，需重新评估 */
      if (el.dataset.proposal) {
        const p = P.proposals?.[el.dataset.proposal];
        P.assert(p, '此建议已失效，请重新发起对话');
        const q = P.r();
        const latest = P.latest(q, p.stage);
        const still =
          p.stage === P.s.ui.stage &&
          (!p.versionId || latest?.id === p.versionId) &&
          (!p.runId || P.s.ui.runId === p.runId) &&
          p.stamp === P.stamp(q);
        P.assert(still, '需求、产物或作业已变化，建议过期；请重新发起对话');
      }
      const fn = A[el.dataset.action];
      P.assert(fn, '此操作未配置');
      await fn(el.dataset);
    } catch (error) {
      const box = document.querySelector('#form-error');
      if (box) box.textContent = error.message;
      P.toast(error.message, 'error');
    }
  });
  document.addEventListener('paste', (event) => {
    const t = event.target;
    if (t && (t.id === 'chat-input' || t.closest('.composer'))) {
      const files = [...(event.clipboardData?.files || [])].filter(
        (f) => f.type.startsWith('image/'),
      );
      if (files.length) {
        event.preventDefault();
        try {
          P.write();
          files.forEach((f) => P.enqueueFile(f));
          P.render();
          P.toast('已粘贴 ' + files.length + ' 张截图到附件队列');
        } catch (err) {
          P.render();
          P.toast(err.message, 'error');
        }
      }
    }
  });
  document.addEventListener('dragover', (event) => {
    const t = event.target;
    if (t && t.closest && t.closest('.composer')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const box = document.querySelector('.composer');
      if (box && !box.classList.contains('drag-over')) box.classList.add('drag-over');
    }
  });
  document.addEventListener('dragleave', (event) => {
    const box = document.querySelector('.composer');
    if (box && !event.target.closest('.composer')) box.classList.remove('drag-over');
  });
  document.addEventListener('drop', (event) => {
    const t = event.target;
    if (t && t.closest && t.closest('.composer')) {
      event.preventDefault();
      const box = document.querySelector('.composer');
      if (box) box.classList.remove('drag-over');
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) {
        try {
          P.write();
          files.forEach((f) => P.enqueueFile(f));
          P.render();
          P.toast('已添加 ' + files.length + ' 个附件');
        } catch (err) {
          P.render();
          P.toast(err.message, 'error');
        }
      }
    }
  });
  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.id === 'chat-input') {
      P.s.ui.drafts[P.s.ui.req] = el.value;
      P.save();
    }
    if (el.id === 'global-query') P.searchResults(el.value.trim());
    if (el.id === 'requirement-filter') {
      P.s.ui.search = el.value;
      P.render({ quiet: true });
    }
    if (el.name?.startsWith('field') && P.editor) {
      const values = [
        ...document.querySelectorAll('#modal-root textarea[name^="field"]'),
      ].map((x) => x.value);
      P.s.ui.editDrafts[P.editor.base] = values;
      P.save();
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'version-select')
      P.go({ version: event.target.value });
  });
  document.addEventListener('keydown', (event) => {
    const modal = document.querySelector('.guide-dialog');
    if (event.key === 'Escape' && modal) {
      event.preventDefault();
      P.close();
      return;
    }
    if (event.key === 'Tab' && modal) {
      const nodes = [
        ...modal.querySelectorAll(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ),
      ].filter((x) => x.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      event.target.id === 'chat-input'
    ) {
      event.preventDefault();
      document.querySelector('[data-action="send"]').click();
    }
    if (event.key === 'Enter' && event.target.id === 'global-query') {
      event.preventDefault();
      document.querySelector('#search-results button')?.click();
    }
    if (
      ['ArrowRight', 'ArrowLeft'].includes(event.key) &&
      event.target.matches('[role="tab"]')
    ) {
      event.preventDefault();
      const nodes = [
          ...event.target
            .closest('[role="tablist"]')
            .querySelectorAll('[role="tab"]'),
        ],
        next =
          nodes[
            (nodes.indexOf(event.target) +
              (event.key === 'ArrowRight' ? 1 : -1) +
              nodes.length) %
              nodes.length
          ];
      const a = next.dataset;
      next.click();
      setTimeout(
        () =>
          document
            .querySelector(
              `[data-action="${a.action}"][data-${a.panel ? 'panel' : 'tab'}="${a.panel || a.tab}"]`,
            )
            ?.focus(),
        0,
      );
    }
  });
  window.addEventListener('popstate', () => {
    parse();
    P.render();
  });
  window.addEventListener('hashchange', () => {
    parse();
    P.render();
  });
  parse();
  P.render();
  P.save();
  if (P.loadNotice) P.toast(P.loadNotice);
  const tick = setInterval(P.tick, 1200);
  window.addEventListener('pagehide', () => clearInterval(tick));
})();
