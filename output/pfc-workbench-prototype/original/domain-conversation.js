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
    remote['stop-reply'] = async (d) => {
      const q = P.r(),
        message =
          q.messages.find((m) => m.id === (d.mid || d.id)) ||
          q.messages.findLast((m) => m.typing);
      P.assert(message, '没有正在生成的回复');
      await D.mutate(q, '/messages/' + message.id + '/stop');
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
