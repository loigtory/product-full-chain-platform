(() => {
  'use strict';
  const P = window.PFC,
    { esc: e, btn: b } = P,
    A = P.actions;
  P.hydrateConversation = () => {
    for (const q of Object.values(P.s.reqs))
      for (const m of q.messages)
        if (m.typing) {
          m.typing = false;
          m.status = 'stopped';
          const user = q.messages.find((x) => x.id === m.replyTo);
          if (user) user.status = 'stopped';
        }
  };
  P.hydrateConversation();
  P.validateRefs = (q, refs) => {
    for (const ref of refs) {
      P.assert(
        !ref.requirementId || ref.requirementId === q.id,
        '引用不属于当前需求，请重新选择',
      );
      if (ref.kind === 'material') {
        const m = q.materials.find((x) => x.id === ref.id);
        P.assert(
          m && m.allowed !== false && m.status !== '排除',
          '引用材料已不可用或已撤销分析权限，请排除该引用后发送',
        );
        P.assert(
          !ref.version || ref.version === m.version,
          '引用材料已有新版本，请重新选择后发送',
        );
      } else if (ref.kind === 'attachment') {
        const a = P.findAttachment(q, ref.id);
        P.assert(a && a.status === 'ready', '引用附件已不存在或已失效，请重新选择');
      } else {
        P.assert(
          q.artifacts[ref.stage]?.some((v) => v.id === ref.id),
          '引用产物版本不存在，请重新选择',
        );
      }
    }
  };
  A.send = () => {
    const q = P.r(),
      bag = P.uiBag(q.id);
    P.submitTurn(
      q,
      {
        text: document.querySelector('#chat-input').value.trim(),
        stage: P.s.ui.stage,
        attachments: bag.atts,
        refs: bag.refs.filter((x) => !x.excluded),
        replyTo: bag.reply,
      },
      true,
    );
  };
  P.submitTurn = (q, payload, clearDraft = false) => {
    P.write();
    const { text, stage } = payload,
      queue = payload.attachments || [],
      refs = P.clone(payload.refs || []);
    P.assert(
      text || queue.length || refs.length,
      '请输入内容，或通过附件选择文件后发送',
    );
    P.assert(text.length <= 8000, '单条输入不超过 8000 字');
    P.assert(
      queue.every((a) => a.status === 'ready'),
      '附件仍在读取或解析失败，请等待完成、重试或移除后再发送',
    );
    P.assert(
      queue.every((a) => !a.requirementId || a.requirementId === q.id),
      '附件不属于当前需求',
    );
    P.validateRefs(q, refs);
    P.assert(
      !payload.replyTo || q.messages.some((m) => m.id === payload.replyTo),
      '引用的原消息不存在',
    );
    for (const m of q.messages)
      if (m.typing) {
        m.typing = false;
        m.status = 'stopped';
        const user = q.messages.find((x) => x.id === m.replyTo);
        if (user) user.status = 'stopped';
      }
    const turnId = 'T-' + ++P.s.seq;
    const userMsg = {
      id: 'MSG-' + ++P.s.seq,
      turnId,
      role: 'user',
      stage,
      text,
      attachments: P.clone(queue),
      refs,
      replyTo: payload.replyTo || null,
      parentMessageId: payload.parentMessageId || null,
      resent: !!payload.parentMessageId,
      status: 'ok',
      error: '',
      at: P.now(),
    };
    q.messages.push(userMsg);
    if (payload.parentMessageId)
      q.messages.find((m) => m.id === payload.parentMessageId).retryMessageId =
        userMsg.id;
    if (clearDraft) {
      P.s.ui.drafts[q.id] = '';
      const bag = P.uiBag(q.id);
      bag.atts = [];
      bag.refs = [];
      bag.reply = null;
    }
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
      const v = P.latest(q, stage);
      proposal.stage = stage;
      proposal.requirementId = q.id;
      proposal.versionId = v?.id;
      proposal.runId = P.run(q)?.id || null;
      proposal.stamp = P.stamp(q);
      proposal.at = P.now();
      proposal.pid = 'PR-' + ++P.s.seq;
    }
    const diff = detectDiff(text, q, stage);
    const usage = refs.length
      ? '已引用 ' + refs.map((x) => x.label).join('、') + '，按此上下文处理。'
      : queue.length
        ? '已收到 ' + queue.length + ' 份随消息附件。'
        : '';
    const full = `已记录在「${q.name}」的${P.stageName(stage)}对话中。${usage}${proposal ? '可以按下方建议继续，范围与结果会回到当前工作区。' : diff ? '按建议生成字段级差异，可单项采纳或整体拒绝。' : '当前需要处理：' + (P.blockers(q).join('；') || '确认下一步推进') + '。'}`;
    const reply = {
      id: 'MSG-' + ++P.s.seq,
      turnId,
      replyTo: userMsg.id,
      role: 'ai',
      stage,
      text: '',
      full,
      at: P.now(),
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
      if (!reply.typing || P.s.reqs[q.id] !== q || !P.canWrite()) {
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
  A['stop-reply'] = (d) => {
    P.write();
    const q = P.r(),
      active = d.id
        ? q.messages.find((m) => m.id === d.id && m.typing)
        : q.messages.filter((m) => m.typing).at(-1);
    P.assert(active, '当前没有正在生成的答复');
    active.status = 'stopping';
    const user = q.messages.find((m) => m.id === active.replyTo);
    if (user) user.status = 'stopped';
    P.save();
    P.render();
    P.toast('已停止生成，保留已输出部分');
  };
  A['reply-message'] = (d) => {
    P.write();
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
  A['toggle-stage-all'] = (d) => {
    P.write();
    P.s.ui.stageAll = d.all === '1';
    if (!P.s.ui.stageAll) P.s.ui.expandAll = false;
    P.save();
    P.render();
  };
  A['expand-early-msgs'] = () => {
    P.write();
    P.s.ui.expandAll = true;
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
    P.assert(!old.retryMessageId, '此消息已重发，请查看关联的新回合');
    P.submitTurn(q, {
      text: old.text || '',
      stage: old.stage,
      attachments: old.attachments,
      refs: old.refs,
      replyTo: old.replyTo,
      parentMessageId: old.id,
    });
    P.toast('已重新发送，正在生成新答复；保留原消息关系');
  };
  A['ref-source'] = (d) => {
    const q = P.r(),
      msg = q.messages.find((m) => m.id === d.mid);
    const ref = msg?.refs?.[Number(d.idx)];
    P.assert(ref, '引用不存在');
    let title, body, staleness;
    if (ref.kind === 'material') {
      const current = q.materials.find((x) => x.id === ref.id);
      const m =
        ref.snapshot || (current?.version === ref.version ? current : null);
      P.assert(m, '该历史引用未保存原版本内容，请重新引用当前材料');
      title = '引用来源 · 材料';
      staleness =
        !current || current.status === '排除' || current.allowed === false
          ? '<div class="guide-notice">该材料已被排除，不再纳入上下文。</div>'
          : current?.version !== ref.version || current?.status === '待影响评估'
            ? '<div class="guide-notice">该材料有新版待影响评估，引用版本可能已过时。</div>'
            : '';
      body = `<div class="kv-row"><span>名称</span><b>${e(m.name)}</b></div><div class="kv-row"><span>编号</span><b>${e(m.id)} · v${e(m.version)}</b></div><div class="kv-row"><span>级别 / 使用</span><b>${e(m.classification)} · ${m.allowed ? '允许分析' : '仅登记'}</b></div><div class="kv-row"><span>状态</span><b>${e(m.status)}</b></div><p class="muted">${e(m.content ? m.content.slice(0, 300) : '仅登记文件元信息，正文待解析。')}${m.content?.length > 300 ? '…' : ''}</p>`;
    } else if (ref.kind === 'attachment') {
      const a = P.findAttachment(q, ref.id);
      title = '引用来源 · 附件范围';
      staleness =
        !a || a.status !== 'ready'
          ? '<div class="guide-notice">该附件已失效，引用内容不可追溯，请重新选择。</div>'
          : '';
      body = `<div class="kv-row"><span>附件</span><b>${e(a?.name || '附件')}</b></div><div class="kv-row"><span>范围</span><b>${e(ref.scope || '整体')}</b></div><div class="kv-row"><span>需求</span><b>${e(q.id)}</b></div><p class="muted">合成样例结构，仅表达解析后的引用范围；正式解析由服务端完成。</p>`;
    } else {
      const v = ref.stage
        ? q.artifacts[ref.stage]?.find((x) => x.id === ref.id)
        : null;
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
      body = `<div class="kv-row"><span>标题</span><b>${e(v.title)}</b></div><div class="kv-row"><span>版本</span><b>${e(v.id)}</b></div><div class="kv-row"><span>状态</span><b>${e(v.review || (v.confirmed ? '已确认' : '待确认'))}</b></div>${v.fields
        .slice(0, 4)
        .map(
          (f) =>
            `<div class="kv-row"><span>${e(f.name)}</span><b>${e(String(f.value).slice(0, 80))}</b></div>`,
        )
        .join('')}`;
    }
    P.modal(title, staleness + body, b('close-modal', '关闭'));
  };
  A['diff-full'] = (d) => {
    const q = P.r(),
      m = q.messages.find((x) => x.id === d.mid);
    P.assert(m?.diff, '差异建议不存在或已处理');
    P.modal(
      '字段级差异 · 完整视图',
      `<p class="muted">来源消息 ${e(m.id)} · ${e(P.time(m.time || m.at || Date.now()))} · 采纳后生成新版本并使下游评审过期</p>` +
        m.diff.fields
          .map(
            (f, n) =>
              `<section class="diff-block"><div class="diff-name"><label><input type="checkbox" name="diff-field" value="${n}" checked ${m.diffApplied ? 'disabled' : ''}> ${e(f.name)}</label></div><div class="diff-cols"><div><h4>之前</h4><div class="doc-body dim">${e(f.before)}</div></div><div><h4>之后</h4><div class="doc-body">${e(f.after)}</div></div></div></section>`,
          )
          .join(''),
      b(
        'accept-selected-diff',
        '仅采纳勾选项',
        { mid: d.mid, disabled: !!m.diffApplied },
        'primary',
      ) +
        b('accept-diff', '全部采纳为新版本', {
          mid: d.mid,
          disabled: !!m.diffApplied,
        }) +
        b('reject-diff', '拒绝建议', { mid: d.mid }) +
        b('close-modal', '返回'),
    );
  };
  A['msg-source'] = (d) => {
    const q = P.r(),
      m = q.messages.find((x) => x.id === d.id);
    P.assert(m, '原消息不存在');
    P.modal(
      '引用来源 · ' + m.id,
      `<p class="muted">${P.stageName(m.stage)} 阶段 · ${e(P.time(m.time || m.at || Date.now()))} · ${m.role === 'user' ? '成员' : 'Agent'}</p><div class="doc-body">${e(m.text || '（无文本）')}</div>` +
        (m.attachments?.length
          ? `<div class="att-origin">附件 ${m.attachments.length} 个</div><p class="muted">${m.attachments.map((x) => e(x.name + ' · ' + x.size)).join('；')}</p>`
          : '') +
        (m.refs?.length
          ? `<div class="att-origin">引用上下文 ${m.refs.length} 项</div><p class="muted">${m.refs.map((x) => e(x.label)).join('；')}</p>`
          : ''),
      b('close-modal', '返回'),
      true,
    );
  };
  A['accept-selected-diff'] = (d) => {
    const selected = [
      ...document.querySelectorAll('[name="diff-field"]:checked'),
    ].map((x) => Number(x.value));
    P.assert(selected.length, '至少勾选一个修改项；未勾选项本次不采纳');
    A['accept-diff']({ ...d, selected });
  };
  A['accept-diff'] = (d) => {
    P.write();
    const q = P.r(),
      active = q.messages.find((x) => x.id === d.mid);
    P.assert(active?.diff && !active.diffApplied, '没有待处理的差异建议');
    const diff = active.diff;
    P.assert(
      P.latest(q, diff.stage).id === diff.base,
      '产物已有新版本，建议已过期，请重新提出',
    );
    const fields = P.latest(q, diff.stage).fields.map((f) => {
      const ch = diff.fields.find(
        (x, n) => x.name === f.name && (!d.selected || d.selected.includes(n)),
      );
      return ch ? { ...f, value: ch.after } : f;
    });
    const v = P.newVersion(q, diff.stage, fields);
    active.diffApplied = true;
    active.diffDecisions = diff.fields.map((f, n) => ({
      name: f.name,
      accepted: !d.selected || d.selected.includes(n),
    }));
    P.close();
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
      active = q.messages.find((x) => x.id === d.mid);
    P.assert(active?.diff && !active.diffApplied, '没有待处理的差异建议');
    active.diffApplied = true;
    active.diffRejected = true;
    P.close();
    P.log(q, '对话拒绝差异', active.diff.stage);
    P.save();
    P.render();
  };
  function detectDiff(text, q, stage = P.s.ui.stage) {
    if (!['idea', 'req', 'design'].includes(stage)) return null;
    const m = text.match(/(?:把|将)(.+?)(?:改为|改成|调整为)(.+)/);
    if (!m) return null;
    const v = P.latest(q, stage);
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
    return fields.length ? { stage, base: v.id, fields } : null;
  }
})();
