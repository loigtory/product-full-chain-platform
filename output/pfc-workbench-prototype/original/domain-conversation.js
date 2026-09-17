(() => {
  'use strict';
  const P = window.PFC,
    V = P.domainView,
    D = P.domainActions;
  const C = (P.domainConversation = {});
  let previewUrl = null,
    previewEpoch = 0;
  C.attachment = (d) => {
    const q = P.r(),
      message = d.mid ? q.messages.find((m) => m.id === d.mid) : null;
    const a =
      message?.attachments.find(
        (a) => a.id === d.id && (!d.version || a.version === Number(d.version)),
      ) ||
      P.uiBag().atts.find((a) => a.id === d.id) ||
      q.attachments.find(
        (a) => a.id === d.id && (!d.version || a.version === Number(d.version)),
      );
    P.assert(a, '附件不存在或该版本未加载');
    return a;
  };
  const refresh = async (id) => {
    await V.read(id);
    P.save();
    P.render({ quiet: true });
  };
  C.install = (remote) => {
    const submit = P.submitTurn,
      enqueue = P.enqueueFile,
      renderMsg = P.renderMsg,
      close = P.close;
    P.close = (...args) => {
      previewEpoch++;
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      return close(...args);
    };
    P.renderMsg = (message, q) => {
      const html = renderMsg(message, q);
      if (!V.pg()) return html;
      const template = document.createElement('template');
      template.innerHTML = html;
      for (const button of template.content.querySelectorAll(
        '[data-action="open-attachment"]',
      )) {
        const a = message.attachments.find((a) => a.id === button.dataset.id);
        if (a) {
          button.dataset.mid = message.id;
          button.dataset.version = a.version;
        }
      }
      if (message.status === 'interrupted') {
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent =
          '服务重启已中断本次模拟回复，已输出内容保留，可从原消息重发。';
        template.content.firstElementChild?.append(note);
      }
      return template.innerHTML;
    };
    P.submitTurn = (...args) =>
      V.pg() ? persistentSubmit(...args) : submit(...args);
    const persistentSubmit = async (q, payload, clear = false) => {
      P.write();
      P.assert(
        (payload.attachments || []).every(
          (a) => a.status === 'ready' && a.requirementId === q.id,
        ),
        '附件尚未保存或不属于当前需求',
      );
      const refs = (payload.refs || [])
        .filter(
          (ref) =>
            ref.kind !== 'attachment' ||
            !(payload.attachments || []).some((a) => a.id === ref.id),
        )
        .map((ref) => {
          if (ref.kind === 'artifact') {
            const version = q.artifacts[ref.stage]?.find(
              (v) => v.id === ref.id,
            );
            P.assert(version?._serverId, '产物引用已失效');
            return {
              kind: 'artifact',
              id: version._serverId,
              version: version.version,
              requirementId: q.id,
            };
          }
          return {
            kind: ref.kind,
            id: ref.id,
            version: ref.version,
            requirementId: ref.requirementId,
          };
        });
      const stage = payload.stage || P.s.ui.stage || q.stage;
      const key = q.id + ':' + stage;
      const draft = P.s.ui.execDrafts?.[key];
      const execWs =
        P.s.ui.realMode === true ? draft?.workspace?.trim() || '' : '';
      if (execWs) {
        P.assert(stage === 'dev' && q.stage === 'dev', '仅当前开发阶段可执行');
        P.assert(
          P.s.env?.execCapable === true,
          P.s.env?.execution?.reason || '开发执行暂不可用：执行前约束尚未验证',
        );
        P.assert(draft?.control?.confirmed === true, '请先预览并确认执行计划');
      }
      await D.mutate(q, '/messages', {
        content: payload.text,
        stage: payload.stage,
        refs,
        attachments: (payload.attachments || []).map((a) => ({
          id: a.id,
          version: a.version,
        })),
        replyTo: payload.replyTo,
        parentMessageId: payload.parentMessageId,
        // The server resolves prior-stage versions and labels AI drafts. Client text is optional, untrusted input.
        ...(payload.stageContext !== undefined
          ? { stageContext: payload.stageContext }
          : {}),
        ...(payload.contextSources !== undefined
          ? { contextSources: payload.contextSources }
          : {}),
        ...(P.s.ui.realMode || execWs ? { mode: 'real' } : {}),
        ...(execWs
          ? {
              tool: 'exec',
              workspace: execWs,
              restrictedReadDirs: [],
              control: draft.control,
            }
          : {}),
      });
      if (clear) {
        P.s.ui.drafts[q.id] = '';
        const bag = P.uiBag(q.id);
        bag.atts = [];
        bag.refs = [];
        bag.reply = null;
      }
      await refresh(q.id);
    };
    remote.send = () => {
      const q = P.r(),
        bag = P.uiBag(q.id);
      return P.submitTurn(
        q,
        {
          text: document.querySelector('#chat-input').value.trim(),
          stage: P.s.ui.stage,
          attachments: bag.atts,
          refs: bag.refs.filter((r) => !r.excluded),
          replyTo: bag.reply,
        },
        true,
      );
    };
    remote['host-tool-records'] = async () => {
      const id = P.r()?.id;
      P.assert(id, '请选择需求');
      const data = await window.PFCAPI.api.req(
        'GET',
        '/api/agent/requirements/' + encodeURIComponent(id) + '/tool-control',
      );
      if (P.r()?.id !== id || data.reqId !== id) return;
      const e = P.esc,
        states = {
          PENDING: '待确认',
          APPROVED: '已同意',
          DENIED: '已拒绝',
          EXPIRED: '已失效',
          SUCCEEDED: '成功',
          FAILED: '失败',
          UNKNOWN: '结果未知',
          RUNNING: '进行中',
          CANCELLED: '已取消',
          TIMED_OUT: '超时',
        };
      const approvals = data.approvals
        .map(
          (a) =>
            `<li>${e(a.tool || '工具')} · ${e(a.path || '固定命令')} · ${e(states[a.state] || a.state)}${a.state === 'PENDING' && P.s.role === 'owner' ? `<div>${P.btn('host-tool-decision', '同意范围（需新计划）', { req: id, job: a.jobId, approval: a.id, hash: a.scopeHash, decision: 'approve' })}${P.btn('host-tool-decision', '拒绝', { req: id, job: a.jobId, approval: a.id, hash: a.scopeHash, decision: 'deny' })}</div>` : ''}</li>`,
        )
        .join('');
      const records = data.executions
        .map(
          (t) =>
            `<li>${e(t.tool || '工具')} · ${e(t.path || '')} · ${e(states[t.state] || t.state)}${t.sha256 ? `<code> ${e(t.sha256.slice(0, 12))}</code>` : ''}</li>`,
        )
        .join('');
      P.modal(
        '工具审批与记录',
        `<p>范围内的操作自动校验。超出范围需重新确认执行计划；此处同意不会立即执行。</p><h3>范围确认</h3>${approvals ? '<ul>' + approvals + '</ul>' : '<p>暂无待处理或历史确认</p>'}<h3>执行记录</h3>${records ? '<ul>' + records + '</ul>' : '<p>暂无工具执行记录</p>'}`,
        P.btn('close-modal', '关闭'),
      );
    };
    remote['host-tool-decision'] = async (d) => {
      P.assert(P.r()?.id === d.req, '需求已切换，请重新打开记录');
      await window.PFCAPI.api.req(
        'POST',
        '/api/agent/jobs/' +
          encodeURIComponent(d.job) +
          '/approvals/' +
          encodeURIComponent(d.approval) +
          '/decision',
        {
          decision: d.decision,
          scopeHash: d.hash,
          expectedState: 'PENDING',
          commandId: crypto.randomUUID(),
        },
      );
      if (P.r()?.id === d.req) await remote['host-tool-records']();
    };
    P.enqueueFile = async (file, reqId = P.r().id) => {
      if (!V.pg()) return enqueue(file, reqId);
      P.write();
      const bag = P.uiBag(reqId);
      P.assert(
        bag.atts.length < 20 &&
          bag.atts.reduce((n, a) => n + (a.bytes || 0), 0) + file.size <=
            52428800,
        '单消息最多 20 份、合计 50 MiB',
      );
      const a = {
        id: 'pending-' + crypto.randomUUID(),
        name: file.name,
        bytes: file.size,
        size: Math.ceil(file.size / 1024) + ' KB',
        status: 'parsing',
        requirementId: reqId,
        origin: 'pending',
      };
      const pendingId = a.id;
      bag.atts.push(a);
      P.fileHandles.set(a.id, file);
      P.render();
      try {
        const result = await D.mutate(P.s.reqs[reqId], '/materials', {
          name: file.name,
          usage: 'attachment',
          file: await D.file(file),
        });
        Object.assign(a, V.attachment(result.material, reqId));
        P.fileHandles.delete(pendingId);
        P.save();
        P.render();
      } catch (e) {
        a.status = 'error';
        a.error = e.message;
        P.render();
        throw e;
      }
    };
    remote['retry-pending'] = async (d) => {
      const bag = P.uiBag(),
        old = bag.atts.find((a) => a.id === d.id),
        file = P.fileHandles.get(d.id);
      P.assert(old && file, '请重新选择原文件');
      bag.atts = bag.atts.filter((a) => a.id !== d.id);
      return P.enqueueFile(file, old.requirementId);
    };
    remote['toggle-real-mode'] = async () => {
      const next = !P.s.ui.realMode;
      if (next && V.pg()) {
        let status;
        try {
          status = await window.PFCAPI.api.req('GET', '/api/agent/status');
        } catch {
          status = null;
        }
        if (!status || status.capable !== true) {
          P.toast(
            '本机 Codex 未配置（缺少连接参数），真实回复会明确失败；已保持模拟模式',
            'error',
          );
          return;
        }
      }
      P.s.ui.realMode = next;
      if (!next) P.s.ui.execDrafts = {};
      P.save();
      P.render({ quiet: true });
      P.toast(
        next
          ? '真实 AI 已开启：回复将调用本机 Codex 并消耗模型预算'
          : '已切回模拟模式（回复不调用真实模型）',
        next ? 'info' : 'info',
      );
    };
    remote['stop-reply'] = async (d) => {
      const q = P.r(),
        message =
          q.messages.find((m) => m.id === (d.mid || d.id)) ||
          q.messages.findLast((m) => m.typing);
      P.assert(message, '没有正在生成的回复');
      const result = await D.mutate(q, '/messages/' + message.id + '/stop');
      if (result.cancellation && !result.cancellation.confirmed)
        P.toast('已提交停止请求，进程退出尚未确认，请勿重试执行', 'error');
      await refresh(q.id);
    };
    remote['resend-message'] = (d) => {
      const q = P.r(),
        m = q.messages.find((m) => m.id === (d.mid || d.id));
      P.assert(m?.role === 'user', '请选择原用户消息');
      return P.submitTurn(q, {
        text: m.text,
        stage: m.stage,
        refs: m.refs,
        attachments: m.attachments,
        parentMessageId: m.id,
        replyTo: m.replyTo,
      });
    };
    const diff = (decision) => async (d) => {
      const q = P.r(),
        m = q.messages.find((m) => m.id === d.mid);
      P.assert(m?.diff, '差异不存在');
      await D.mutate(q, '/messages/' + m.id + '/diff', {
        decision,
        selected: d.selected,
        baseVersionId: m.diff.baseVersionId,
      });
      await refresh(q.id);
      P.close();
    };
    remote['accept-diff'] = diff('accept');
    remote['reject-diff'] = diff('reject');
    remote['accept-selected-diff'] = (d) =>
      remote['accept-diff']({
        ...d,
        selected: [
          ...document.querySelectorAll('[name="diff-field"]:checked'),
        ].map((n) => Number(n.value)),
      });
    remote['open-attachment'] = async (d) => {
      const q = P.r(),
        a = C.attachment(d),
        reqId = q.id;
      P.close();
      const epoch = previewEpoch;
      const isImage = /^image\/(png|jpeg|gif)$/.test(a.mimeType || '');
      let body =
        '<p>' +
        P.esc(a.size) +
        ' · v' +
        a.version +
        ' · 原件已保存到服务端</p>';
      if (isImage) {
        const blob = await D.fileBlob(q, a);
        if (epoch !== previewEpoch || P.r()?.id !== reqId) return;
        previewUrl = URL.createObjectURL(
          new Blob([blob], { type: a.mimeType }),
        );
        body +=
          '<img class="att-preview-img" src="' +
          previewUrl +
          '" alt="' +
          P.esc(a.name) +
          '">';
      } else {
        let text = a.fullContent || '';
        if (!text && /^text\/|application\/json/.test(a.mimeType || '')) {
          const blob = await D.fileBlob(q, a);
          text = await blob.slice(0, 200000).text();
        }
        if (epoch !== previewEpoch || P.r()?.id !== reqId) return;
        body +=
          '<div class="doc-body">' +
          P.esc(text || '原件已保存，尚未解析') +
          '</div>';
      }
      P.modal(
        a.name,
        body,
        P.btn('download-attachment-original', '下载原件', {
          id: a.id,
          mid: d.mid || '',
          version: a.version,
        }) + P.btn('close-modal', '关闭'),
      );
    };
  };
})();
